import type { WebhookAdapter, WebhookEventType, AdapterModule } from "./index.js"
import { WebhookVerificationError } from "./errors.js"
import { parse_json, engagement, to_date } from "./shared.js"
import { hmac_sha256, hex_encode, timing_safe_equal } from "./crypto.js"

/** Unosend webhook payload — https://docs.unosend.co/guides/webhooks */
interface UnosendPayload {
	id?: string
	type?: string
	created_at?: string
	data?: {
		email_id?: string
		from?: string
		to?: string | Array<string>
		subject?: string
		tags?: Record<string, string> | Array<{ name?: string; value?: string }>
		/** clicked */
		link?: string
		user_agent?: string
		ip_address?: string
		/** bounced */
		bounce_type?: string
		bounce_reason?: string
	}
}

const TYPES: Record<string, WebhookEventType> = {
	"email.sent": "sent",
	"email.delivered": "delivered",
	"email.opened": "opened",
	"email.clicked": "clicked",
	"email.bounced": "bounced",
	"email.complained": "complained",
}

function tag_names(tags: NonNullable<UnosendPayload["data"]>["tags"]): Array<string> | undefined {
	if (!tags) return undefined
	const names = Array.isArray(tags)
		? tags.map((t) => t.name).filter((n): n is string => Boolean(n))
		: Object.keys(tags)
	return names.length ? names : undefined
}

/**
 * Unosend webhook adapter. Verification is HMAC-SHA256 (hex) of the raw body with the
 * endpoint's `whsec_…` signing secret, carried as `X-Unosend-Signature: sha256=…`.
 */
const adapter: WebhookAdapter = {
	provider: "unosend",

	async verify(ctx) {
		if (!ctx.secret) {
			throw new WebhookVerificationError({
				provider: "unosend",
				message:
					"No webhook signing secret configured for unosend. Set UNOSEND_WEBHOOK_SECRET to the endpoint's whsec_… secret, or pass { secret }.",
				code: "missing_secret",
			})
		}
		const signature = ctx.headers.get("x-unosend-signature")?.replace(/^sha256=/, "")
		const expected = hex_encode(await hmac_sha256(ctx.secret, ctx.body))
		if (!signature || !timing_safe_equal(signature, expected)) {
			throw new WebhookVerificationError({
				provider: "unosend",
				message: "unosend webhook signature did not match",
				code: "invalid_signature",
			})
		}
	},

	normalize(body) {
		const payload = parse_json("unosend", body) as UnosendPayload
		const type = payload.type ? TYPES[payload.type] : undefined
		if (!type) return []
		const data = payload.data ?? {}
		return [
			{
				type,
				provider: "unosend",
				message_id: data.email_id,
				email: Array.isArray(data.to) ? data.to[0] : data.to,
				timestamp: to_date(payload.created_at),
				subject: data.subject,
				tags: tag_names(data.tags),
				url: type === "clicked" ? data.link : undefined,
				bounce:
					type === "bounced"
						? {
								category:
									data.bounce_type === "hard"
										? "hard"
										: data.bounce_type === "soft"
											? "soft"
											: "unknown",
								detail: data.bounce_reason,
							}
						: undefined,
				...engagement(data.user_agent, data.ip_address),
				raw: payload,
			},
		]
	},
}

export default adapter

/** Build a realistic signed Unosend sample request — used by `mock_request` and tests. */
export const mock: AdapterModule["mock"] = async ({ type, secret }) => {
	const unosend_type = Object.entries(TYPES).find(([, t]) => t === type)?.[0] ?? "email.delivered"
	const data: NonNullable<UnosendPayload["data"]> = {
		email_id: "mock-email-id",
		from: "mock@example.com",
		to: "recipient@example.com",
		subject: "Mock subject",
		tags: { welcome: "welcome" },
	}
	if (type === "opened" || type === "clicked") {
		data.ip_address = "192.0.2.1"
		data.user_agent =
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)"
	}
	if (type === "clicked") data.link = "https://example.com/pricing"
	if (type === "bounced") {
		data.bounce_type = "hard"
		data.bounce_reason = "User unknown"
	}

	const body = JSON.stringify({
		id: "evt_mock",
		type: unosend_type,
		created_at: new Date().toISOString(),
		data,
	})
	const signature = hex_encode(await hmac_sha256(secret, body))
	return {
		body,
		headers: { "x-unosend-signature": `sha256=${signature}`, "content-type": "application/json" },
	}
}
