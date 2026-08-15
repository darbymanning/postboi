import { webhook } from "postboi/kit"

// The point of this app is that only postboi.config.ts changes between providers — and
// that holds here too: Resend, Postmark, Mailgun, SES and the rest all deliver their
// webhook events to this same handler, normalized to one shape, signatures verified.
// Set your provider's <PROVIDER>_WEBHOOK_SECRET in .env and point it at POST /webhooks.
export const POST = webhook(async (event) => {
	console.log(`${event.type} — ${event.email ?? ""} (${event.provider})`)
})
