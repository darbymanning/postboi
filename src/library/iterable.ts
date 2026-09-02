import type { PreparedMessage, ApiKeyOptions, ProviderError, RequestSpec } from "./index.js"
import { ProviderBase } from "./index.js"

/** Options for the Iterable provider constructor. */
type Options = ApiKeyOptions & {
	/**
	 * The triggered campaign to send — its numeric id in Iterable. Iterable only sends
	 * campaigns designed there; the send's subject, HTML and text arrive as the
	 * `subject`, `html` and `text` data fields for that template to place.
	 */
	campaign_id: number | string
	/** The project's data region: `"us"` (the default) or `"eu"`. */
	region?: "us" | "eu"
	/** Data fields merged into every send, under the message's own. */
	data_fields?: Record<string, unknown>
}

export interface SendParams {
	campaignId: number
	recipientEmail: string
	dataFields: Record<string, unknown>
	/** `yyyy-MM-dd HH:mm:ss` in UTC. */
	sendAt?: string
}

type SendResponse = {
	msg: string
	code: string
	params?: unknown
}

/** Iterable's own timestamp format — not ISO 8601. */
function iterable_time(date: Date): string {
	return date.toISOString().slice(0, 19).replace("T", " ")
}

/**
 * Iterable provider — https://api.iterable.com/api/docs#email_target
 *
 * Iterable has no raw-content send: every email is a triggered campaign designed in
 * Iterable, sent to one user, with data fields filled in. So the provider takes a
 * `campaign_id` and hands the send over as data fields — `subject`, `html`, `text`,
 * `from` and the recipient's `name` when there is one — for the template to place, and a
 * [batch](https://docs.postboi.app/bulk) with `data` fills `{placeholders}` before they
 * go. The campaign's own sender wins over `from`; `scheduled_at` is forwarded as
 * `sendAt`. `cc`, `bcc`, `headers`, `tags`, attachments and `tracking` have no
 * equivalent and are dropped. Several recipients is an error rather than a guess: pass
 * an array of sends to reach several people.
 *
 * @example
 * ```ts
 * import Iterable from "postboi/iterable"
 *
 * const mail = new Iterable({ api_key: ITERABLE_API_KEY, campaign_id: 123456 })
 * await mail.send({ to: "contact@example.com", subject: "Hello", body: "<p>Hello world</p>" })
 * ```
 */
export default class Iterable extends ProviderBase<SendResponse> {
	protected readonly provider = "iterable"
	// The campaign names the sender; a send without `from` is fine.
	protected readonly requires_from = false
	#api_key: string
	#campaign_id: number
	#data_fields?: Record<string, unknown>
	#url: string

	constructor({ api_key, campaign_id, region, data_fields, ...options }: Options) {
		super(options)
		this.#api_key = api_key
		this.#campaign_id = Number(campaign_id)
		this.#data_fields = data_fields
		this.#url =
			region === "eu"
				? "https://api.eu.iterable.com/api/email/target"
				: "https://api.iterable.com/api/email/target"
	}

	protected build_request(message: PreparedMessage): RequestSpec {
		const to = this.single_recipient(message, "Iterable sends one campaign email per user.")
		const fields: Record<string, unknown> = {
			...this.#data_fields,
			...this.template_fields(message, to),
		}

		const params: SendParams = {
			campaignId: this.#campaign_id,
			recipientEmail: to.address,
			dataFields: fields,
			sendAt: message.scheduled_at ? iterable_time(message.scheduled_at) : undefined,
		}

		return {
			url: this.#url,
			headers: {
				"Api-Key": this.#api_key,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(params),
		}
	}

	protected parse_response(_response: Response, data: unknown): SendResponse {
		return data as SendResponse
	}

	// Every answer is `{ msg, code }`; anything but `Success` is a refusal, 200 or not.
	protected parse_error(_response: Response, data: unknown): ProviderError | undefined {
		if (data === null || typeof data !== "object") return undefined
		const e = data as Record<string, unknown>
		if (typeof e.code !== "string" || e.code === "Success") return undefined
		return {
			message: typeof e.msg === "string" ? e.msg : `iterable answered ${e.code}`,
			code: e.code,
		}
	}
}
