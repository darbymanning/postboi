import type { WebhookAdapter, WebhookEventType, AdapterModule } from "./index.js"
import { parse_json, engagement, to_date, svix_adapter_verify } from "./shared.js"
import { hmac_sha256, base64_encode, base64_decode } from "./crypto.js"

/**
 * Loops webhook payload — https://loops.so/docs/webhooks
 * One event per request: `eventName`, a unix `eventTime`, the contact it concerns and
 * the email it was about.
 */
interface LoopsPayload {
	eventName?: string
	eventTime?: number | string
	webhookSchemaVersion?: string
	sourceType?: string
	campaignId?: string
	loopId?: string
	transactionalId?: string
	contactIdentity?: { id?: string; email?: string; userId?: string | null }
	email?: {
		id?: string
		emailMessageId?: string
		subject?: string
		/** clicked — the field name isn't documented, so several readings are tried. */
		link?: string
		url?: string
		clickedLink?: string
		userAgent?: string
		ipAddress?: string
		/** bounced */
		reason?: string
		bounceReason?: string
	}
	link?: string
	url?: string
	userAgent?: string
	ipAddress?: string
	reason?: string
}

const TYPES: Record<string, WebhookEventType> = {
	"campaign.email.sent": "sent",
	"loop.email.sent": "sent",
	"transactional.email.sent": "sent",
	"email.sent": "sent",
	"email.delivered": "delivered",
	"email.softBounced": "bounced",
	"email.hardBounced": "bounced",
	"email.opened": "opened",
	"email.clicked": "clicked",
	"email.unsubscribed": "unsubscribed",
	"email.spamReported": "complained",
}

/**
 * Loops webhook adapter. Loops signs with the standard-webhooks scheme — `webhook-id`,
 * `webhook-timestamp` and `webhook-signature` headers, a `whsec_…` secret — the same
 * one the Postboi provider uses, so verification is shared.
 */
const adapter: WebhookAdapter = {
	provider: "loops",

	verify(ctx) {
		return svix_adapter_verify("loops", ctx, "webhook")
	},

	normalize(body) {
		const payload = parse_json("loops", body) as LoopsPayload
		const type = payload.eventName ? TYPES[payload.eventName] : undefined
		// contact.*, mailingList.* and email.resubscribed aren't delivery events.
		if (!type) return []
		const email = payload.email ?? {}
		const url = email.link ?? email.url ?? email.clickedLink ?? payload.link ?? payload.url
		const user_agent = email.userAgent ?? payload.userAgent
		const ip = email.ipAddress ?? payload.ipAddress
		return [
			{
				type,
				provider: "loops",
				// Loops' send answers with no id of its own, so the email record's id is the
				// only handle — the same one every later event about it carries.
				message_id: email.id,
				email: payload.contactIdentity?.email,
				timestamp: to_date(payload.eventTime),
				subject: email.subject,
				url: type === "clicked" ? url : undefined,
				bounce:
					type === "bounced"
						? {
								category: payload.eventName === "email.hardBounced" ? "hard" : "soft",
								detail: email.reason ?? email.bounceReason ?? payload.reason,
							}
						: undefined,
				...(type === "opened" || type === "clicked" ? engagement(user_agent, ip) : {}),
				raw: payload,
			},
		]
	},
}

export default adapter

/** Build a realistic signed Loops sample request — used by `mock_request` and tests. */
export const mock: AdapterModule["mock"] = async ({ type, secret }) => {
	const loops_type =
		type === "sent"
			? "transactional.email.sent"
			: type === "bounced"
				? "email.hardBounced"
				: (Object.entries(TYPES).find(([, t]) => t === type)?.[0] ?? "email.delivered")
	const now = new Date()
	const email: NonNullable<LoopsPayload["email"]> = {
		id: "cm4t1sseg004tje7982991nan",
		emailMessageId: "cm4ittv1v001oow9hruou8na8",
		subject: "Mock subject",
	}
	if (type === "opened" || type === "clicked") {
		email.userAgent =
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)"
		email.ipAddress = "192.0.2.1"
	}
	if (type === "clicked") email.link = "https://example.com/pricing"
	if (type === "bounced") email.reason = "User unknown"

	const body = JSON.stringify({
		eventName: loops_type,
		eventTime: Math.floor(now.getTime() / 1000),
		webhookSchemaVersion: "1.0.0",
		sourceType: "transactional",
		transactionalId: "clx0000000000000000000000",
		email,
		contactIdentity: {
			id: "cm4ittmhq0011ow9h6fb460yw",
			email: "recipient@example.com",
			userId: null,
		},
	})

	const id = "msg_mock"
	const timestamp = String(Math.floor(now.getTime() / 1000))
	const key = base64_decode(secret.replace(/^whsec_/, ""))
	const signature = base64_encode(await hmac_sha256(key, `${id}.${timestamp}.${body}`))
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
