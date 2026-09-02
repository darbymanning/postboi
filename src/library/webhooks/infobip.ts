import type {
	WebhookAdapter,
	WebhookEvent,
	WebhookEventType,
	BounceDetail,
	AdapterModule,
} from "./index.js"
import { parse_json, to_date, shared_secret_verify } from "./shared.js"

/**
 * Infobip email delivery report — https://www.infobip.com/docs/api/channels/email/email-webhooks
 * Every request carries a `results` array, one report per message, each with a
 * `status` group and (on failure) an `error` group.
 */
interface InfobipGroup {
	groupId?: number
	groupName?: string
	id?: number
	name?: string
	description?: string
	permanent?: boolean
}

interface InfobipResult {
	bulkId?: string
	messageId?: string
	to?: string
	sentAt?: string
	doneAt?: string
	messageCount?: number
	status?: InfobipGroup
	error?: InfobipGroup
	channel?: string
}

interface InfobipPayload {
	results?: Array<InfobipResult>
}

const GROUPS: Record<string, WebhookEventType> = {
	DELIVERED: "delivered",
	UNDELIVERABLE: "bounced",
	REJECTED: "failed",
	EXPIRED: "failed",
	PENDING: "delayed",
}

function bounce(result: InfobipResult): BounceDetail {
	const error = result.error
	return {
		category: error?.permanent === true ? "hard" : error?.permanent === false ? "soft" : "unknown",
		detail: error?.description ?? error?.name ?? result.status?.description,
	}
}

/**
 * Infobip webhook adapter. Infobip signs nothing, so verification is the shared-secret
 * pattern: a token in the notify URL (`?token=…`), compared timing-safe.
 */
const adapter: WebhookAdapter = {
	provider: "infobip",

	verify(ctx) {
		shared_secret_verify("infobip", ctx)
	},

	normalize(body) {
		const payload = parse_json("infobip", body) as InfobipPayload
		const events: Array<WebhookEvent> = []
		for (const result of payload.results ?? []) {
			if (result.channel && result.channel.toUpperCase() !== "EMAIL") continue
			const group = (result.status?.groupName ?? "").toUpperCase()
			const type = GROUPS[group]
			if (!type) continue
			events.push({
				type,
				provider: "infobip",
				message_id: result.messageId,
				email: result.to,
				timestamp: to_date(result.doneAt ?? result.sentAt),
				bounce: type === "bounced" ? bounce(result) : undefined,
				raw: result,
			})
		}
		return events
	},
}

export default adapter

/** Build a realistic Infobip sample request — used by `mock_request` and tests. */
export const mock: AdapterModule["mock"] = async ({ type, secret, url }) => {
	const group = Object.entries(GROUPS).find(([, t]) => t === type)?.[0] ?? "DELIVERED"
	const now = new Date().toISOString()
	const result: InfobipResult = {
		bulkId: "bulk_mock",
		messageId: "mock-message-id",
		to: "recipient@example.com",
		sentAt: now,
		doneAt: now,
		messageCount: 1,
		channel: "EMAIL",
		status:
			group === "DELIVERED"
				? {
						groupId: 3,
						groupName: "DELIVERED",
						id: 5,
						name: "DELIVERED_TO_HANDSET",
						description: "Message delivered to handset",
					}
				: group === "UNDELIVERABLE"
					? {
							groupId: 5,
							groupName: "UNDELIVERABLE",
							id: 9,
							name: "UNDELIVERABLE_NOT_DELIVERED",
							description: "Message sent not delivered",
						}
					: {
							groupId: 2,
							groupName: group,
							id: 6,
							name: group,
							description: `Message ${group.toLowerCase()}`,
						},
		error:
			group === "UNDELIVERABLE"
				? {
						groupId: 1,
						groupName: "HANDSET_ERRORS",
						id: 1,
						name: "EC_UNKNOWN_SUBSCRIBER",
						description: "Unknown Subscriber",
						permanent: true,
					}
				: {
						groupId: 0,
						groupName: "OK",
						id: 0,
						name: "NO_ERROR",
						description: "No Error",
						permanent: false,
					},
	}
	const target = new URL(url)
	target.searchParams.set("token", secret)
	return {
		body: JSON.stringify({ results: [result] }),
		headers: { "content-type": "application/json" },
		url: target.href,
	}
}
