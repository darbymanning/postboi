import type { PreparedMessage, CommonProviderOptions, ProviderError, RequestSpec } from "./index.js"
import { ProviderBase } from "./index.js"
import { hmac_sha1 } from "./crypto.js"
import { base64_encode } from "./encoding.js"

/** Options for the Alibaba Cloud Direct Mail provider constructor. */
type Options = CommonProviderOptions & {
	/** Access key ID of the RAM user or account. */
	access_key_id: string
	/** Access key secret. */
	access_key_secret: string
	/**
	 * The region the Direct Mail account lives in — `"cn-hangzhou"` (the default,
	 * `dm.aliyuncs.com`), `"ap-southeast-1"`, `"ap-southeast-2"`, `"eu-central-1"`, … A
	 * sender address is only valid in the region it was verified in.
	 */
	region?: string
	/**
	 * Sender address type: `1` (the default) sends from the address `from` names, `0` from
	 * a random account on the same domain — which is what Direct Mail recommends for bulk.
	 */
	address_type?: 0 | 1
}

type SendResponse = { EnvId?: string; RequestId?: string }

/** Direct Mail's API version. Fixed: the parameter set is versioned with it. */
const VERSION = "2015-11-23"

/**
 * Percent-encoding as Alibaba's signature defines it: everything but `A-Za-z0-9-_.~`
 * escaped. `encodeURIComponent` leaves `!'()*` alone, so those are finished by hand —
 * miss them and a subject with an apostrophe signs correctly and is rejected.
 */
function percent_encode(value: string): string {
	return encodeURIComponent(value).replace(
		/[!'()*]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
	)
}

/**
 * Alibaba Cloud Direct Mail provider — https://www.alibabacloud.com/help/en/direct-mail
 *
 * `SingleSendMail` over Alibaba's RPC protocol: form-encoded parameters signed with
 * HMAC-SHA1 (`SignatureVersion` 1.0), which is why there is no bearer token here. Up to
 * **100 recipients** per send, and Direct Mail gives each of them their own copy — so with
 * no cc or bcc of its own, `cc` and `bcc` addresses simply join the recipient list.
 *
 * The sender is `from`: its address is the `AccountName` (which must be a sender address
 * verified in the Direct Mail console, in this region) and its display name the
 * `FromAlias`. `tags` become `TagName` (the first one), and `tracking: { clicks }` sets
 * `ClickTrace`. Direct Mail's send has no attachments — that is the SMTP interface only —
 * and no `headers`, `scheduled_at` or open tracking, so those are dropped.
 *
 * @example
 * ```ts
 * import DirectMail from "postboi/alibaba"
 *
 * const mail = new DirectMail({
 *   access_key_id: ALIBABA_CLOUD_ACCESS_KEY_ID,
 *   access_key_secret: ALIBABA_CLOUD_ACCESS_KEY_SECRET,
 *   region: "ap-southeast-1",
 *   default: { from: "no-reply@example.com" },
 * })
 * await mail.send({ to: "contact@example.com", subject: "Hello", body: "<p>Hello world</p>" })
 * ```
 */
export default class AlibabaDirectMail extends ProviderBase<SendResponse> {
	protected readonly provider = "alibaba"
	#access_key_id: string
	#access_key_secret: string
	#region: string
	#address_type: 0 | 1
	#host: string

	constructor({ access_key_id, access_key_secret, region, address_type, ...options }: Options) {
		super(options)
		this.#access_key_id = access_key_id
		this.#access_key_secret = access_key_secret
		this.#region = region || "cn-hangzhou"
		this.#address_type = address_type ?? 1
		this.#host =
			this.#region === "cn-hangzhou" ? "dm.aliyuncs.com" : `dm.${this.#region}.aliyuncs.com`
	}

	protected async build_request(message: PreparedMessage): Promise<RequestSpec> {
		const from = this.parse_email_address(message.from)
		const reply_to = message.reply_to ? this.parse_addresses(message.reply_to)[0] : undefined
		// Every address on the envelope is a recipient here: Direct Mail has no cc or bcc.
		const recipients = [
			...this.parse_addresses(message.to),
			...(message.cc ? this.parse_addresses(message.cc) : []),
			...(message.bcc ? this.parse_addresses(message.bcc) : []),
		]

		const params: Record<string, string> = {
			Action: "SingleSendMail",
			AccountName: from.address,
			AddressType: String(this.#address_type),
			ReplyToAddress: reply_to ? "true" : "false",
			ToAddress: recipients.map((a) => a.address).join(","),
			Subject: message.subject,
		}
		if (from.name) params.FromAlias = from.name
		if (message.html) params.HtmlBody = message.html
		if (message.text) params.TextBody = message.text
		if (reply_to) {
			params.ReplyAddress = reply_to.address
			if (reply_to.name) params.ReplyAddressAlias = reply_to.name
		}
		if (message.tags?.length) params.TagName = message.tags[0]
		if (message.tracking?.clicks !== undefined) {
			params.ClickTrace = message.tracking.clicks ? "1" : "0"
		}

		return {
			url: `https://${this.#host}/`,
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: await this.#sign(params),
		}
	}

	/**
	 * Sign the call and return the form body.
	 *
	 * Alibaba's RPC scheme: sort every parameter by name, percent-encode each side of each
	 * pair, join with `&`, then sign `POST&%2F&<that, percent-encoded again>` with
	 * HMAC-SHA1 keyed by the secret plus a trailing `&`. The signature joins the same
	 * parameters in the body, so the canonical string and what is actually posted are the
	 * one encoding rather than two that must agree.
	 */
	async #sign(params: Record<string, string>): Promise<string> {
		const all: Record<string, string> = {
			...params,
			Format: "JSON",
			Version: VERSION,
			RegionId: this.#region,
			AccessKeyId: this.#access_key_id,
			SignatureMethod: "HMAC-SHA1",
			SignatureVersion: "1.0",
			SignatureNonce: crypto.randomUUID(),
			// Seconds precision, UTC: Direct Mail rejects the milliseconds ISO strings carry.
			Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
		}

		const canonical = Object.keys(all)
			.sort()
			.map((key) => `${percent_encode(key)}=${percent_encode(all[key])}`)
			.join("&")
		const string_to_sign = `POST&${percent_encode("/")}&${percent_encode(canonical)}`
		const signature = base64_encode(await hmac_sha1(`${this.#access_key_secret}&`, string_to_sign))
		return `${canonical}&Signature=${percent_encode(signature)}`
	}

	protected parse_response(_response: Response, data: unknown): SendResponse {
		return (data ?? {}) as SendResponse
	}

	// Refusals are `{ Code, Message, RequestId, HostId }` — an accepted send carries EnvId.
	protected parse_error(_response: Response, data: unknown): ProviderError | undefined {
		if (data === null || typeof data !== "object") return undefined
		const e = data as Record<string, unknown>
		if ("EnvId" in e || typeof e.Code !== "string") return undefined
		return {
			message: typeof e.Message === "string" ? e.Message : `alibaba answered ${e.Code}`,
			code: e.Code,
		}
	}
}
