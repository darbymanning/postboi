/**
 * The SMS Works webhooks — delivery reports and inbound replies, for SMS.
 * https://thesmsworks.co.uk/developers
 *
 * Twilio is polled because its status callbacks are set per message, at send time. The
 * SMS Works is the other way round: delivery reports go to one account-wide URL
 * (Delivery Reports → Webhook Configuration, or `deliveryreporturl` on a send), so the
 * intended path is the one every email provider in this directory already takes —
 * point the URL at `receive()`.
 *
 * There is no signature. Verification is the shared-secret pattern: a `?token=…` on the
 * URL you paste in, holding the same value as `SMSWORKS_WEBHOOK_SECRET` (or the
 * basic-auth password, where a webhook offers one), compared timing-safe. That is
 * weaker than an HMAC and the docs say so rather than glossing it; their published
 * source addresses are a second check a deployment can add in front.
 *
 * One handler takes both webhooks. A delivery report is a message with a `status`. An
 * inbound reply — a reply-number or keyword webhook — is `messagetype: "incoming"`, and
 * it is read for one thing: a reply that is an opt-out keyword (see `is_opt_out`) is an
 * `unsubscribed` event for the number that sent it. Everything else somebody texts
 * back stays theirs to read; a conversation is not a delivery event, which is the same
 * line the Twilio poll draws.
 */
import type { WebhookAdapter, WebhookEvent, WebhookEventType, AdapterModule } from "./index.js"
import type { BounceDetail } from "./index.js"
import { parse_json, to_date, shared_secret_verify } from "./shared.js"
import { is_opt_out } from "../sms/opt_out.js"

/** Why a message didn't (or hasn't yet) arrived — `permanent` is the classification. */
interface FailureReason {
	code?: number | string
	details?: string
	permanent?: boolean
}

/**
 * A delivery report, which is the message object itself with its current `status`.
 * Only the fields read here are typed; `raw` carries the rest (credits, parts, the
 * echoed `metadata`, …).
 */
interface DeliveryReport {
	messageid?: string
	/** Set on messages sent through `/batch/*` — the id `send()` returned for those. */
	batchid?: string
	status?: string
	/** The recipient, as digits without a `+` — and as a JSON number in their example. */
	destination?: string | number
	sender?: string
	created?: string
	modified?: string
	tag?: string
	failurereason?: FailureReason | null
}

/** An inbound message from a reply-number or keyword webhook. */
interface InboundMessage {
	messagetype?: string
	messageid?: string
	content?: string
	/** The person replying — digits, no `+`. */
	from?: string | number
	to?: string | number
	/** The send they are replying to, when The SMS Works can tell. */
	outboundmessageid?: string
}

type Payload = DeliveryReport & InboundMessage

/**
 * Delivery-report status → normalized event. `SCHEDULED` is the provider holding the
 * message, not something that happened to it, so it is never emitted. A `SENT` that
 * carries a *temporary* failure reason is the carrier still trying (for up to 48 hours)
 * — the same fact as an email deferral, so it is `delayed` rather than `sent`.
 */
const TYPES: Record<string, WebhookEventType> = {
	SENT: "sent",
	DELIVERED: "delivered",
	UNDELIVERABLE: "failed",
	REJECTED: "failed",
	EXPIRED: "failed",
}

/** `447700900123` (a number or a string, with or without a `+`) → `+447700900123`. */
function e164(value: string | number | undefined): string | undefined {
	if (value === undefined || value === null) return undefined
	const digits = String(value).replace(/\D/g, "")
	return digits ? `+${digits}` : undefined
}

/**
 * The failure as a bounce detail. Unlike Twilio, The SMS Works *does* classify: its
 * `permanent` flag is exactly the hard/soft split, so it maps rather than staying
 * "unknown". The carrier's own code and words go in `detail`, the field consumers
 * already read for "why didn't this arrive".
 */
function bounce(reason: FailureReason | null | undefined): BounceDetail {
	const code = reason?.code ?? undefined
	const text = reason?.details ?? undefined
	const detail = code && text ? `${code} ${text}` : (text ?? (code ? String(code) : undefined))
	return {
		category:
			reason?.permanent === true ? "hard" : reason?.permanent === false ? "soft" : "unknown",
		detail,
	}
}

/**
 * One inbound reply as an event — `unsubscribed` for an opt-out keyword, nothing for
 * anything else. The number is the *sender's*: they are the one opting out. The id is
 * the reply's own, as the Twilio poll does; `outboundmessageid` stays in `raw`.
 */
function normalize_inbound(payload: Payload): WebhookEvent | undefined {
	if (!is_opt_out(payload.content)) return undefined
	return {
		type: "unsubscribed",
		provider: "smsworks",
		channel: "sms",
		phone: e164(payload.from),
		message_id: payload.messageid,
		raw: payload,
	}
}

/** One delivery report as an event — or nothing, for a status we don't emit. */
function normalize_report(payload: Payload): WebhookEvent | undefined {
	const status = payload.status?.toUpperCase()
	let type = status ? TYPES[status] : undefined
	if (!type) return undefined
	const reason = payload.failurereason ?? undefined
	if (type === "sent" && reason?.permanent === false) type = "delayed"
	return {
		type,
		provider: "smsworks",
		channel: "sms",
		phone: e164(payload.destination),
		message_id: payload.messageid,
		// `modified` is when the status last changed, which is when this happened.
		timestamp: to_date(payload.modified ?? payload.created),
		tags: payload.tag ? [payload.tag] : undefined,
		bounce: type === "failed" || type === "delayed" ? bounce(reason) : undefined,
		raw: payload,
	}
}

const adapter: WebhookAdapter = {
	provider: "smsworks",

	verify(ctx) {
		shared_secret_verify("smsworks", ctx)
	},

	normalize(body) {
		const payload = parse_json("smsworks", body) as Payload
		const event =
			payload.messagetype === "incoming" ? normalize_inbound(payload) : normalize_report(payload)
		return event ? [event] : []
	},
}

export default adapter

/** Build an SMS Works sample request, authenticated with the ?token= shared secret. */
export const mock: AdapterModule["mock"] = async ({ type, secret, url }) => {
	const now = new Date().toISOString()
	// The number is from Ofcom's drama range (07700 900xxx), which is never allocated.
	const report: Payload = {
		messageid: "d87e93c0-fa08-4903-becd-aeb5b0ab3b6a",
		batchid: "",
		destination: 447700900123,
		sender: "POSTBOI",
		created: now,
		modified: now,
		tag: "otp",
	}
	const samples: Partial<Record<WebhookEventType, Payload>> = {
		sent: { ...report, status: "SENT" },
		delivered: { ...report, status: "DELIVERED" },
		delayed: {
			...report,
			status: "SENT",
			failurereason: {
				code: 3001,
				details: "Handset unreachable: switched off or out of coverage, retrying",
				permanent: false,
			},
		},
		failed: {
			...report,
			status: "UNDELIVERABLE",
			failurereason: {
				code: 5001,
				details: "Handset Error: Number does not exist or has not been assigned to a user.",
				permanent: true,
			},
		},
		// The one inbound sample: the person at +44 7700 900123 texting STOP back to the
		// reply number — so the addresses swap around, and the number is theirs.
		unsubscribed: {
			messagetype: "incoming",
			messageid: "328827210622192878142",
			content: "STOP",
			from: "447700900123",
			to: "447700900456",
			outboundmessageid: report.messageid,
		},
	}
	const target = new URL(url)
	target.searchParams.set("token", secret)
	return {
		body: JSON.stringify(samples[type] ?? samples.delivered),
		headers: { "content-type": "application/json" },
		url: target.href,
	}
}
