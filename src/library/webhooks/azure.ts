import type {
	WebhookAdapter,
	WebhookEvent,
	WebhookEventType,
	BounceDetail,
	AdapterModule,
} from "./index.js"
import { parse_json, engagement, to_date, shared_secret_verify } from "./shared.js"

/**
 * Azure Communication Services email events, delivered by Event Grid —
 * https://learn.microsoft.com/azure/event-grid/communication-services-email-events
 * Every request is an array of Event Grid envelopes; the two email ones carry a delivery
 * report or an engagement (open/click) report in `data`.
 */
interface EventGridEnvelope {
	id?: string
	topic?: string
	subject?: string
	eventType?: string
	eventTime?: string
	dataVersion?: string
	data?: {
		/** validation handshake */
		validationCode?: string
		validationUrl?: string
		/** delivery report */
		sender?: string
		recipient?: string
		messageId?: string
		status?: string
		deliveryStatusDetails?: { statusMessage?: string }
		deliveryAttemptTimeStamp?: string
		/** engagement report */
		engagementType?: string
		engagementContext?: string
		userAgent?: string
		userActionTimeStamp?: string
	}
}

const DELIVERY = "Microsoft.Communication.EmailDeliveryReportReceived"
const ENGAGEMENT = "Microsoft.Communication.EmailEngagementTrackingReportReceived"
const VALIDATION = "Microsoft.EventGrid.SubscriptionValidationEvent"

/** Delivery report statuses → event types; `Expanded` (a group fan-out) is not one. */
const STATUSES: Record<string, WebhookEventType> = {
	delivered: "delivered",
	bounced: "bounced",
	suppressed: "bounced",
	quarantined: "failed",
	filteredspam: "failed",
	failed: "failed",
}

function bounce(status: string, data: NonNullable<EventGridEnvelope["data"]>): BounceDetail {
	return {
		// Azure only says Bounced once the address is bad, and Suppressed once it has been.
		category: status === "suppressed" ? "suppressed" : "hard",
		detail: data.deliveryStatusDetails?.statusMessage,
	}
}

/**
 * The validation URL of an Event Grid subscription handshake, checked to point at
 * Event Grid so a forged payload can't make us GET anywhere.
 */
function validation_url(envelope: EventGridEnvelope): string | undefined {
	if (envelope.eventType !== VALIDATION || !envelope.data?.validationUrl) return undefined
	try {
		const url = new URL(envelope.data.validationUrl)
		if (url.protocol !== "https:" || !url.hostname.endsWith(".eventgrid.azure.net")) {
			return undefined
		}
		return url.href
	} catch {
		return undefined
	}
}

/**
 * Azure Communication Services webhook adapter. Event Grid signs nothing itself;
 * verification is the shared-secret pattern (a `?token=…` on the subscription's
 * endpoint URL — Event Grid keeps query strings secret — compared timing-safe). The
 * subscription handshake is completed for you: Event Grid's validation event names a
 * URL to visit within five minutes, and `receive()` visits it and returns no events.
 */
const adapter: WebhookAdapter = {
	provider: "azure",

	verify(ctx) {
		shared_secret_verify("azure", ctx, ["aeg-subscription-name"])
	},

	async normalize(body) {
		const parsed = parse_json("azure", body)
		const envelopes = (Array.isArray(parsed) ? parsed : [parsed]) as Array<EventGridEnvelope>
		const events: Array<WebhookEvent> = []
		for (const envelope of envelopes) {
			const handshake = validation_url(envelope)
			if (handshake) {
				await fetch(handshake)
				continue
			}
			const data = envelope.data ?? {}
			if (envelope.eventType === DELIVERY) {
				const status = (data.status ?? "").toLowerCase()
				const type = STATUSES[status]
				if (!type) continue
				events.push({
					type,
					provider: "azure",
					// The operation id `send()` returned.
					message_id: data.messageId,
					email: data.recipient,
					timestamp: to_date(data.deliveryAttemptTimeStamp ?? envelope.eventTime),
					bounce: type === "bounced" ? bounce(status, data) : undefined,
					raw: envelope,
				})
			} else if (envelope.eventType === ENGAGEMENT) {
				const kind = (data.engagementType ?? "").toLowerCase()
				const type: WebhookEventType | undefined =
					kind === "view" ? "opened" : kind === "click" ? "clicked" : undefined
				if (!type) continue
				events.push({
					type,
					provider: "azure",
					message_id: data.messageId,
					// Engagement reports name the message and the sender, not the recipient.
					email: data.recipient,
					timestamp: to_date(data.userActionTimeStamp ?? envelope.eventTime),
					url: type === "clicked" ? data.engagementContext || undefined : undefined,
					...engagement(data.userAgent, undefined),
					raw: envelope,
				})
			}
		}
		return events
	},
}

export default adapter

/** Build a realistic Event Grid sample request — used by `mock_request` and tests. */
export const mock: AdapterModule["mock"] = async ({ type, secret, url }) => {
	const now = new Date()
	const message_id = "8540c0de-899f-5cce-acb5-3ec493af3800"
	const sender = "DoNotReply@example.com"
	let envelope: EventGridEnvelope
	if (type === "opened" || type === "clicked") {
		envelope = {
			id: "evt_mock",
			topic:
				"/subscriptions/mock/resourceGroups/mock/providers/microsoft.communication/communicationservices/mock",
			subject: `sender/${sender}/message/${message_id}`,
			eventType: ENGAGEMENT,
			eventTime: now.toISOString(),
			dataVersion: "1.0",
			data: {
				sender,
				messageId: message_id,
				userActionTimeStamp: now.toISOString(),
				engagementContext: type === "clicked" ? "https://example.com/pricing" : "",
				userAgent:
					"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)",
				engagementType: type === "clicked" ? "Click" : "View",
			},
		}
	} else {
		const status = type === "bounced" ? "Bounced" : type === "failed" ? "Failed" : "Delivered"
		envelope = {
			id: "evt_mock",
			topic:
				"/subscriptions/mock/resourceGroups/mock/providers/microsoft.communication/communicationservices/mock",
			subject: `sender/${sender}/message/${message_id}`,
			eventType: DELIVERY,
			eventTime: now.toISOString(),
			dataVersion: "1.0",
			data: {
				sender,
				recipient: "recipient@example.com",
				messageId: message_id,
				status,
				deliveryStatusDetails: {
					statusMessage: status === "Bounced" ? "550 5.1.1 User unknown" : "Status Message",
				},
				deliveryAttemptTimeStamp: now.toISOString(),
			},
		}
	}
	const target = new URL(url)
	target.searchParams.set("token", secret)
	return {
		body: JSON.stringify([envelope]),
		headers: { "content-type": "application/json", "aeg-event-type": "Notification" },
		url: target.href,
	}
}
