import { SesV2Provider, type SesV2Options } from "./ses_v2.js"

export type { SendParams } from "./ses_v2.js"

/** Options for the Amazon SES (v2) provider constructor. */
type Options = SesV2Options & {
	/** AWS access key ID. */
	access_key_id: string
	/** AWS secret access key. */
	secret_access_key: string
	/** AWS region, e.g. "us-east-1". */
	region: string
	/** Optional STS session token, for temporary credentials. */
	session_token?: string
}

/**
 * Amazon SES v2 SendEmail provider — https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html
 *
 * SES authenticates with AWS Signature Version 4 rather than a bearer token, so each
 * request is signed inline (no AWS SDK dependency). The payload itself lives in
 * `ses_v2.ts`, shared with Yandex Cloud Postbox — the other implementation of this API.
 *
 * @example
 * ```ts
 * import SES from "postboi/ses"
 *
 * const mail = new SES({
 *   access_key_id: AWS_ACCESS_KEY_ID,
 *   secret_access_key: AWS_SECRET_ACCESS_KEY,
 *   region: "us-east-1",
 *   default: { from: "no-reply@example.com" },
 * })
 * await mail.send({ to: "contact@example.com", subject: "Hello", body: "<p>Hello world</p>" })
 * ```
 */
export default class SES extends SesV2Provider {
	protected readonly provider = "ses"

	constructor(options: Options) {
		super(options)
	}

	protected host_for(region: string): string {
		return `email.${region}.amazonaws.com`
	}
}
