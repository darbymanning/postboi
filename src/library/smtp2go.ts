import type { PreparedMessage, ApiKeyOptions, ProviderError, RequestSpec } from "./index.js"
import { ProviderBase } from "./index.js"

/** Options for the SMTP2GO provider constructor. */
type Options = ApiKeyOptions & {
	/**
	 * Pin the API to a region — `"us"`, `"eu"` or `"au"` — so the request never leaves
	 * it. Omit for the regionless endpoint, which routes to the nearest.
	 */
	region?: string
}

interface Attachment {
	filename: string
	fileblob: string
	mimetype: string
}

export interface SendParams {
	sender: string
	to: Array<string>
	cc?: Array<string>
	bcc?: Array<string>
	subject: string
	html_body?: string
	text_body?: string
	custom_headers?: Array<{ header: string; value: string }>
	attachments?: Array<Attachment>
	/** ISO 8601, up to three days ahead. */
	schedule?: string
}

type SendResponse = {
	request_id?: string
	data: {
		succeeded: number
		failed: number
		failures: Array<unknown>
		email_id: string
		schedule_id?: string
	}
}

/**
 * SMTP2GO provider — https://developers.smtp2go.com/reference/send-standard-email
 *
 * A straight JSON send against `/email/send` with the API key in `X-Smtp2go-Api-Key`.
 * Addresses go as `Name <email>` strings, both bodies have their own slot, `headers`
 * become `custom_headers` (and so does `reply_to` — SMTP2GO has no field of its own for
 * it), attachments are base64 `fileblob`s and `scheduled_at` is forwarded as `schedule`,
 * which SMTP2GO caps at three days out. `tags` and per-send `tracking` have no
 * equivalent and are dropped; tracking is a per-account setting.
 *
 * @example
 * ```ts
 * import SMTP2GO from "postboi/smtp2go"
 *
 * const mail = new SMTP2GO({ api_key: SMTP2GO_API_KEY, default: { from: "no-reply@example.com" } })
 * await mail.send({ to: "contact@example.com", subject: "Hello", body: "<p>Hello world</p>" })
 * ```
 */
export default class SMTP2GO extends ProviderBase<SendResponse> {
	protected readonly provider = "smtp2go"
	#api_key: string
	#url: string

	constructor({ api_key, region, ...options }: Options) {
		super(options)
		this.#api_key = api_key
		const host = region ? `${region.toLowerCase()}-api.smtp2go.com` : "api.smtp2go.com"
		this.#url = `https://${host}/v3/email/send`
	}

	protected async build_request(message: PreparedMessage): Promise<RequestSpec> {
		const custom_headers = Object.entries(message.headers ?? {}).map(([header, value]) => ({
			header,
			value,
		}))
		if (message.reply_to) {
			custom_headers.push({ header: "Reply-To", value: this.stringify_addresses(message.reply_to) })
		}

		const params: SendParams = {
			sender: this.stringify_address(this.parse_email_address(message.from)),
			to: this.parse_addresses(message.to).map((a) => this.stringify_address(a)),
			cc: message.cc
				? this.parse_addresses(message.cc).map((a) => this.stringify_address(a))
				: undefined,
			bcc: message.bcc
				? this.parse_addresses(message.bcc).map((a) => this.stringify_address(a))
				: undefined,
			subject: message.subject,
			html_body: message.html,
			text_body: message.text,
			custom_headers: custom_headers.length ? custom_headers : undefined,
			attachments: message.attachments
				? (await this.parse_attachments(message.attachments)).map((a) => ({
						filename: a.name,
						fileblob: a.content,
						mimetype: a.mime_type,
					}))
				: undefined,
			schedule: message.scheduled_at?.toISOString(),
		}

		return {
			url: this.#url,
			headers: {
				"X-Smtp2go-Api-Key": this.#api_key,
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify(params),
		}
	}

	protected parse_response(_response: Response, data: unknown): SendResponse {
		return data as SendResponse
	}

	// Rejections are `{ request_id, data: { error, error_code } }`; a 200 can still carry
	// `data.failed` with nothing succeeded, when every recipient was refused.
	protected parse_error(_response: Response, data: unknown): ProviderError | undefined {
		if (data === null || typeof data !== "object") return undefined
		const d = (data as Record<string, unknown>).data
		if (d === null || typeof d !== "object") return undefined
		const e = d as Record<string, unknown>
		if (typeof e.error === "string") {
			return { message: e.error, code: typeof e.error_code === "string" ? e.error_code : undefined }
		}
		if (e.succeeded === 0 && typeof e.failed === "number" && e.failed > 0) {
			const failures = Array.isArray(e.failures) ? e.failures.map(String).join("; ") : ""
			return { message: failures || "smtp2go accepted no recipients" }
		}
		return undefined
	}
}
