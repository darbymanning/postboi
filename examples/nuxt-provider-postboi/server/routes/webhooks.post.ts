import { receive, WebhookVerificationError } from "postboi/webhooks"

// Provider delivery events on a Nitro server route. h3's `toWebRequest` hands
// `receive()` the web Request it wants — signature verification needs the raw bytes,
// and this conversion preserves them. Point your provider's webhook at POST /webhooks
// and set <PROVIDER>_WEBHOOK_SECRET in .env.
export default defineEventHandler(async (event) => {
	try {
		const events = await receive(toWebRequest(event))
		for (const delivery of events) {
			console.log(`${delivery.type} — ${delivery.email ?? ""}`)
		}
		return { received: events.length }
	} catch (error) {
		// A failed signature is a 401 so the provider knows the endpoint rejected it.
		if (error instanceof WebhookVerificationError) {
			throw createError({ statusCode: 401, statusMessage: "bad signature" })
		}
		throw createError({ statusCode: 400, statusMessage: "unparseable payload" })
	}
})
