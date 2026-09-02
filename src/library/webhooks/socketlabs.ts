import type {
	WebhookAdapter,
	WebhookEvent,
	WebhookEventType,
	BounceDetail,
	AdapterModule,
} from "./index.js"
import { WebhookVerificationError } from "./errors.js"
import { parse_json, engagement, to_date } from "./shared.js"
import { timing_safe_equal } from "./crypto.js"

/**
 * SocketLabs event webhook payload — https://help.socketlabs.com/docs/event-webhooks-data-attributes
 * One event per request. `Type` says what happened; `Tracking` events split further on
 * `TrackingType`.
 */
interface SocketlabsPayload {
	Type?: string
	DateTime?: string
	ServerId?: number
	ServerID?: number
	SecretKey?: string
	/** The endpoint handshake: echo this back and the endpoint is live. */
	ValidationKey?: string
	Address?: string
	FromAddress?: string
	Subject?: string
	MessageId?: string
	MessageID?: string
	MailingId?: string
	MailingID?: string
	/** Delivered */
	Response?: string
	RemoteMta?: string
	/** Failed / Deferred */
	Reason?: string
	FailureType?: string
	FailureCode?: number
	DeferralCode?: number
	BounceStatus?: string
	DiagnosticCode?: string
	/** Tracking */
	TrackingType?: number
	UserAgent?: string
	ClientIp?: string
	ClientIP?: string
	Url?: string
	URL?: string
	/** Complaint */
	FblType?: string
	Data?: { Meta?: unknown; Tags?: Array<string> }
}

const TYPES: Record<string, WebhookEventType> = {
	Queued: "sent",
	Deferred: "delayed",
	Delivered: "delivered",
	Failed: "bounced",
	Complaint: "complained",
}

/** `TrackingType` — 0 is a click, 1 an open, 2 an unsubscribe. */
const TRACKING: Record<number, WebhookEventType> = {
	0: "clicked",
	1: "opened",
	2: "unsubscribed",
}

function bounce(payload: SocketlabsPayload): BounceDetail {
	const kind = (payload.FailureType ?? "").toLowerCase()
	return {
		category:
			kind === "permanent"
				? "hard"
				: kind === "temporary"
					? "soft"
					: kind === "suppressed"
						? "suppressed"
						: "unknown",
		detail: payload.DiagnosticCode ?? payload.Reason,
	}
}

/**
 * SocketLabs webhook adapter. SocketLabs signs nothing; every notification instead
 * carries the endpoint's `SecretKey` in the body, compared timing-safe against the
 * configured secret. The endpoint handshake — a `Validation` notification whose
 * `ValidationKey` must be echoed back — is answered by the `webhook()` handler for you.
 */
const adapter: WebhookAdapter = {
	provider: "socketlabs",

	verify(ctx) {
		if (!ctx.secret) {
			throw new WebhookVerificationError({
				provider: "socketlabs",
				message:
					"No webhook secret configured for socketlabs. Set SOCKETLABS_WEBHOOK_SECRET to the endpoint's secret key, or pass { secret }.",
				code: "missing_secret",
			})
		}
		let key: unknown
		try {
			key = (JSON.parse(ctx.body) as SocketlabsPayload)?.SecretKey
		} catch {
			key = undefined
		}
		if (typeof key !== "string" || !timing_safe_equal(key, ctx.secret)) {
			throw new WebhookVerificationError({
				provider: "socketlabs",
				message: "socketlabs webhook secret key did not match",
				code: "invalid_signature",
			})
		}
	},

	normalize(body) {
		const payload = parse_json("socketlabs", body) as SocketlabsPayload
		let type: WebhookEventType | undefined
		if (payload.Type === "Tracking") {
			type = payload.TrackingType !== undefined ? TRACKING[payload.TrackingType] : undefined
		} else if (payload.Type) {
			type = TYPES[payload.Type]
		}
		// Validation is the handshake, not an event.
		if (!type) return []
		const normalized: WebhookEvent = {
			type,
			provider: "socketlabs",
			message_id: payload.MessageId ?? payload.MessageID,
			email: payload.Address,
			timestamp: to_date(payload.DateTime),
			subject: payload.Subject,
			tags: payload.Data?.Tags?.length ? payload.Data.Tags : undefined,
			url: type === "clicked" ? (payload.Url ?? payload.URL) : undefined,
			bounce: type === "bounced" ? bounce(payload) : undefined,
			raw: payload,
		}
		if (type === "opened" || type === "clicked") {
			Object.assign(normalized, engagement(payload.UserAgent, payload.ClientIp ?? payload.ClientIP))
		}
		return [normalized]
	},

	respond(body) {
		let payload: SocketlabsPayload
		try {
			payload = JSON.parse(body) as SocketlabsPayload
		} catch {
			return undefined
		}
		if (payload.Type !== "Validation" || typeof payload.ValidationKey !== "string") return undefined
		return new Response(JSON.stringify({ ValidationKey: payload.ValidationKey }), {
			status: 200,
			headers: { "content-type": "application/json" },
		})
	},
}

export default adapter

/** Build a realistic SocketLabs sample request — used by `mock_request` and tests. */
export const mock: AdapterModule["mock"] = async ({ type, secret }) => {
	const payload: SocketlabsPayload = {
		Type: "Delivered",
		DateTime: new Date().toISOString(),
		ServerId: 12345,
		SecretKey: secret,
		Address: "recipient@example.com",
		FromAddress: "mock@example.com",
		Subject: "Mock subject",
		MessageId: "mock-message-id",
		MailingId: "welcome",
		Data: { Tags: ["welcome"] },
	}
	if (type === "opened" || type === "clicked" || type === "unsubscribed") {
		payload.Type = "Tracking"
		payload.TrackingType = type === "clicked" ? 0 : type === "opened" ? 1 : 2
		payload.UserAgent =
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)"
		payload.ClientIp = "192.0.2.1"
		if (type === "clicked") payload.Url = "https://example.com/pricing"
	} else if (type === "bounced") {
		payload.Type = "Failed"
		payload.FailureType = "Permanent"
		payload.FailureCode = 1010
		payload.Reason = "550 5.1.1 User unknown"
		payload.DiagnosticCode = "smtp; 550 5.1.1 User unknown"
	} else if (type === "delivered") {
		payload.Response = "250 2.0.0 Ok: queued as mock"
		payload.RemoteMta = "mx.example.com"
	} else {
		const wire = Object.entries(TYPES).find(([, t]) => t === type)?.[0]
		if (wire) payload.Type = wire
		if (type === "delayed") {
			payload.DeferralCode = 4001
			payload.Reason = "451 4.7.1 Try again later"
		}
	}
	return { body: JSON.stringify(payload), headers: { "content-type": "application/json" } }
}
