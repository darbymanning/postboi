import type { PreparedMessage, ApiKeyOptions, ProviderError, RequestSpec } from "./index.js"
import { ProviderBase } from "./index.js"

/** Options for the Customer.io provider constructor. */
type Options = ApiKeyOptions & {
	/** The workspace's data region: `"us"` (the default) or `"eu"`. */
	region?: "us" | "eu"
}

export interface SendParams {
	to: string
	identifiers: { email: string }
	from: string
	reply_to?: string
	subject: string
	body?: string
	plaintext_body?: string
	bcc?: string
	headers?: Record<string, string>
	/** Filename → base64 content. */
	attachments?: Record<string, string>
	/** Unix seconds. */
	send_at?: number
	tracked?: boolean
}

type SendResponse = {
	delivery_id: string
	queued_at: string
}

/**
 * Customer.io Transactional API provider — https://docs.customer.io/api/app/#operation/sendEmail
 *
 * The raw-content form of the transactional send: `body`, `subject` and `from` on the
 * request rather than a message designed in Customer.io, authenticated with an App API
 * key. Customer.io files every send against a person, so `identifiers` is the first
 * recipient's address — that person is created if new. `to` is a comma-separated list
 * and Customer.io has no cc, so `cc` addresses join it; `bcc` has its own. A single
 * `reply_to`, custom `headers`, attachments as a filename→base64 map, `scheduled_at` as
 * `send_at` and `tracking` as the one `tracked` switch (on when either flag is, off when
 * both are) pass through; `tags` have no equivalent and are dropped.
 *
 * @example
 * ```ts
 * import CustomerIO from "postboi/customerio"
 *
 * const mail = new CustomerIO({ api_key: CUSTOMERIO_APP_API_KEY, default: { from: "no-reply@example.com" } })
 * await mail.send({ to: "contact@example.com", subject: "Hello", body: "<p>Hello world</p>" })
 * ```
 */
export default class CustomerIO extends ProviderBase<SendResponse> {
	protected readonly provider = "customerio"
	#api_key: string
	#url: string

	constructor({ api_key, region, ...options }: Options) {
		super(options)
		this.#api_key = api_key
		this.#url =
			region === "eu"
				? "https://api-eu.customer.io/v1/send/email"
				: "https://api.customer.io/v1/send/email"
	}

	protected async build_request(message: PreparedMessage): Promise<RequestSpec> {
		const to = this.parse_addresses(message.to)
		const cc = message.cc ? this.parse_addresses(message.cc) : []

		const params: SendParams = {
			to: [...to, ...cc].map((a) => this.stringify_address(a)).join(", "),
			identifiers: { email: to[0].address },
			from: this.stringify_address(this.parse_email_address(message.from)),
			reply_to: message.reply_to
				? this.stringify_address(this.parse_addresses(message.reply_to)[0])
				: undefined,
			subject: message.subject,
			body: message.html,
			plaintext_body: message.text,
			bcc: message.bcc
				? this.parse_addresses(message.bcc)
						.map((a) => this.stringify_address(a))
						.join(", ")
				: undefined,
			headers: message.headers,
			attachments: message.attachments ? await this.attachment_map(message.attachments) : undefined,
			send_at: message.scheduled_at ? Math.floor(message.scheduled_at.getTime() / 1000) : undefined,
			tracked: this.tracking_switch(message.tracking),
		}

		return {
			url: this.#url,
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

	// Refusals are `{ meta: { error } }` or `{ errors: [...] }`.
	protected parse_error(_response: Response, data: unknown): ProviderError | undefined {
		if (data === null || typeof data !== "object") return undefined
		const e = data as Record<string, unknown>
		const meta = e.meta as Record<string, unknown> | undefined
		if (typeof meta?.error === "string") return { message: meta.error }
		if (Array.isArray(e.errors) && e.errors.length) {
			return {
				message: e.errors
					.map((err) =>
						typeof err === "string"
							? err
							: ((err as Record<string, unknown>)?.detail ?? JSON.stringify(err))
					)
					.join("; "),
			}
		}
		return undefined
	}
}
