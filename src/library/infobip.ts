import type { PreparedMessage, ApiKeyOptions, ProviderError, RequestSpec } from "./index.js"
import { ProviderBase } from "./index.js"

/** Options for the Infobip provider constructor. */
type Options = ApiKeyOptions & {
	/** Your account's API host from the dashboard, e.g. `xxxxx.api.infobip.com`. */
	base_url: string
}

type SendResponse = {
	bulkId?: string
	messages: Array<{
		to: string
		messageId: string
		status: { groupId: number; groupName: string; id: number; name: string; description: string }
	}>
}

/**
 * Infobip provider — https://www.infobip.com/docs/api/channels/email/send-email
 *
 * Infobip's email send is multipart form data rather than JSON, on your account's own
 * API host, authenticated with `Authorization: App …`. Addresses go as `Name <email>`
 * fields (one `to` field per recipient), both bodies, a single `replyTo`, custom
 * `headers` as a JSON field, attachments as file parts, `scheduled_at` as `sendAt` and
 * per-send `tracking` as `trackOpens` / `trackClicks`. `tags` have no equivalent and are
 * dropped. The answer is one status per recipient; a rejection of them all is an error.
 *
 * @example
 * ```ts
 * import Infobip from "postboi/infobip"
 *
 * const mail = new Infobip({
 *   api_key: INFOBIP_API_KEY,
 *   base_url: INFOBIP_BASE_URL,
 *   default: { from: "no-reply@example.com" },
 * })
 * await mail.send({ to: "contact@example.com", subject: "Hello", body: "<p>Hello world</p>" })
 * ```
 */
export default class Infobip extends ProviderBase<SendResponse> {
	protected readonly provider = "infobip"
	#api_key: string
	#url: string

	constructor({ api_key, base_url, ...options }: Options) {
		super(options)
		this.#api_key = api_key
		const host = base_url.replace(/^https?:\/\//i, "").replace(/\/+$/, "")
		this.#url = `https://${host}/email/3/send`
	}

	protected async build_request(message: PreparedMessage): Promise<RequestSpec> {
		const form = new FormData()
		form.append("from", this.stringify_address(this.parse_email_address(message.from)))
		for (const a of this.parse_addresses(message.to)) form.append("to", this.stringify_address(a))
		if (message.cc) {
			for (const a of this.parse_addresses(message.cc)) form.append("cc", this.stringify_address(a))
		}
		if (message.bcc) {
			for (const a of this.parse_addresses(message.bcc))
				form.append("bcc", this.stringify_address(a))
		}
		form.append("subject", message.subject)
		if (message.text) form.append("text", message.text)
		if (message.html) form.append("html", message.html)
		if (message.reply_to) {
			form.append("replyTo", this.stringify_address(this.parse_addresses(message.reply_to)[0]))
		}
		if (message.headers && Object.keys(message.headers).length) {
			form.append("headers", JSON.stringify(message.headers))
		}
		if (message.attachments) {
			const files = Array.isArray(message.attachments) ? message.attachments : [message.attachments]
			for (const file of files) form.append("attachment", file, file.name)
		}
		if (message.tracking?.opens !== undefined) {
			form.append("trackOpens", String(message.tracking.opens))
		}
		if (message.tracking?.clicks !== undefined) {
			form.append("trackClicks", String(message.tracking.clicks))
		}
		if (message.scheduled_at) form.append("sendAt", message.scheduled_at.toISOString())

		return {
			url: this.#url,
			// No Content-Type: fetch writes the multipart boundary itself.
			headers: {
				Authorization: `App ${this.#api_key}`,
				Accept: "application/json",
			},
			body: form,
		}
	}

	protected parse_response(_response: Response, data: unknown): SendResponse {
		return data as SendResponse
	}

	// Request errors are `{ requestError: { serviceException: { messageId, text } } }`;
	// a 200 whose every recipient was REJECTED is a refusal too.
	protected parse_error(_response: Response, data: unknown): ProviderError | undefined {
		if (data === null || typeof data !== "object") return undefined
		const e = data as Record<string, unknown>
		const request_error = e.requestError as Record<string, unknown> | undefined
		const exception = request_error?.serviceException as Record<string, unknown> | undefined
		if (exception) {
			return {
				message:
					typeof exception.text === "string" ? exception.text : "infobip rejected the request",
				code: typeof exception.messageId === "string" ? exception.messageId : undefined,
			}
		}
		if (Array.isArray(e.messages) && e.messages.length) {
			const statuses = (e.messages as Array<Record<string, unknown>>).map(
				(m) => (m.status ?? {}) as Record<string, unknown>
			)
			if (statuses.every((s) => s.groupName === "REJECTED")) {
				const first = statuses[0]
				return {
					message:
						typeof first.description === "string"
							? first.description
							: "infobip rejected every recipient",
					code: typeof first.name === "string" ? first.name : undefined,
				}
			}
		}
		return undefined
	}
}
