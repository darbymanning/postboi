import { SendMailClient, type Zepto } from "zeptomail"
import type { SendOptions, CommonProviderOptions } from "./index.js"
import { ProviderBase } from "./index.js"

/** Options for the ZeptoMail provider constructor. */
export type ZeptoOptions = CommonProviderOptions & { token: string }

/**
 * ZeptoMail provider.
 *
 * Example:
 * ```ts
 * import Postboi from 'postboi/zepto'
 *
 * const mail = new Postboi({ token: ZEPTO_TOKEN, default_from: 'no-reply@example.com' })
 * await mail.send({
 *   to: 'contact@example.com',
 *   subject: 'Hello',
 *   body: 'Hello world'
 * })
 *
 * // With FormData (special fields are extracted; body is rendered as an HTML table)
 * await mail.send({ body: await request.formData() })
 * ```
 */
export default class Postboi extends ProviderBase<Zepto.SendMailResponse> {
	#client: SendMailClient
	#defaults: { from?: string; to?: string }

	/**
	 * Create a ZeptoMail client.
	 * @param token ZeptoMail API token
	 * @param default_from Optional default sender address used when `from` is omitted
	 * @param default_to Optional default recipient address used when `to` is omitted
	 */
	constructor({ token, default_from, default_to }: ZeptoOptions) {
		super()
		this.#client = new SendMailClient({ url: "https://api.zeptomail.com/", token })
		this.#defaults = { from: default_from, to: default_to }
	}

	/**
	 * Send an email via ZeptoMail.
	 * - Supports string or FormData body.
	 * - Handles grouped fields using `fieldset→field` in FormData keys.
	 */
	async send(_options: SendOptions): Promise<Zepto.SendMailResponse> {
		const options = await this.prepare_send(_options, this.#defaults)

		const zepto_params: Zepto.SendMailParams = {
			to: this.parse_addresses(options.to).map((a) => ({ email_address: a })),
			from: this.parse_email_address(options.from),
			reply_to: options.reply_to ? this.parse_addresses(options.reply_to) : undefined,
			bcc: options.bcc
				? this.parse_addresses(options.bcc).map((a) => ({ email_address: a }))
				: undefined,
			cc: options.cc
				? this.parse_addresses(options.cc).map((a) => ({ email_address: a }))
				: undefined,
			subject: options.subject || "Mail sent from website",
			htmlbody: typeof options.body === "string" ? options.body : "",
			attachments: options.attachments
				? await this.parse_attachments(options.attachments)
				: undefined,
		}

		return await this.#client.sendMail(zepto_params)
	}

	/**
	 * Type guard to check if an error is a ZeptoMail error.
	 * @example
	 * try { await mail.send({ to: 'a@b.com', body: 'hi' }) } catch (e) {
	 *   if (mail.is_error(e)) console.error(e.error.message)
	 * }
	 */
	is_error(error: unknown): error is Zepto.Error {
		type Inner = { code: string; message: string; request_id: string; details: unknown[] }

		const has_shape = (e: unknown): e is { error: Inner } => {
			if (e === null || typeof e !== "object") return false
			const outer = e as Record<string, unknown>
			if (!("error" in outer)) return false
			const inner = outer.error
			if (inner === null || typeof inner !== "object") return false
			const i = inner as Record<string, unknown>

			return (
				typeof i.code === "string" &&
				typeof i.message === "string" &&
				typeof i.request_id === "string" &&
				Array.isArray(i.details)
			)
		}

		return has_shape(error)
	}
}
