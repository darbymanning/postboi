import type { PreparedMessage, ApiKeyOptions, ProviderError, RequestSpec } from "./index.js"
import { ProviderBase } from "./index.js"

/** Options for the Netcore (Pepipost) provider constructor. */
type Options = ApiKeyOptions & {
	/**
	 * The account's data region: `"global"` (the default, `emailapi.netcorecloud.net`) or
	 * `"eu"` (`apieu.netcorecloud.net`). An EU account rejects the global host, so this is
	 * the one setting worth getting right before the first send.
	 */
	region?: "global" | "eu"
}

interface Attachment {
	name: string
	content: string
}

interface Personalization {
	to: Array<{ email: string; name?: string }>
	cc?: Array<{ email: string; name?: string }>
	bcc?: Array<{ email: string; name?: string }>
	attachments?: Array<Attachment>
	/** Custom headers, echoed back on this message's webhook events. */
	"x-apiheader"?: Record<string, string>
}

export interface SendParams {
	from: { email: string; name?: string }
	subject: string
	content: Array<{ type: string; value: string }>
	personalizations: Array<Personalization>
	reply_to?: string
	tags?: Array<string>
	settings?: { open_track?: boolean; click_track?: boolean }
}

type SendResponse = {
	status?: string
	data?: { message_ids?: Array<Record<string, string>>; total_count?: number }
}

/**
 * Netcore Email API provider (formerly Pepipost) — https://emaildocs.netcorecloud.com
 *
 * A SendGrid-shaped JSON send against `/v5.1/mail/send`, authenticated with a bare
 * `api_key` header rather than a bearer token. Recipients, cc, bcc and attachments hang
 * off one personalization, so the whole message goes out as a single envelope; `headers`
 * ride along as `x-apiheader`, which Netcore hands back on that message's webhook events.
 *
 * Netcore's send carries **one content block**: the HTML body is the message. A text-only
 * send goes out as that body, and a `text` alternative alongside HTML is dropped —
 * `auto_text` therefore buys nothing here. `scheduled_at` has no equivalent.
 *
 * @example
 * ```ts
 * import Netcore from "postboi/netcore"
 *
 * const mail = new Netcore({ api_key: NETCORE_API_KEY, default: { from: "no-reply@example.com" } })
 * await mail.send({ to: "contact@example.com", subject: "Hello", body: "<p>Hello world</p>" })
 * ```
 */
export default class Netcore extends ProviderBase<SendResponse> {
	protected readonly provider = "netcore"
	#api_key: string
	#url: string

	constructor({ api_key, region, ...options }: Options) {
		super(options)
		this.#api_key = api_key
		this.#url =
			region === "eu"
				? "https://apieu.netcorecloud.net/v5.1/mail/send"
				: "https://emailapi.netcorecloud.net/v5.1/mail/send"
	}

	protected async build_request(message: PreparedMessage): Promise<RequestSpec> {
		const personalization: Personalization = {
			to: this.email_name_list(message.to),
			cc: message.cc ? this.email_name_list(message.cc) : undefined,
			bcc: message.bcc ? this.email_name_list(message.bcc) : undefined,
			attachments: message.attachments
				? (await this.parse_attachments(message.attachments)).map((a) => ({
						name: a.name,
						content: a.content,
					}))
				: undefined,
			"x-apiheader": message.headers,
		}

		const params: SendParams = {
			from: this.email_name(this.parse_email_address(message.from)),
			subject: message.subject,
			content: [{ type: "html", value: message.html ?? message.text ?? "" }],
			personalizations: [personalization],
			reply_to: message.reply_to ? this.parse_addresses(message.reply_to)[0]?.address : undefined,
			tags: message.tags,
			settings: message.tracking
				? { open_track: message.tracking.opens, click_track: message.tracking.clicks }
				: undefined,
		}

		return {
			url: this.#url,
			headers: {
				api_key: this.#api_key,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(params),
		}
	}

	protected parse_response(_response: Response, data: unknown): SendResponse {
		return (data ?? {}) as SendResponse
	}

	/**
	 * Refusals are `{ status: "error", error: … }`, where `error` is sometimes an object,
	 * sometimes a list of field complaints and sometimes a bare string — so the shape is
	 * read rather than assumed, and the `status` alone is enough to fail the send.
	 */
	protected parse_error(_response: Response, data: unknown): ProviderError | undefined {
		if (data === null || typeof data !== "object") return undefined
		const e = data as Record<string, unknown>
		if (e.status !== "error") return undefined
		const detail = e.error ?? (e.data as Record<string, unknown> | undefined)?.message
		const message = detail_message(detail)
		return { message: message ?? "netcore rejected the send" }
	}
}

/** Flatten whatever Netcore put in `error` into one sentence. */
function detail_message(detail: unknown): string | undefined {
	if (typeof detail === "string") return detail
	if (Array.isArray(detail)) {
		const parts = detail.map((d) => detail_message(d)).filter((d): d is string => Boolean(d))
		return parts.length ? parts.join("; ") : undefined
	}
	if (detail && typeof detail === "object") {
		const d = detail as Record<string, unknown>
		const message = typeof d.message === "string" ? d.message : undefined
		const field = typeof d.field === "string" ? d.field : undefined
		if (message) return field ? `${field}: ${message}` : message
		return JSON.stringify(detail)
	}
	return undefined
}
