import type { PreparedMessage, ApiKeyOptions, ProviderError, RequestSpec } from "./index.js"
import { ProviderBase } from "./index.js"

/** Options for the OneSignal provider constructor. */
type Options = ApiKeyOptions & {
	/** The OneSignal app the message belongs to — its App ID. */
	app_id: string
	/**
	 * Deliver even to addresses that have unsubscribed from this app. **On by default**,
	 * because that is what a transactional send means: a password reset or a receipt is
	 * owed to the person whatever they think of the newsletter. Set false for anything a
	 * recipient could reasonably have opted out of.
	 */
	include_unsubscribed?: boolean
	/** Preview text shown after the subject in the inbox list. */
	preheader?: string
}

export interface SendParams {
	app_id: string
	target_channel: "email"
	email_to: Array<string>
	email_bcc?: Array<string>
	email_subject: string
	email_body?: string
	email_from_name?: string
	email_from_address?: string
	email_reply_to_address?: string
	email_preheader?: string
	include_unsubscribed?: boolean
	disable_email_click_tracking?: boolean
	send_after?: string
}

type SendResponse = {
	id?: string
	external_id?: string | null
	recipients?: number
}

/**
 * OneSignal provider — https://documentation.onesignal.com/reference/create-message
 *
 * A message on OneSignal's `/notifications` endpoint with `target_channel: "email"`.
 * Addresses go in `email_to`, which files anyone OneSignal hasn't seen before as a new
 * subscriber; `bcc` maps to `email_bcc` (**five addresses, maximum** — OneSignal's limit,
 * not ours). There is no cc and no separate reply-to name, so `cc` addresses join the
 * recipient list and each gets their own copy. Attachments, `headers` and `tags` have no
 * equivalent and are dropped.
 *
 * `scheduled_at` is forwarded as `send_after`, and `tracking: { clicks: false }` sets
 * `disable_email_click_tracking`. Opens are an app-level setting in OneSignal, so
 * `tracking.opens` is dropped.
 *
 * OneSignal answers **200 with no `id`** when it accepted nobody — an unsubscribed
 * address, an empty audience — so that case is thrown rather than returned as a success.
 * See `include_unsubscribed` for the reason it usually shouldn't arise.
 *
 * @example
 * ```ts
 * import OneSignal from "postboi/onesignal"
 *
 * const mail = new OneSignal({
 *   api_key: ONESIGNAL_REST_API_KEY,
 *   app_id: ONESIGNAL_APP_ID,
 *   default: { from: "no-reply@example.com" },
 * })
 * await mail.send({ to: "contact@example.com", subject: "Hello", body: "<p>Hello world</p>" })
 * ```
 */
export default class OneSignal extends ProviderBase<SendResponse> {
	protected readonly provider = "onesignal"
	// The app's configured sender stands in when a send names none.
	protected readonly requires_from = false
	#api_key: string
	#app_id: string
	#include_unsubscribed: boolean
	#preheader?: string

	constructor({ api_key, app_id, include_unsubscribed, preheader, ...options }: Options) {
		super(options)
		this.#api_key = api_key
		this.#app_id = app_id
		this.#include_unsubscribed = include_unsubscribed ?? true
		this.#preheader = preheader
	}

	protected build_request(message: PreparedMessage): RequestSpec {
		const from = message.from ? this.parse_email_address(message.from) : undefined
		// No cc on OneSignal: those addresses become recipients in their own right, which is
		// what already happens on the wire — every address gets its own copy.
		const to = [
			...this.parse_addresses(message.to),
			...(message.cc ? this.parse_addresses(message.cc) : []),
		]

		const params: SendParams = {
			app_id: this.#app_id,
			target_channel: "email",
			email_to: to.map((a) => a.address),
			email_bcc: message.bcc ? this.parse_addresses(message.bcc).map((a) => a.address) : undefined,
			email_subject: message.subject,
			email_body: message.html ?? message.text,
			email_from_name: from?.name,
			email_from_address: from?.address,
			email_reply_to_address: message.reply_to
				? this.parse_addresses(message.reply_to)[0]?.address
				: undefined,
			email_preheader: this.#preheader,
			include_unsubscribed: this.#include_unsubscribed,
			disable_email_click_tracking: message.tracking?.clicks === false ? true : undefined,
			send_after: message.scheduled_at?.toISOString(),
		}

		return {
			url: "https://api.onesignal.com/notifications",
			headers: {
				Authorization: `Key ${this.#api_key}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(params),
		}
	}

	protected parse_response(_response: Response, data: unknown): SendResponse {
		return (data ?? {}) as SendResponse
	}

	/**
	 * `{ errors: [...] }` — sometimes strings, sometimes a map of what was invalid — and the
	 * quiet case: a 200 whose body carries no `id`, which is OneSignal for "nobody was
	 * reachable". Left unread, that one looks exactly like a successful send.
	 */
	protected parse_error(response: Response, data: unknown): ProviderError | undefined {
		if (data === null || typeof data !== "object") return undefined
		const e = data as Record<string, unknown>
		const errors = e.errors
		if (Array.isArray(errors) && errors.length) {
			return {
				message: errors.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("; "),
			}
		}
		if (errors && typeof errors === "object") return { message: JSON.stringify(errors) }
		if (response.ok && !e.id) {
			return { message: "onesignal accepted the request but reached no recipients" }
		}
		return undefined
	}
}
