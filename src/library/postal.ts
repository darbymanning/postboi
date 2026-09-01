import type { PreparedMessage, ApiKeyOptions, ProviderError, RequestSpec } from "./index.js"
import { ProviderBase } from "./index.js"

/** Options for the Postal provider constructor. */
type Options = ApiKeyOptions & {
	/** Your Postal installation — `https://postal.example.com` (or just the hostname). */
	host: string
}

interface Attachment {
	name: string
	content_type: string
	data: string
}

export interface SendParams {
	to: Array<string>
	cc?: Array<string>
	bcc?: Array<string>
	from: string
	reply_to?: string
	subject: string
	tag?: string
	plain_body?: string
	html_body?: string
	attachments?: Array<Attachment>
	headers?: Record<string, string>
}

type SendResponse = {
	status: string
	time?: number
	flags?: Record<string, unknown>
	data: {
		/** The Message-ID header Postal wrote — what its webhooks report as `message_id`. */
		message_id: string
		/** One row per recipient: Postal's own numeric id and the token its URLs use. */
		messages: Record<string, { id: number; token: string }>
	}
}

/**
 * Postal provider — https://docs.postalserver.io/developer/api
 *
 * The self-hosted mail platform. A JSON send against your own installation's
 * `/api/v1/send/message`, authenticated with the mail server's API key in
 * `X-Server-API-Key`. Addresses go as `Name <email>` strings, both bodies have a slot,
 * a single `reply_to`, custom `headers`, base64 attachments, and the first `tag` becomes
 * Postal's per-message `tag`. `scheduled_at` and per-send `tracking` have no equivalent
 * (tracking is per mail server) and are dropped. Postal answers 200 with
 * `status: "error"` on a refusal, so `parse_error` reads the status.
 *
 * @example
 * ```ts
 * import Postal from "postboi/postal"
 *
 * const mail = new Postal({
 *   host: "https://postal.example.com",
 *   api_key: POSTAL_API_KEY,
 *   default: { from: "no-reply@example.com" },
 * })
 * await mail.send({ to: "contact@example.com", subject: "Hello", body: "<p>Hello world</p>" })
 * ```
 */
export default class Postal extends ProviderBase<SendResponse> {
	protected readonly provider = "postal"
	#api_key: string
	#url: string

	constructor({ api_key, host, ...options }: Options) {
		super(options)
		this.#api_key = api_key
		const origin = new URL(/^https?:\/\//i.test(host) ? host : `https://${host}`).origin
		this.#url = `${origin}/api/v1/send/message`
	}

	protected async build_request(message: PreparedMessage): Promise<RequestSpec> {
		const params: SendParams = {
			to: this.parse_addresses(message.to).map((a) => this.stringify_address(a)),
			cc: message.cc
				? this.parse_addresses(message.cc).map((a) => this.stringify_address(a))
				: undefined,
			bcc: message.bcc
				? this.parse_addresses(message.bcc).map((a) => this.stringify_address(a))
				: undefined,
			from: this.stringify_address(this.parse_email_address(message.from)),
			reply_to: message.reply_to
				? this.stringify_address(this.parse_addresses(message.reply_to)[0])
				: undefined,
			subject: message.subject,
			tag: message.tags?.[0],
			plain_body: message.text,
			html_body: message.html,
			attachments: message.attachments
				? (await this.parse_attachments(message.attachments)).map((a) => ({
						name: a.name,
						content_type: a.mime_type || "application/octet-stream",
						data: a.content,
					}))
				: undefined,
			headers: message.headers,
		}

		return {
			url: this.#url,
			headers: {
				"X-Server-API-Key": this.#api_key,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(params),
		}
	}

	protected parse_response(_response: Response, data: unknown): SendResponse {
		return data as SendResponse
	}

	// Every answer is `{ status, data }`; anything but `success` is a refusal, with the
	// reason under `data.code` / `data.message`.
	protected parse_error(_response: Response, data: unknown): ProviderError | undefined {
		if (data === null || typeof data !== "object") return undefined
		const e = data as Record<string, unknown>
		if (typeof e.status !== "string" || e.status === "success") return undefined
		const d = (e.data ?? {}) as Record<string, unknown>
		return {
			message: typeof d.message === "string" ? d.message : `postal answered ${e.status}`,
			code: typeof d.code === "string" ? d.code : undefined,
		}
	}
}
