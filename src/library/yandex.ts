import { SesV2Provider, type SesV2Options } from "./ses_v2.js"

export type { SendParams } from "./ses_v2.js"

/** Options for the Yandex Cloud Postbox provider constructor. */
type Options = Omit<SesV2Options, "region"> & {
	/** Static access key ID from the service account. */
	access_key_id: string
	/** Static secret access key from the service account. */
	secret_access_key: string
	/** Cloud region. Defaults to "ru-central1", the only one Postbox runs in today. */
	region?: string
	/** Optional session token, for temporary credentials. */
	session_token?: string
}

/**
 * Yandex Cloud Postbox provider — https://yandex.cloud/en/docs/postbox/
 *
 * Postbox implements Amazon's SES v2 API on purpose — its own tutorials configure the AWS
 * SDKs with an endpoint override — so this is `postboi/ses` pointed at
 * `postbox.cloud.yandex.net` and signed for `ru-central1`. Everything SES supports here,
 * Postbox supports: cc, bcc, reply-to, both bodies, attachments, custom headers and tags.
 *
 * Credentials are a service account's **static access key** (the id and secret shown once
 * when you create it), and that account needs the `postbox.sender` role.
 *
 * @example
 * ```ts
 * import Postbox from "postboi/yandex"
 *
 * const mail = new Postbox({
 *   access_key_id: YANDEX_ACCESS_KEY_ID,
 *   secret_access_key: YANDEX_SECRET_ACCESS_KEY,
 *   default: { from: "no-reply@example.com" },
 * })
 * await mail.send({ to: "contact@example.com", subject: "Hello", body: "<p>Hello world</p>" })
 * ```
 */
export default class YandexPostbox extends SesV2Provider {
	protected readonly provider = "yandex"

	constructor({ region = "ru-central1", ...options }: Options) {
		super({ region, ...options })
	}

	// One endpoint for every region — the region rides in the signature's credential scope,
	// which is why it stays a constructor option rather than a constant.
	protected host_for(_region: string): string {
		return "postbox.cloud.yandex.net"
	}
}
