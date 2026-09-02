import type { WebhookAdapter, WebhookEventType, BounceDetail, AdapterModule } from "./index.js"
import { PostboiError } from "../index.js"
import { engagement, to_date, shared_secret_verify } from "./shared.js"

/**
 * SMTP2GO webhook payload — https://developers.smtp2go.com/docs/webhooks-overview
 * One event per request, JSON or form-encoded (both are read). Field names are
 * SMTP2GO's own, hyphens included.
 */
interface Smtp2goPayload {
	event?: string
	time?: string
	sendtime?: string
	sender?: string
	from?: string
	from_address?: string
	rcpt?: string
	recipients?: string | Array<string>
	email_id?: string
	subject?: string
	/** bounce / reject */
	message?: string
	bounce?: string
	host?: string
	/** open / click */
	"user-agent"?: string
	url?: string
	link?: string
	srchost?: string
	ip?: string
	"message-id"?: string
}

const TYPES: Record<string, WebhookEventType> = {
	processed: "sent",
	delivered: "delivered",
	open: "opened",
	click: "clicked",
	bounce: "bounced",
	spam: "complained",
	unsubscribe: "unsubscribed",
	reject: "failed",
}

function bounce(payload: Smtp2goPayload): BounceDetail {
	const kind = (payload.bounce ?? "").toLowerCase()
	return {
		category: kind === "hard" ? "hard" : kind === "soft" ? "soft" : "unknown",
		detail: payload.message,
	}
}

/**
 * SMTP2GO's `time` / `sendtime` are `YYYY-MM-DD HH:MM:SS` in UTC with no zone marker —
 * which `Date` would read as local time — so the marker is put back before parsing.
 */
function utc(value: string | undefined): Date | undefined {
	if (value && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
		return to_date(`${value.replace(" ", "T")}Z`)
	}
	return to_date(value)
}

/** JSON or `application/x-www-form-urlencoded` — SMTP2GO offers both. */
function parse_body(body: string): Smtp2goPayload {
	const trimmed = body.trim()
	if (trimmed.startsWith("{")) {
		try {
			return JSON.parse(trimmed) as Smtp2goPayload
		} catch {
			// fall through to the form reading
		}
	}
	if (/^[^=&\s]+=/.test(trimmed)) {
		return Object.fromEntries(new URLSearchParams(trimmed)) as Smtp2goPayload
	}
	throw new PostboiError({
		provider: "smtp2go",
		message: "smtp2go webhook payload is neither JSON nor form-encoded",
		code: "invalid_payload",
		raw: body,
	})
}

/**
 * SMTP2GO webhook adapter. SMTP2GO signs nothing, so verification is the shared-secret
 * pattern: a token in the webhook URL (`?token=…`) or basic-auth credentials in it,
 * compared timing-safe.
 */
const adapter: WebhookAdapter = {
	provider: "smtp2go",

	verify(ctx) {
		shared_secret_verify("smtp2go", ctx)
	},

	normalize(body) {
		const payload = parse_body(body)
		const type = payload.event ? TYPES[payload.event] : undefined
		// resubscribe and the sms_* events aren't email delivery events.
		if (!type) return []
		const recipient =
			payload.rcpt ??
			(Array.isArray(payload.recipients) ? payload.recipients[0] : payload.recipients)
		return [
			{
				type,
				provider: "smtp2go",
				message_id: payload.email_id,
				email: recipient,
				timestamp: utc(payload.time ?? payload.sendtime),
				subject: payload.subject,
				url: type === "clicked" ? (payload.url ?? payload.link) : undefined,
				bounce: type === "bounced" ? bounce(payload) : undefined,
				...(type === "opened" || type === "clicked"
					? engagement(payload["user-agent"], payload.ip ?? payload.srchost)
					: {}),
				raw: payload,
			},
		]
	},
}

export default adapter

/** Build a realistic SMTP2GO sample request — used by `mock_request` and tests. */
export const mock: AdapterModule["mock"] = async ({ type, secret, url }) => {
	const smtp2go_type = Object.entries(TYPES).find(([, t]) => t === type)?.[0] ?? "delivered"
	const now = new Date().toISOString().replace("T", " ").slice(0, 19)
	const payload: Smtp2goPayload = {
		event: smtp2go_type,
		time: now,
		sendtime: now,
		sender: "mock@example.com",
		from: "Mock <mock@example.com>",
		rcpt: "recipient@example.com",
		email_id: "1a2b3c4d-mock",
		subject: "Mock subject",
		"message-id": "<mock@example.com>",
	}
	if (type === "opened" || type === "clicked") {
		payload["user-agent"] =
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)"
		payload.ip = "192.0.2.1"
	}
	if (type === "clicked") payload.url = "https://example.com/pricing"
	if (type === "bounced") {
		payload.bounce = "hard"
		payload.message = "550 5.1.1 User unknown"
		payload.host = "mx.example.com"
	}
	const target = new URL(url)
	target.searchParams.set("token", secret)
	return {
		body: JSON.stringify(payload),
		headers: { "content-type": "application/json" },
		url: target.href,
	}
}
