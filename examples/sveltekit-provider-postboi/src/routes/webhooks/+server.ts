import { webhook } from "postboi/kit"

// Provider delivery events — delivered, opened, clicked, bounced — with the signature
// verified and the payload normalized before your handler runs. `webhook()` answers
// 200/401/400/500 the way providers expect, and SNS handshakes confirm themselves.
//
// Point your provider's webhook at POST /webhooks and set the provider's
// <PROVIDER>_WEBHOOK_SECRET in .env. Swap email providers and this file doesn't change —
// the events arrive in the same shape from all of them.
export const POST = webhook(async (event) => {
	switch (event.type) {
		case "bounced":
			console.log(`${event.email} bounced (${event.bounce?.category}): ${event.bounce?.detail}`)
			break

		case "opened":
			console.log(`${event.email} opened "${event.subject}" in ${event.client?.name}`)
			break

		default:
			console.log(`${event.type} — ${event.email}`)
	}
})
