import type {
	WebhookAdapter,
	WebhookEvent,
	WebhookEventType,
	BounceDetail,
	AdapterModule,
} from "./index.js"
import { parse_json, engagement, to_date, shared_secret_verify } from "./shared.js"

/**
 * SendPulse SMTP webhook payload — https://sendpulse.com/knowledge-base/smtp/smtp-webhooks
 * Events arrive batched in an array (every 30 seconds or 500 events). Most name the
 * recipient as `recipient`; the bounce events name it `email` and carry the SMTP reply.
 */
interface SendpulsePayload {
	event?: string
	timestamp?: number
	message_id?: number | string
	task_id?: number
	recipient?: string
	email?: string
	sender?: string
	subject?: string
	smtp_server_response_code?: number | string
	smtp_server_response_subcode?: string
	smtp_server_response?: string
	/** clicked */
	link_url?: string
	url?: string
	user_agent?: string
	ip?: string
}

const TYPES: Record<string, WebhookEventType> = {
	new: "sent",
	delivered: "delivered",
	undelivered: "bounced",
	soft_bounces: "bounced",
	hard_bounces: "bounced",
	opened: "opened",
	clicked: "clicked",
	redirected: "clicked",
	unsubscribed: "unsubscribed",
	spam_by_user: "complained",
}

function bounce(payload: SendpulsePayload): BounceDetail {
	const code = String(payload.smtp_server_response_code ?? "")
	const category =
		payload.event === "hard_bounces"
			? "hard"
			: payload.event === "soft_bounces"
				? "soft"
				: code.startsWith("5")
					? "hard"
					: code.startsWith("4")
						? "soft"
						: "unknown"
	const detail = [code, payload.smtp_server_response_subcode, payload.smtp_server_response]
		.filter(Boolean)
		.join(" ")
	return { category, detail: detail || undefined }
}

/**
 * SendPulse webhook adapter. SendPulse signs nothing, so verification is the
 * shared-secret pattern: a token in the webhook URL (`?token=…`), compared timing-safe.
 */
const adapter: WebhookAdapter = {
	provider: "sendpulse",

	verify(ctx) {
		shared_secret_verify("sendpulse", ctx)
	},

	normalize(body) {
		const parsed = parse_json("sendpulse", body)
		const payloads = (Array.isArray(parsed) ? parsed : [parsed]) as Array<SendpulsePayload>
		const events: Array<WebhookEvent> = []
		for (const payload of payloads) {
			const type = payload.event ? TYPES[payload.event] : undefined
			// resubscribed isn't a delivery event.
			if (!type) continue
			const message_id =
				payload.message_id !== undefined && payload.message_id !== ""
					? String(payload.message_id)
					: undefined
			const normalized: WebhookEvent = {
				type,
				provider: "sendpulse",
				message_id,
				email: payload.recipient ?? payload.email,
				timestamp: to_date(payload.timestamp),
				subject: payload.subject || undefined,
				url: type === "clicked" ? (payload.link_url ?? payload.url) : undefined,
				bounce: type === "bounced" ? bounce(payload) : undefined,
				raw: payload,
			}
			if (type === "opened" || type === "clicked") {
				Object.assign(normalized, engagement(payload.user_agent, payload.ip))
			}
			events.push(normalized)
		}
		return events
	},
}

export default adapter

/** Build a realistic SendPulse sample request — used by `mock_request` and tests. */
export const mock: AdapterModule["mock"] = async ({ type, secret, url }) => {
	const sendpulse_type = Object.entries(TYPES).find(([, t]) => t === type)?.[0] ?? "delivered"
	const payload: SendpulsePayload = {
		event: sendpulse_type,
		timestamp: Math.floor(Date.now() / 1000),
		message_id: 1149317311,
		recipient: "recipient@example.com",
		sender: "mock@example.com",
		subject: "Mock subject",
	}
	if (type === "delivered") {
		payload.smtp_server_response_code = "250"
		payload.smtp_server_response = "250 2.0.0 OK"
	}
	if (type === "bounced") {
		payload.event = "undelivered"
		payload.smtp_server_response_code = "550"
		payload.smtp_server_response_subcode = "5.1.1"
		payload.smtp_server_response = "Recipient address rejected: User unknown"
	}
	if (type === "opened" || type === "clicked") {
		payload.user_agent =
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)"
		payload.ip = "192.0.2.1"
	}
	if (type === "clicked") payload.link_url = "https://example.com/pricing"
	const target = new URL(url)
	target.searchParams.set("token", secret)
	return {
		body: JSON.stringify([payload]),
		headers: { "content-type": "application/json" },
		url: target.href,
	}
}
