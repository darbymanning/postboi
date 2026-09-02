import type {
	WebhookAdapter,
	WebhookEvent,
	WebhookEventType,
	BounceDetail,
	AdapterModule,
} from "./index.js"
import { parse_json, engagement, to_date, shared_secret_verify } from "./shared.js"

/**
 * Postal webhook payload — https://docs.postalserver.io/developer/webhooks
 * One event per request: `{ event, timestamp, payload, uuid }`, with the message the
 * event is about under `payload.message` (or `payload.original_message` for a bounce).
 */
interface PostalMessage {
	id?: number
	token?: string
	direction?: string
	/** The Message-ID header — what `send()` returned as `data.message_id`. */
	message_id?: string
	to?: string
	from?: string
	subject?: string
	timestamp?: number
	spam_status?: string
	tag?: string
}

interface PostalPayload {
	event?: string
	timestamp?: number
	uuid?: string
	key?: string
	payload?: {
		message?: PostalMessage
		original_message?: PostalMessage
		bounce?: PostalMessage
		status?: string
		details?: string
		output?: string
		sent_with_ssl?: boolean
		time?: number
		/** clicks and opens */
		url?: string
		token?: string
		ip_address?: string
		user_agent?: string
	}
}

const TYPES: Record<string, WebhookEventType> = {
	MessageSent: "delivered",
	MessageDelayed: "delayed",
	MessageDeliveryFailed: "failed",
	MessageHeld: "failed",
	MessageBounced: "bounced",
	MessageLinkClicked: "clicked",
	MessageLoaded: "opened",
}

function bounce(payload: NonNullable<PostalPayload["payload"]>): BounceDetail {
	// A bounce message came back after the receiving server had accepted the mail —
	// Postal doesn't classify it, and the bounce's own subject is the best description.
	return { category: "unknown", detail: payload.bounce?.subject ?? payload.details }
}

/**
 * Postal webhook adapter. Postal signs each delivery with the server's DKIM key
 * (`X-Postal-Signature`), but a handler rarely has that public key to hand, so
 * verification here is the shared-secret pattern: a token in the webhook URL
 * (`?token=…`), compared timing-safe.
 */
const adapter: WebhookAdapter = {
	provider: "postal",

	verify(ctx) {
		shared_secret_verify("postal", ctx)
	},

	normalize(body) {
		const payload = parse_json("postal", body) as PostalPayload
		const type = payload.event ? TYPES[payload.event] : undefined
		// DomainDNSError isn't about a message.
		if (!type) return []
		const data = payload.payload ?? {}
		const message = data.original_message ?? data.message ?? {}
		const normalized: WebhookEvent = {
			type,
			provider: "postal",
			message_id: message.message_id,
			email: message.to,
			timestamp: to_date(payload.timestamp ?? message.timestamp),
			subject: message.subject,
			tags: message.tag ? [message.tag] : undefined,
			url: type === "clicked" ? data.url : undefined,
			bounce: type === "bounced" ? bounce(data) : undefined,
			raw: payload,
		}
		if (type === "opened" || type === "clicked") {
			Object.assign(normalized, engagement(data.user_agent, data.ip_address))
		}
		return [normalized]
	},
}

export default adapter

/** Build a realistic Postal sample request — used by `mock_request` and tests. */
export const mock: AdapterModule["mock"] = async ({ type, secret, url }) => {
	const postal_type = Object.entries(TYPES).find(([, t]) => t === type)?.[0] ?? "MessageSent"
	const now = Date.now() / 1000
	const message: PostalMessage = {
		id: 37171,
		token: "a4udnay1",
		direction: "outgoing",
		message_id: "6f4e8d4e-mock@rp.postal.example.com",
		to: "recipient@example.com",
		from: "mock@example.com",
		subject: "Mock subject",
		timestamp: now,
		spam_status: "NotSpam",
		tag: "welcome",
	}
	const data: NonNullable<PostalPayload["payload"]> = {}
	if (type === "bounced") {
		data.original_message = message
		data.bounce = { ...message, id: 37172, subject: "Undeliverable: Mock subject" }
	} else {
		data.message = message
	}
	if (type === "delivered" || type === "delayed" || type === "failed") {
		data.status = type === "delivered" ? "Sent" : type === "delayed" ? "SoftFail" : "HardFail"
		data.details =
			type === "delivered" ? "Message sent to mx.example.com" : "550 5.1.1 User unknown"
		data.output = "250 2.0.0 OK"
		data.sent_with_ssl = true
		data.time = 0.42
	}
	if (type === "opened" || type === "clicked") {
		data.token = "abcdef"
		data.ip_address = "192.0.2.1"
		data.user_agent =
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)"
	}
	if (type === "clicked") data.url = "https://example.com/pricing"

	const target = new URL(url)
	target.searchParams.set("token", secret)
	return {
		body: JSON.stringify({ event: postal_type, timestamp: now, payload: data, uuid: "uuid-mock" }),
		headers: { "content-type": "application/json" },
		url: target.href,
	}
}
