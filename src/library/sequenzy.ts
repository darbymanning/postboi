import type { PreparedMessage, ApiKeyOptions, ProviderError, RequestSpec } from "./index.js"
import { ProviderBase } from "./index.js"

/** Options for the Sequenzy provider constructor. */
type Options = ApiKeyOptions & {
	/**
	 * The workspace to send from, when `api_key` is an account key (`seq_user_…`) that can
	 * reach several. A workspace key (`seq_live_…`) belongs to one workspace and needs
	 * nothing here.
	 */
	company_id?: string
}

interface Attachment {
	filename: string
	content: string
}

export interface SendParams {
	to: string | Array<string>
	cc?: Array<string>
	bcc?: Array<string>
	from: string
	replyTo?: string
	subject: string
	body: string
	attachments?: Array<Attachment>
}

type SendResponse = {
	success: true
	/** The send record — what delivery events and `GET /email-sends/{id}` are keyed by. */
	emailSendId: string
	/** The legacy queue id; kept by Sequenzy for compatibility only. */
	jobId?: string
	to: string | Array<string>
	emailType?: string
	diagnostics?: { status: string; message: string }
}

/**
 * Sequenzy provider — https://docs.sequenzy.com/api-reference/transactional/send
 *
 * Direct-content sends only: the subject and HTML body go as-is, and Sequenzy's own
 * merge tags (`{{NAME}}`) still render if the body carries any. There is no plain-text
 * slot, so a text-only message goes out as the body; `headers`, `tags`, `scheduled_at`
 * and `tracking` have no equivalent and are ignored. A single reply-to address; extra
 * ones are dropped. Recipients are bare addresses — Sequenzy files each one as a
 * subscriber, and takes names through template variables rather than the To header.
 *
 * @example
 * ```ts
 * import Sequenzy from "postboi/sequenzy"
 *
 * const mail = new Sequenzy({ api_key: SEQUENZY_API_KEY, default: { from: "no-reply@example.com" } })
 * await mail.send({ to: "contact@example.com", subject: "Hello", body: "<p>Hello world</p>" })
 * ```
 */
export default class Sequenzy extends ProviderBase<SendResponse> {
	protected readonly provider = "sequenzy"
	#api_key: string
	#company_id?: string

	constructor({ api_key, company_id, ...options }: Options) {
		super(options)
		this.#api_key = api_key
		this.#company_id = company_id || undefined
	}

	protected async build_request(message: PreparedMessage): Promise<RequestSpec> {
		const to = this.parse_addresses(message.to).map((a) => a.address)

		const params: SendParams = {
			// A lone recipient goes as a string: that is the form Sequenzy treats as a
			// single-recipient send (subscriber linking, `EMAIL` resolving from the address).
			to: to.length === 1 ? to[0] : to,
			cc: message.cc ? this.parse_addresses(message.cc).map((a) => a.address) : undefined,
			bcc: message.bcc ? this.parse_addresses(message.bcc).map((a) => a.address) : undefined,
			from: this.stringify_address(this.parse_email_address(message.from)),
			replyTo: message.reply_to
				? this.stringify_address(this.parse_addresses(message.reply_to)[0])
				: undefined,
			subject: message.subject,
			body: message.html ?? message.text ?? "",
			attachments: message.attachments
				? (await this.parse_attachments(message.attachments)).map((a) => ({
						filename: a.name,
						content: a.content,
					}))
				: undefined,
		}

		return {
			url: "https://api.sequenzy.com/api/v1/transactional/send",
			headers: {
				Authorization: `Bearer ${this.#api_key}`,
				"Content-Type": "application/json",
				...(this.#company_id ? { "x-company-id": this.#company_id } : {}),
			},
			body: JSON.stringify(params),
		}
	}

	protected parse_response(_response: Response, data: unknown): SendResponse {
		return data as SendResponse
	}

	// Every failure is `{ success: false, error: "…" }`, whatever the status.
	protected parse_error(_response: Response, data: unknown): ProviderError | undefined {
		if (data === null || typeof data !== "object") return undefined
		const e = data as Record<string, unknown>
		if (typeof e.error === "string") return { message: e.error }
		if (e.success === false) return { message: "sequenzy rejected the send" }
		return undefined
	}
}
