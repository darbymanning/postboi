import type {
	WebhookAdapter,
	WebhookEvent,
	WebhookEventType,
	BounceDetail,
	AdapterModule,
} from "./index.js"
import { parse_json, engagement, to_date, svix_adapter_verify } from "./shared.js"
import { hmac_sha256, base64_encode, whsec_key_candidates } from "./crypto.js"

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
 * AhaSend webhook adapter. The standard-webhooks scheme — `webhook-id`,
 * `webhook-timestamp` and `webhook-signature` headers, HMAC-SHA256 of
 * `{id}.{timestamp}.{body}` — with one twist: AhaSend says the key is the literal secret,
 * `whsec_` prefix and all, the opposite of the convention its headers follow. So the
 * shared verifier runs with every reading of the secret — literal first, then prefix
 * stripped, then base64-decoded — in case that changes; each is derived from the one
 * configured value, so accepting any gives away nothing.
 */
const adapter: WebhookAdapter = {
	provider: "ahasend",

	verify(ctx) {
		return svix_adapter_verify("ahasend", ctx, "webhook", whsec_key_candidates)
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
