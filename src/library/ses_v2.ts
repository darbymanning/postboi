/**
 * The SES v2 `SendEmail` wire format — the payload, the SigV4 signing and the answer
 * shape — shared by every provider that speaks it.
 *
 * Amazon's is not the only one: Yandex Cloud Postbox implements the same API deliberately,
 * so its SDKs are AWS's with an endpoint override. What differs between them is a host and
 * a region, which is exactly what {@link SesV2Provider.host_for} and the constructor take.
 * Everything else — how attachments, headers and tags are shaped, which bodies go where,
 * how a refusal is recognised — is one implementation, so a fix to it can't reach one
 * provider and miss the other.
 *
 * Internal: not part of the public surface. `postboi/ses` and `postboi/yandex` are.
 */
import type { PreparedMessage, CommonProviderOptions, ProviderError, RequestSpec } from "./index.js"
import { ProviderBase } from "./index.js"
// SigV4 signing lives in aws.ts so SNS (SMS) can reuse it — the service name is the only
// thing that differs, and it's baked into both the scope and the key derivation.
import { sign_aws_request } from "./aws.js"

/** Constructor options common to every SES v2 endpoint. */
export type SesV2Options = CommonProviderOptions & {
	/** Access key ID. */
	access_key_id: string
	/** Secret access key. */
	secret_access_key: string
	/** Region, e.g. "us-east-1" (Amazon) or "ru-central1" (Yandex). */
	region: string
	/** Optional session token, for temporary credentials. */
	session_token?: string
}

interface Attachment {
	RawContent: string
	FileName: string
	ContentType: string
	ContentDisposition: "ATTACHMENT"
}

export interface SendParams {
	FromEmailAddress: string
	Destination: {
		ToAddresses: Array<string>
		CcAddresses?: Array<string>
		BccAddresses?: Array<string>
	}
	ReplyToAddresses?: Array<string>
	Content: {
		Simple: {
			Subject: { Data: string }
			Body: { Html?: { Data: string }; Text?: { Data: string } }
			Headers?: Array<{ Name: string; Value: string }>
			Attachments?: Array<Attachment>
		}
	}
	EmailTags?: Array<{ Name: string; Value: string }>
}

export type SendResponse = { MessageId: string }

/** The `SendEmail` path, identical on every implementation of the API. */
const PATH = "/v2/email/outbound-emails"

/**
 * Base class for the SES v2 providers. A subclass supplies its `provider` id and the host
 * its region resolves to; the signing service stays `ses` because that is what the
 * credential scope says on both.
 */
export abstract class SesV2Provider extends ProviderBase<SendResponse> {
	#access_key_id: string
	#secret_access_key: string
	#session_token?: string
	#region: string
	#host: string

	constructor({
		access_key_id,
		secret_access_key,
		region,
		session_token,
		...options
	}: SesV2Options) {
		super(options)
		this.#access_key_id = access_key_id
		this.#secret_access_key = secret_access_key
		this.#session_token = session_token
		this.#region = region
		this.#host = this.host_for(region)
	}

	/**
	 * The API host this region's requests go to. Called from the constructor, so it must
	 * answer from its argument alone — no subclass fields exist yet.
	 */
	protected abstract host_for(region: string): string

	protected async build_request(message: PreparedMessage): Promise<RequestSpec> {
		const params: SendParams = {
			FromEmailAddress: this.stringify_address(this.parse_email_address(message.from)),
			Destination: {
				ToAddresses: this.parse_addresses(message.to).map((a) => this.stringify_address(a)),
				CcAddresses: message.cc
					? this.parse_addresses(message.cc).map((a) => this.stringify_address(a))
					: undefined,
				BccAddresses: message.bcc
					? this.parse_addresses(message.bcc).map((a) => this.stringify_address(a))
					: undefined,
			},
			ReplyToAddresses: message.reply_to
				? this.parse_addresses(message.reply_to).map((a) => this.stringify_address(a))
				: undefined,
			Content: {
				Simple: {
					Subject: { Data: message.subject },
					Body: {
						Html: message.html ? { Data: message.html } : undefined,
						Text: message.text ? { Data: message.text } : undefined,
					},
					Headers: message.headers
						? Object.entries(message.headers).map(([Name, Value]) => ({ Name, Value }))
						: undefined,
					Attachments: message.attachments
						? (await this.parse_attachments(message.attachments)).map((a) => ({
								RawContent: a.content,
								FileName: a.name,
								ContentType: a.mime_type,
								ContentDisposition: "ATTACHMENT" as const,
							}))
						: undefined,
				},
			},
			EmailTags: message.tags?.map((t, i) => ({ Name: `tag${i}`, Value: t })),
		}

		const body = JSON.stringify(params)
		return {
			url: `https://${this.#host}${PATH}`,
			headers: await this.#sign(body),
			body,
		}
	}

	/** Build SigV4-signed headers for a POST of `body` to the endpoint. */
	async #sign(body: string): Promise<Record<string, string>> {
		return sign_aws_request(
			body,
			{
				service: "ses",
				region: this.#region,
				host: this.#host,
				path: PATH,
				access_key_id: this.#access_key_id,
				secret_access_key: this.#secret_access_key,
				session_token: this.#session_token,
			},
			this.provider
		)
	}

	protected parse_response(_response: Response, data: unknown): SendResponse {
		return data as SendResponse
	}

	protected parse_error(response: Response, data: unknown): ProviderError | undefined {
		if (data === null || typeof data !== "object") return undefined
		const e = data as Record<string, unknown>
		// Errors come back as { message } (sometimes { Message }) with the type in a header.
		const message = (e.message ?? e.Message) as string | undefined
		if (typeof message !== "string" || "MessageId" in e) return undefined
		const type = response.headers.get("x-amzn-errortype") ?? undefined
		// Header form is "BadRequestException:" or "BadRequestException:http://..." — keep the name.
		return { message, code: type?.split(/[:;]/)[0] || undefined }
	}
}
