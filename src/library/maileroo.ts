import type {
	PreparedMessage,
	ApiKeyOptions,
	ProviderError,
	RequestSpec,
	MailAddress,
} from "./index.js"
import { ProviderBase } from "./index.js"

/** Options for the Maileroo provider constructor. */
type Options = ApiKeyOptions

interface Address {
	address: string
	display_name?: string
}

interface Attachment {
	file_name: string
	content_type: string
	content: string
	inline: boolean
}

export interface SendParams {
	from: Address
	to: Array<Address>
	cc?: Array<Address>
	bcc?: Array<Address>
	reply_to?: Array<Address>
	subject: string
	html?: string | null
	plain?: string | null
	attachments?: Array<Attachment>
	headers?: Record<string, string>
	tags?: Record<string, string>
	tracking?: boolean
	scheduled_at?: string
}

type SendResponse = {
	success: boolean
	message: string
	data?: { reference_id: string }
}

/**
 * Maileroo provider — https://maileroo.com/docs/email-api/send-basic-email
 *
 * The v2 API: Bearer auth against `/emails`, addresses as `{ address, display_name }`,
 * `html` and `plain` bodies, every reply-to address, custom `headers`, base64
 * attachments and `scheduled_at` passed through. Maileroo's `tags` are a name→value map,
 * so each tag goes as its own name; `tracking` is one switch for opens and clicks
 * together, on when either flag is. Every answer carries `success`, so a refusal is read
 * from the body whatever the status.
 *
 * @example
 * ```ts
 * import Maileroo from "postboi/maileroo"
 *
 * const mail = new Maileroo({ api_key: MAILEROO_API_KEY, default: { from: "no-reply@example.com" } })
 * await mail.send({ to: "contact@example.com", subject: "Hello", body: "<p>Hello world</p>" })
 * ```
 */
export default class Maileroo extends ProviderBase<SendResponse> {
	protected readonly provider = "maileroo"
	#api_key: string

	constructor({ api_key, ...options }: Options) {
		super(options)
		this.#api_key = api_key
	}

	#address(a: MailAddress): Address {
		return a.name ? { address: a.address, display_name: a.name } : { address: a.address }
	}

	protected async build_request(message: PreparedMessage): Promise<RequestSpec> {
		const params: SendParams = {
			from: this.#address(this.parse_email_address(message.from)),
			to: this.parse_addresses(message.to).map((a) => this.#address(a)),
			cc: message.cc ? this.parse_addresses(message.cc).map((a) => this.#address(a)) : undefined,
			bcc: message.bcc ? this.parse_addresses(message.bcc).map((a) => this.#address(a)) : undefined,
			reply_to: message.reply_to
				? this.parse_addresses(message.reply_to).map((a) => this.#address(a))
				: undefined,
			subject: message.subject,
			html: message.html,
			plain: message.text,
			attachments: message.attachments
				? (await this.parse_attachments(message.attachments)).map((a) => ({
						file_name: a.name,
						content_type: a.mime_type || "application/octet-stream",
						content: a.content,
						inline: false,
					}))
				: undefined,
			headers: message.headers,
			tags: message.tags?.length
				? Object.fromEntries(message.tags.map((tag) => [tag, tag]))
				: undefined,
			tracking: message.tracking
				? Boolean(message.tracking.opens || message.tracking.clicks)
				: undefined,
			scheduled_at: message.scheduled_at?.toISOString(),
		}

		return {
			url: "https://smtp.maileroo.com/api/v2/emails",
			headers: {
				Authorization: `Bearer ${this.#api_key}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(params),
		}
	}

	protected parse_response(_response: Response, data: unknown): SendResponse {
		return data as SendResponse
	}

	// Every answer is `{ success, message, data? }`, whatever the status.
	protected parse_error(_response: Response, data: unknown): ProviderError | undefined {
		if (data === null || typeof data !== "object") return undefined
		const e = data as Record<string, unknown>
		if (e.success === false) {
			return { message: typeof e.message === "string" ? e.message : "maileroo rejected the send" }
		}
		return undefined
	}
}
