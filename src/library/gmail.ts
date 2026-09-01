import type { PreparedMessage, CommonProviderOptions, ProviderError, RequestSpec } from "./index.js"
import { ProviderBase, PostboiError } from "./index.js"
import { pem_to_der, to_base64url } from "./encoding.js"
import { cached_token } from "./push/oauth.js"
import { compose_mime } from "./mime.js"

/** Options for the Gmail provider constructor. */
type Options = CommonProviderOptions & {
	/** Service-account email (`client_email` in the JSON key file). */
	client_email?: string
	/** Service-account private key (`private_key` in the JSON key file), PEM. */
	private_key?: string
	/**
	 * The mailbox to send as, through domain-wide delegation. Defaults to the `from`
	 * address of each send, which is what it almost always is.
	 */
	user?: string
	/**
	 * A ready OAuth access token with the `gmail.send` scope, for when you mint your own
	 * (a user's consent flow rather than a service account). With this set, the service
	 * account is not needed.
	 */
	access_token?: string
}

type SendResponse = {
	/** Gmail's message id — also what its Sent folder and the Users.messages API key by. */
	id: string
	threadId?: string
	labelIds?: Array<string>
}

const SCOPE = "https://www.googleapis.com/auth/gmail.send"

/**
 * Gmail API provider — https://developers.google.com/gmail/api/reference/rest/v1/users.messages/send
 *
 * Sends as a Google Workspace mailbox, the counterpart of the Microsoft 365 provider: a
 * service account with domain-wide delegation mints a short-lived token for the `from`
 * mailbox (the JWT exchange is cached, as FCM's is), and the message goes up as one
 * RFC 5322 blob in `raw` — the same MIME the SMTP provider writes, `Bcc` header
 * included, which Gmail reads and strips. Everything a MIME message can carry does:
 * addresses with names, both bodies, every reply-to, attachments and custom `headers`.
 * `tags`, `scheduled_at` and `tracking` have no equivalent and are dropped.
 *
 * @example
 * ```ts
 * import Gmail from "postboi/gmail"
 *
 * const mail = new Gmail({
 *   client_email: GMAIL_CLIENT_EMAIL,
 *   private_key: GMAIL_PRIVATE_KEY,
 *   default: { from: "no-reply@example.com" },
 * })
 * await mail.send({ to: "contact@example.com", subject: "Hello", body: "<p>Hello world</p>" })
 * ```
 */
export default class Gmail extends ProviderBase<SendResponse> {
	protected readonly provider = "gmail"
	#client_email?: string
	#private_key?: string
	#user?: string
	#access_token?: string

	constructor({ client_email, private_key, user, access_token, ...options }: Options) {
		super(options)
		if (!access_token && !(client_email && private_key)) {
			throw new PostboiError({
				provider: "gmail",
				code: "missing_credentials",
				message:
					"Gmail needs a service account (client_email + private_key, with domain-wide delegation) or an access_token.",
			})
		}
		this.#client_email = client_email
		// Env files often hold the PEM with literal "\n" — Google's own SDKs unescape it too.
		this.#private_key = private_key?.replace(/\\n/g, "\n")
		this.#user = user || undefined
		this.#access_token = access_token || undefined
	}

	/** The bearer token for `subject`'s mailbox — a live cached one, or a fresh exchange. */
	async #token(subject: string): Promise<string> {
		if (this.#access_token) return this.#access_token
		const now = Date.now()
		return cached_token(`gmail:${this.#client_email}:${subject}`, now, () =>
			this.#exchange(subject, now)
		)
	}

	/** Sign a service-account JWT for `subject` and trade it for an access token. */
	async #exchange(subject: string, now: number): Promise<{ value: string; expires_in: number }> {
		const encoder = new TextEncoder()
		const issued = Math.floor(now / 1000)
		const header = to_base64url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })))
		const payload = to_base64url(
			encoder.encode(
				JSON.stringify({
					iss: this.#client_email,
					sub: subject,
					scope: SCOPE,
					aud: "https://oauth2.googleapis.com/token",
					iat: issued,
					exp: issued + 3600,
				})
			)
		)
		const signing_input = `${header}.${payload}`
		const key = await crypto.subtle.importKey(
			"pkcs8",
			pem_to_der(this.#private_key!),
			{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
			false,
			["sign"]
		)
		const signature = await crypto.subtle.sign(
			"RSASSA-PKCS1-v1_5",
			key,
			encoder.encode(signing_input)
		)
		const assertion = `${signing_input}.${to_base64url(new Uint8Array(signature))}`

		const response = await fetch("https://oauth2.googleapis.com/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
				assertion,
			}),
		})
		const data = (await response.json().catch(() => undefined)) as
			| { access_token?: string; expires_in?: number; error?: string; error_description?: string }
			| undefined
		if (!response.ok || !data?.access_token) {
			throw new PostboiError({
				provider: this.provider,
				status: response.status,
				message: data?.error_description ?? "Failed to obtain a Gmail access token",
				code: data?.error,
				raw: data,
			})
		}
		return { value: data.access_token, expires_in: data.expires_in ?? 3600 }
	}

	protected async build_request(message: PreparedMessage): Promise<RequestSpec> {
		const from = this.parse_email_address(message.from)
		const token = await this.#token(this.#user ?? from.address)

		const raw = compose_mime({
			from,
			to: this.parse_addresses(message.to),
			cc: message.cc ? this.parse_addresses(message.cc) : undefined,
			bcc: message.bcc ? this.parse_addresses(message.bcc) : undefined,
			reply_to: message.reply_to ? this.parse_addresses(message.reply_to) : undefined,
			subject: message.subject,
			html: message.html,
			text: message.text,
			attachments: message.attachments
				? await this.parse_attachments(message.attachments)
				: undefined,
			headers: message.headers,
		})

		return {
			url: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ raw: to_base64url(new TextEncoder().encode(raw)) }),
		}
	}

	protected parse_response(_response: Response, data: unknown): SendResponse {
		return data as SendResponse
	}

	// Google's error envelope: `{ error: { code, message, status } }`.
	protected parse_error(_response: Response, data: unknown): ProviderError | undefined {
		if (data === null || typeof data !== "object") return undefined
		const error = (data as Record<string, unknown>).error as Record<string, unknown> | undefined
		if (error && typeof error.message === "string") {
			return {
				message: error.message,
				code: typeof error.status === "string" ? error.status : undefined,
			}
		}
		return undefined
	}
}
