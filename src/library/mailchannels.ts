import type { PreparedMessage, ApiKeyOptions, ProviderError, RequestSpec } from "./index.js"
import { ProviderBase } from "./index.js"

/** Options for the MailChannels provider constructor. */
type Options = ApiKeyOptions & {
	/**
	 * Sign outbound mail with your own DKIM key, when the sending domain's key lives with
	 * you rather than in MailChannels' Domain Lockdown. `private_key` is the PEM body.
	 */
	dkim?: { domain: string; selector: string; private_key: string }
}

interface Address {
	email: string
	name?: string
}

interface Personalization {
	to: Array<Address>
	cc?: Array<Address>
	bcc?: Array<Address>
	dkim_domain?: string
	dkim_selector?: string
	dkim_private_key?: string
}

export interface SendParams {
	personalizations: Array<Personalization>
	from: Address
	reply_to?: Address
	subject: string
	content: Array<{ type: "text/plain" | "text/html"; value: string }>
	headers?: Record<string, string>
	attachments?: Array<{ filename: string; content: string; type: string }>
	tracking_settings?: {
		open_tracking?: { enable: boolean }
		click_tracking?: { enable: boolean }
	}
}

type SendResponse = {
	request_id?: string
	results?: Array<{ index?: number; message_id?: string; status?: string; reason?: string }>
}

/**
 * MailChannels Email API provider — https://docs.mailchannels.com/email-api
 *
 * The API that Cloudflare Workers grew up on: one JSON send, authenticated with an
 * `X-Api-Key`, the sending domain verified by Domain Lockdown (or signed here with
 * `dkim`). Maps 1:1 onto PreparedMessage — `to`, `cc` and `bcc` as one personalization,
 * a single `reply_to`, both bodies as `content` parts, custom `headers`, base64
 * `attachments` and per-send open/click `tracking`. `tags` and `scheduled_at` have no
 * equivalent and are dropped.
 *
 * @example
 * ```ts
 * import MailChannels from "postboi/mailchannels"
 *
 * const mail = new MailChannels({ api_key: MAILCHANNELS_API_KEY, default: { from: "no-reply@example.com" } })
 * await mail.send({ to: "contact@example.com", subject: "Hello", body: "<p>Hello world</p>" })
 * ```
 */
export default class MailChannels extends ProviderBase<SendResponse> {
	protected readonly provider = "mailchannels"
	#api_key: string
	#dkim?: Options["dkim"]

	constructor({ api_key, dkim, ...options }: Options) {
		super(options)
		this.#api_key = api_key
		this.#dkim = dkim
	}

	protected async build_request(message: PreparedMessage): Promise<RequestSpec> {
		const personalization: Personalization = {
			to: this.email_name_list(message.to),
			cc: message.cc ? this.email_name_list(message.cc) : undefined,
			bcc: message.bcc ? this.email_name_list(message.bcc) : undefined,
		}
		if (this.#dkim) {
			personalization.dkim_domain = this.#dkim.domain
			personalization.dkim_selector = this.#dkim.selector
			personalization.dkim_private_key = this.#dkim.private_key
		}

		const content: SendParams["content"] = []
		if (message.text) content.push({ type: "text/plain", value: message.text })
		if (message.html) content.push({ type: "text/html", value: message.html })

		const params: SendParams = {
			personalizations: [personalization],
			from: this.email_name(this.parse_email_address(message.from)),
			reply_to: message.reply_to
				? this.email_name(this.parse_addresses(message.reply_to)[0])
				: undefined,
			subject: message.subject,
			content,
			headers: message.headers,
			attachments: message.attachments
				? (await this.parse_attachments(message.attachments)).map((a) => ({
						filename: a.name,
						content: a.content,
						type: a.mime_type,
					}))
				: undefined,
		}
		if (message.tracking) {
			const { opens, clicks } = message.tracking
			params.tracking_settings = {
				...(opens !== undefined ? { open_tracking: { enable: opens } } : {}),
				...(clicks !== undefined ? { click_tracking: { enable: clicks } } : {}),
			}
		}

		return {
			url: "https://api.mailchannels.net/tx/v1/send",
			headers: {
				"X-Api-Key": this.#api_key,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(params),
		}
	}

	protected parse_response(_response: Response, data: unknown): SendResponse {
		return (data ?? {}) as SendResponse
	}

	// Failures are `{ errors: ["…"] }`.
	protected parse_error(_response: Response, data: unknown): ProviderError | undefined {
		if (data === null || typeof data !== "object") return undefined
		const e = data as Record<string, unknown>
		if (Array.isArray(e.errors) && e.errors.length) {
			return { message: e.errors.map(String).join("; ") }
		}
		if (typeof e.message === "string" && !("results" in e)) return { message: e.message }
		return undefined
	}
}
