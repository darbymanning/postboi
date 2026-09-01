import { SmsProvider, type PreparedSms, type SmsApiKeyOptions } from "./provider.js"
import type { RequestSpec } from "../transport.js"
import type { ProviderError } from "../errors.js"

/** Options for the PureSMS provider constructor. */
type Options = SmsApiKeyOptions

/** One message on the PureSMS payload — https://the.divergent.guide/puresms/developers/ */
export interface SendParams {
	sender: string
	/** E.164, plus included. */
	recipient: string
	content: string
	/** ISO 8601 in UTC, for a scheduled send. */
	sendAtUtc?: string
	/** Echoed on the delivery receipt, so a webhook can correlate. */
	clientReference?: string
}

/** `count` and `errors` only come back from a batch — a partly-rejected one answers 207. */
type SendResponse = { id: string; count?: number; errors?: Array<unknown> }

/**
 * PureSMS — https://puresms.uk/developers
 *
 * UK-native, flat-rate pay-as-you-go and hosted in the EU. PureSMS is a brand on Divergent
 * Connect, which is why the API lives at `connect-api.divergent.cloud`.
 *
 * @example
 * ```ts
 * import PureSms from "postboi/puresms"
 *
 * const text = new PureSms({ api_key: PURESMS_API_KEY, default: { from: "POSTBOI" } })
 * await text.send({ to: "+447788223344", message: "Your code is 4291" })
 * ```
 */
export default class PureSms extends SmsProvider<SendResponse> {
	protected readonly provider = "puresms"
	// `sendAtUtc` rides on the same payload, and `cancel` undoes it while still pending.
	protected override readonly supports_scheduling = true
	#api_key: string
	#host = "https://connect-api.divergent.cloud"

	constructor({ api_key, ...options }: Options) {
		super(options)
		this.#api_key = api_key
	}

	#params(message: PreparedSms, recipient: string): SendParams {
		return {
			sender: message.from ?? "",
			recipient,
			content: message.message,
			clientReference: message.tags?.[0],
		}
	}

	protected build_request(message: PreparedSms): RequestSpec {
		const headers = { "X-Api-Key": this.#api_key, "Content-Type": "application/json" }
		const sendAtUtc = message.scheduled_at?.toISOString()
		// One recipient answers with a message id; several go to the bulk endpoint, which
		// takes fully-rendered messages and schedules the whole batch from the top level.
		if (message.to.length === 1) {
			const body = { ...this.#params(message, message.to[0]), sendAtUtc }
			return { url: `${this.#host}/sms/send`, headers, body: JSON.stringify(body) }
		}
		const messages = message.to.map((to) => this.#params(message, to))
		return {
			url: `${this.#host}/sms/send/bulk`,
			headers,
			body: JSON.stringify({ sendAtUtc, messages }),
		}
	}

	protected parse_response(_response: Response, data: unknown): SendResponse {
		const d = data as Record<string, unknown> | null
		// Ids are int64s serialised as strings; the bulk endpoint calls its one `batchId`.
		return {
			id: String(d?.id ?? d?.batchId ?? ""),
			count: d?.messageCount as number | undefined,
			errors: d?.errors as Array<unknown> | undefined,
		}
	}

	protected parse_error(_response: Response, data: unknown): ProviderError | undefined {
		if (data === null || typeof data !== "object") return undefined
		const e = data as Record<string, unknown>
		// Error bodies aren't documented. The platform is ASP.NET, so a rejection arrives as
		// RFC 7807 problem details ({ title, detail, status }); a success carries an id.
		if ("id" in e || "batchId" in e) return undefined
		const message = [e.detail, e.title, e.message].find((m) => typeof m === "string")
		return message ? { message, code: e.status as number | undefined } : undefined
	}

	/** Cancel a scheduled message while it's still pending; a batch id cancels the batch. */
	async cancel(id: string, kind: "message" | "batch" = "message"): Promise<{ id: string }> {
		const path = kind === "batch" ? "bulk/" : ""
		const response = await this.request({
			url: `${this.#host}/sms/send/${path}${encodeURIComponent(id)}`,
			method: "DELETE",
			headers: { "X-Api-Key": this.#api_key },
		})
		const error = this.error_for(response, await this.read_json(response), "cancel")
		if (error) throw error
		return { id }
	}
}
