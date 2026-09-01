import type { PreparedMessage, ApiKeyOptions, ProviderError, RequestSpec } from "./index.js"
import { ProviderBase } from "./index.js"

/** Options for the Lettr provider constructor. */
type Options = ApiKeyOptions

interface Attachment {
	filename: string
	content: string
	content_type: string
}

export interface SendParams {
	from: string
	from_name?: string
	to: Array<string>
	cc?: Array<string>
	bcc?: Array<string>
	reply_to?: string
	reply_to_name?: string
	subject: string
	html?: string
	text?: string
	tag?: string
	headers?: Record<string, string>
	attachments?: Array<Attachment>
	scheduled_at?: string
}

type SendResponse = {
	message?: string
	data: {
		/** The request id — one per send, however many recipients. */
		request_id: string
		accepted: number
		rejected: number
	}
}

/**
 * Lettr provider — https://lettr.com/docs/api
 *
 * A JSON send with Bearer auth: the sender and single reply-to split into address and
 * name fields, bare recipient addresses (Lettr takes no display names on `to`, `cc` or
 * `bcc`), both bodies, the first `tag`, custom `headers` and base64 attachments. A
 * `scheduled_at` send goes to `/emails/scheduled` instead of `/emails`; `tracking` has no
 * per-send control and is dropped. Lettr counts recipients rather than naming them, so
 * a send it accepted for nobody is an error and a partial acceptance is left for the
 * caller to read.
 *
 * @example
 * ```ts
 * import Lettr from "postboi/lettr"
 *
 * const mail = new Lettr({ api_key: LETTR_API_KEY, default: { from: "no-reply@example.com" } })
 * await mail.send({ to: "contact@example.com", subject: "Hello", body: "<p>Hello world</p>" })
 * ```
 */
export default class Lettr extends ProviderBase<SendResponse> {
	protected readonly provider = "lettr"
	#api_key: string

	constructor({ api_key, ...options }: Options) {
		super(options)
		this.#api_key = api_key
	}

	protected async build_request(message: PreparedMessage): Promise<RequestSpec> {
		const from = this.parse_email_address(message.from)
		const reply_to = message.reply_to ? this.parse_addresses(message.reply_to)[0] : undefined
		const scheduled_at = message.scheduled_at?.toISOString()

		const params: SendParams = {
			from: from.address,
			from_name: from.name,
			to: this.parse_addresses(message.to).map((a) => a.address),
			cc: message.cc ? this.parse_addresses(message.cc).map((a) => a.address) : undefined,
			bcc: message.bcc ? this.parse_addresses(message.bcc).map((a) => a.address) : undefined,
			reply_to: reply_to?.address,
			reply_to_name: reply_to?.name,
			subject: message.subject,
			html: message.html,
			text: message.text,
			tag: message.tags?.[0],
			headers: message.headers,
			attachments: message.attachments
				? (await this.parse_attachments(message.attachments)).map((a) => ({
						filename: a.name,
						content: a.content,
						content_type: a.mime_type || "application/octet-stream",
					}))
				: undefined,
			scheduled_at,
		}

		return {
			url: scheduled_at
				? "https://app.lettr.com/api/emails/scheduled"
				: "https://app.lettr.com/api/emails",
			headers: {
				Authorization: `Bearer ${this.#api_key}`,
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify(params),
		}
	}

	protected parse_response(_response: Response, data: unknown): SendResponse {
		return data as SendResponse
	}

	protected parse_error(response: Response, data: unknown): ProviderError | undefined {
		if (data === null || typeof data !== "object") return undefined
		const e = data as Record<string, unknown>
		if (!response.ok) {
			return {
				message: typeof e.message === "string" ? e.message : `lettr answered ${response.status}`,
			}
		}
		const d = e.data as Record<string, unknown> | undefined
		if (d && d.accepted === 0) {
			return {
				message:
					typeof d.rejected === "number" && d.rejected > 0
						? `lettr rejected every recipient (${d.rejected})`
						: "lettr accepted no recipients",
			}
		}
		return undefined
	}
}
