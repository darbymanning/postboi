import type { PreparedMessage, ApiKeyOptions, ProviderError, RequestSpec } from "./index.js"
import { ProviderBase } from "./index.js"

/** Options for the Unosend provider constructor. */
type Options = ApiKeyOptions

interface Attachment {
	filename: string
	content: string
	content_type: string
}

export interface SendParams {
	from: string
	to: Array<string>
	cc?: Array<string>
	bcc?: Array<string>
	reply_to?: string
	subject: string
	html?: string
	text?: string
	headers?: Record<string, string>
	tags?: Array<{ name: string; value: string }>
	scheduled_for?: string
	tracking?: { open?: boolean; click?: boolean }
	attachments?: Array<Attachment>
}

type SendResponse = { id: string; status?: string; created_at?: string }

/**
 * Unosend provider — https://docs.unosend.co
 *
 * Unosend takes a single reply-to address; extra ones are dropped.
 *
 * @example
 * ```ts
 * import Unosend from "postboi/unosend"
 *
 * const mail = new Unosend({ api_key: UNOSEND_API_KEY, default: { from: "no-reply@example.com" } })
 * await mail.send({ to: "contact@example.com", subject: "Hello", body: "<p>Hello world</p>" })
 * ```
 */
export default class Unosend extends ProviderBase<SendResponse> {
	protected readonly provider = "unosend"
	#api_key: string

	constructor({ api_key, ...options }: Options) {
		super(options)
		this.#api_key = api_key
	}

	protected async build_request(message: PreparedMessage): Promise<RequestSpec> {
		const { opens, clicks } = message.tracking ?? {}

		const params: SendParams = {
			from: this.stringify_address(this.parse_email_address(message.from)),
			to: this.parse_addresses(message.to).map((a) => this.stringify_address(a)),
			cc: message.cc
				? this.parse_addresses(message.cc).map((a) => this.stringify_address(a))
				: undefined,
			bcc: message.bcc
				? this.parse_addresses(message.bcc).map((a) => this.stringify_address(a))
				: undefined,
			reply_to: message.reply_to ? this.parse_addresses(message.reply_to)[0].address : undefined,
			subject: message.subject,
			html: message.html,
			text: message.text,
			headers: message.headers,
			tags: message.tags?.map((t) => ({ name: t, value: t })),
			scheduled_for: message.scheduled_at?.toISOString(),
			// Only the flags the user set are emitted; Unosend's own defaults cover the rest.
			tracking:
				opens === undefined && clicks === undefined ? undefined : { open: opens, click: clicks },
			attachments: message.attachments
				? (await this.parse_attachments(message.attachments)).map((a) => ({
						filename: a.name,
						content: a.content,
						content_type: a.mime_type,
					}))
				: undefined,
		}

		return {
			url: "https://api.unosend.co/emails",
			headers: {
				Authorization: `Bearer ${this.#api_key}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(params),
		}
	}

	// Success bodies arrive wrapped: `{ success: true, data: { id, … } }`.
	protected parse_response(_response: Response, data: unknown): SendResponse {
		const d = data as { data?: SendResponse } | null
		return d?.data ?? (data as SendResponse)
	}

	protected parse_error(_response: Response, data: unknown): ProviderError | undefined {
		if (data === null || typeof data !== "object") return undefined
		const e = data as Record<string, unknown>
		if (e.error !== null && typeof e.error === "object") {
			const inner = e.error as Record<string, unknown>
			if (typeof inner.message === "string") {
				return {
					message: inner.message,
					code:
						typeof inner.code === "string" || typeof inner.code === "number"
							? inner.code
							: undefined,
				}
			}
		}
		if (typeof e.message === "string") return { message: e.message }
		return undefined
	}
}
