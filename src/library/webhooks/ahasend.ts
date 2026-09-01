import type {
	WebhookAdapter,
	WebhookEvent,
	WebhookEventType,
	BounceDetail,
	AdapterModule,
} from "./index.js"
import { WebhookVerificationError } from "./errors.js"
import { parse_json, engagement, to_date } from "./shared.js"
import { hmac_sha256, base64_encode, base64_decode, timing_safe_equal } from "./crypto.js"

/**
 * AhaSend webhook payload — https://ahasend.com/docs/api-reference/webhooks
 * One event per request: `{ type, webhook_id, timestamp, data }`.
 */
interface AhasendPayload {
	type?: string
	webhook_id?: string
	timestamp?: string
	data?: {
		account_id?: string
		event?: string
		id?: string
		/** The RFC 5322 Message-ID — what `send()` returned as each recipient's `id`. */
		message_id_header?: string
		recipient?: string
		from?: string
		subject?: string
		/** clicked / opened */
		url?: string
		user_agent?: string
		ip?: string
		/** bounced */
		bounce_classification?: string
		bounce_reason?: string
		/** transient_error / failed */
		reason?: string
		smtp_response?: string
	}
}

const TYPES: Record<string, WebhookEventType> = {
	"message.reception": "sent",
	"message.delivered": "delivered",
	"message.transient_error": "delayed",
	"message.failed": "failed",
	"message.bounced": "bounced",
	"message.suppressed": "bounced",
	"message.opened": "opened",
	"message.clicked": "clicked",
}

/** Allowed clock skew, in seconds — the standard-webhooks default. */
const TOLERANCE_S = 300

function bounce(type: string, data: NonNullable<AhasendPayload["data"]>): BounceDetail {
	if (type === "message.suppressed") {
		return { category: "suppressed", detail: data.reason ?? data.bounce_reason }
	}
	const kind = (data.bounce_classification ?? "").toLowerCase()
	return {
		category: /transient|soft|temporary/.test(kind)
			? "soft"
			: /permanent|hard|invalid|rejected/.test(kind)
				? "hard"
				: "unknown",
		detail: data.bounce_reason ?? data.reason,
	}
}

/**
 * The HMAC keys the configured secret could mean. AhaSend says the key is the literal
 * secret, `whsec_` prefix and all — the opposite of the standard-webhooks convention its
 * headers follow — so the literal reading comes first and the conventional ones (prefix
 * stripped, then base64-decoded) are tried too, in case that changes. Each is derived
 * from the one configured value, so accepting any gives away nothing.
 */
function key_candidates(secret: string): Array<Uint8Array | string> {
	const candidates: Array<Uint8Array | string> = [secret]
	if (secret.startsWith("whsec_")) {
		const stripped = secret.slice("whsec_".length)
		candidates.push(stripped)
		try {
			candidates.push(base64_decode(stripped))
		} catch {
			// not base64 — the string readings still stand
		}
	}
	return candidates
}

/**
 * AhaSend webhook adapter. Verification is the standard-webhooks scheme — HMAC-SHA256 of
 * `{id}.{timestamp}.{body}`, base64, one or more `v1,…` values in `webhook-signature`
 * beside `webhook-id` and `webhook-timestamp` — keyed with the literal secret.
 */
const adapter: WebhookAdapter = {
	provider: "ahasend",

	async verify(ctx) {
		if (!ctx.secret) {
			throw new WebhookVerificationError({
				provider: "ahasend",
				message:
					"No webhook secret configured for ahasend. Set AHASEND_WEBHOOK_SECRET to the webhook's secret, or pass { secret }.",
				code: "missing_secret",
			})
		}
		const id = ctx.headers.get("webhook-id")
		const timestamp = ctx.headers.get("webhook-timestamp")?.trim()
		const header = ctx.headers.get("webhook-signature")
		if (!id || !timestamp || !header) {
			throw new WebhookVerificationError({
				provider: "ahasend",
				message:
					"ahasend webhook is missing its webhook-id, webhook-timestamp or webhook-signature header",
				code: "invalid_signature",
			})
		}
		const seconds = Number(timestamp)
		const now = Math.floor(Date.now() / 1000)
		if (!Number.isFinite(seconds) || Math.abs(now - seconds) > TOLERANCE_S) {
			throw new WebhookVerificationError({
				provider: "ahasend",
				message: "ahasend webhook timestamp is outside the accepted tolerance (replay protection)",
				code: "stale_timestamp",
			})
		}
		const signatures = header
			.split(/\s+/)
			.map((part) => part.trim())
			.filter((part) => part.startsWith("v1,"))
			.map((part) => part.slice(3))
		const payload = `${id}.${timestamp}.${ctx.body}`
		const expected: Array<string> = []
		for (const secret of ctx.secret.split(/[\s,]+/).filter(Boolean)) {
			for (const key of key_candidates(secret)) {
				expected.push(base64_encode(await hmac_sha256(key, payload)))
			}
		}
		const ok = signatures.some((signature) =>
			expected.some((candidate) => timing_safe_equal(signature, candidate))
		)
		if (!ok) {
			throw new WebhookVerificationError({
				provider: "ahasend",
				message: "ahasend webhook signature did not match",
				code: "invalid_signature",
			})
		}
	},

	normalize(body) {
		const payload = parse_json("ahasend", body) as AhasendPayload
		const type = payload.type ? TYPES[payload.type] : undefined
		// suppression.* and domain.* aren't delivery events.
		if (!type) return []
		const data = payload.data ?? {}
		const normalized: WebhookEvent = {
			type,
			provider: "ahasend",
			message_id: data.message_id_header,
			email: data.recipient,
			timestamp: to_date(payload.timestamp),
			subject: data.subject,
			url: type === "clicked" ? data.url : undefined,
			bounce: type === "bounced" ? bounce(payload.type!, data) : undefined,
			raw: payload,
		}
		if (type === "opened" || type === "clicked") {
			Object.assign(normalized, engagement(data.user_agent, data.ip))
		}
		return [normalized]
	},
}

export default adapter

/** Build a realistic signed AhaSend sample request — used by `mock_request` and tests. */
export const mock: AdapterModule["mock"] = async ({ type, secret }) => {
	const ahasend_type = Object.entries(TYPES).find(([, t]) => t === type)?.[0] ?? "message.delivered"
	const now = new Date()
	const data: NonNullable<AhasendPayload["data"]> = {
		account_id: "acct_mock",
		event: ahasend_type.slice("message.".length),
		id: "evt_mock",
		message_id_header: "mock-message-id@example.com",
		recipient: "recipient@example.com",
		from: "mock@example.com",
		subject: "Mock subject",
	}
	if (type === "opened" || type === "clicked") {
		data.user_agent =
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)"
		data.ip = "192.0.2.1"
	}
	if (type === "clicked") data.url = "https://example.com/pricing"
	if (type === "bounced") {
		data.bounce_classification = "Permanent"
		data.bounce_reason = "550 5.1.1 User unknown"
	}
	if (type === "failed") data.reason = "Message expired after 3 days of retries"

	const body = JSON.stringify({
		type: ahasend_type,
		webhook_id: "abe11757-2886-4b55-96f1-0e0afc95795a",
		timestamp: now.toISOString(),
		data,
	})
	const id = "msg_mock"
	const timestamp = String(Math.floor(now.getTime() / 1000))
	// The literal secret is the key, as AhaSend documents.
	const signature = base64_encode(await hmac_sha256(secret, `${id}.${timestamp}.${body}`))
	return {
		body,
		headers: {
			"webhook-id": id,
			"webhook-timestamp": timestamp,
			"webhook-signature": `v1,${signature}`,
			"content-type": "application/json",
		},
	}
}
