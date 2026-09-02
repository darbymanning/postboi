import type {
	WebhookAdapter,
	WebhookEvent,
	WebhookEventType,
	BounceDetail,
	AdapterModule,
} from "./index.js"
import { WebhookVerificationError } from "./errors.js"
import { parse_json, engagement, to_date, assert_fresh_timestamp } from "./shared.js"
import { hmac_sha256, hex_encode, timing_safe_equal } from "./crypto.js"

/**
 * Customer.io reporting webhook payload — https://docs.customer.io/integrations/api/webhooks/
 * One event per request: `{ event_id, object_type, metric, timestamp, data }`, where
 * `object_type` says which channel and `metric` what happened.
 */
interface CustomerioPayload {
	event_id?: string
	object_type?: string
	metric?: string
	timestamp?: number
	data?: {
		customer_id?: string
		delivery_id?: string
		identifiers?: { id?: string; email?: string; cio_id?: string }
		recipient?: string
		subject?: string
		/** clicked */
		href?: string
		link_id?: number
		/** bounced / dropped / failed */
		failure_message?: string
		reason?: string
		action_id?: number
		campaign_id?: number
		transactional_message_id?: number | string
		content_id?: number
	}
}

const METRICS: Record<string, WebhookEventType> = {
	sent: "sent",
	delivered: "delivered",
	deferred: "delayed",
	bounced: "bounced",
	undeliverable: "bounced",
	dropped: "failed",
	failed: "failed",
	spammed: "complained",
	opened: "opened",
	clicked: "clicked",
	unsubscribed: "unsubscribed",
}

function bounce(metric: string, data: NonNullable<CustomerioPayload["data"]>): BounceDetail {
	return {
		// `undeliverable` is Customer.io declining to send to an address it already knows is
		// bad; `bounced` is the receiving server saying so.
		category: metric === "undeliverable" ? "suppressed" : "hard",
		detail: data.failure_message ?? data.reason,
	}
}

/**
 * Customer.io webhook adapter. Verification is HMAC-SHA256 of `v0:{timestamp}:{body}`
 * with the reporting webhook's signing key, hex in `X-CIO-Signature` beside
 * `X-CIO-Timestamp`, which is checked against the clock for replay protection.
 */
const adapter: WebhookAdapter = {
	provider: "customerio",

	async verify(ctx) {
		if (!ctx.secret) {
			throw new WebhookVerificationError({
				provider: "customerio",
				message:
					"No webhook signing key configured for customerio. Set CUSTOMERIO_WEBHOOK_SECRET to the reporting webhook's signing key, or pass { secret }.",
				code: "missing_secret",
			})
		}
		const timestamp = ctx.headers.get("x-cio-timestamp")?.trim()
		const signature = ctx.headers.get("x-cio-signature")?.trim()
		if (!timestamp || !signature) {
			throw new WebhookVerificationError({
				provider: "customerio",
				message: "customerio webhook is missing its X-CIO-Signature or X-CIO-Timestamp header",
				code: "invalid_signature",
			})
		}
		assert_fresh_timestamp("customerio", timestamp)
		const expected = hex_encode(await hmac_sha256(ctx.secret, `v0:${timestamp}:${ctx.body}`))
		if (!timing_safe_equal(signature, expected)) {
			throw new WebhookVerificationError({
				provider: "customerio",
				message: "customerio webhook signature did not match",
				code: "invalid_signature",
			})
		}
	},

	normalize(body) {
		const payload = parse_json("customerio", body) as CustomerioPayload
		// Push, SMS, in-app and Slack deliveries report through the same webhook.
		if (payload.object_type && payload.object_type !== "email") return []
		const metric = payload.metric ?? ""
		const type = METRICS[metric]
		// `converted` and the customer.* metrics aren't delivery events.
		if (!type) return []
		const data = payload.data ?? {}
		const normalized: WebhookEvent = {
			type,
			provider: "customerio",
			// The delivery id `send()` returned.
			message_id: data.delivery_id,
			email: data.recipient ?? data.identifiers?.email,
			timestamp: to_date(payload.timestamp),
			subject: data.subject,
			url: type === "clicked" ? data.href : undefined,
			bounce: type === "bounced" ? bounce(metric, data) : undefined,
			raw: payload,
		}
		if (type === "opened" || type === "clicked") {
			// Customer.io reports neither the user-agent nor the address behind an open.
			Object.assign(normalized, engagement(undefined, undefined))
		}
		return [normalized]
	},
}

export default adapter

/** Build a realistic signed Customer.io sample request — used by `mock_request` and tests. */
export const mock: AdapterModule["mock"] = async ({ type, secret }) => {
	const metric = Object.entries(METRICS).find(([, t]) => t === type)?.[0] ?? "delivered"
	const now = Math.floor(Date.now() / 1000)
	const data: NonNullable<CustomerioPayload["data"]> = {
		customer_id: "customer_mock",
		delivery_id: "RPILAgUBcRhIBqSfeiIwdIYJKxTY",
		identifiers: { id: "customer_mock", email: "recipient@example.com", cio_id: "cio_mock" },
		recipient: "recipient@example.com",
		subject: "Mock subject",
		transactional_message_id: 3,
	}
	if (type === "clicked") {
		data.href = "https://example.com/pricing"
		data.link_id = 1
	}
	if (type === "bounced") data.failure_message = "550 5.1.1 User unknown"
	if (type === "failed") data.failure_message = "Recipient is on the suppression list"

	const body = JSON.stringify({
		event_id: "01E4C4CT6YDC7Y5M7FE1GWWPQJ",
		object_type: "email",
		metric,
		timestamp: now,
		data,
	})
	const signature = hex_encode(await hmac_sha256(secret, `v0:${now}:${body}`))
	return {
		body,
		headers: {
			"x-cio-signature": signature,
			"x-cio-timestamp": String(now),
			"x-cio-delivery-id": "delivery_mock",
			"content-type": "application/json",
		},
	}
}
