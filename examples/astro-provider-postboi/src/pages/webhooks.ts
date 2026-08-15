import type { APIRoute } from "astro"
import { receive, WebhookVerificationError } from "postboi/webhooks"

// Provider delivery events on an Astro API route. `receive()` takes the web Request
// directly — Astro hands you one. Point your provider's webhook at POST /webhooks and
// set <PROVIDER>_WEBHOOK_SECRET in .env.
export const POST: APIRoute = async ({ request }) => {
	try {
		const events = await receive(request)
		for (const event of events) {
			console.log(`${event.type} — ${event.email ?? ""}`)
		}
		return Response.json({ received: events.length })
	} catch (error) {
		// A failed signature is a 401 so the provider knows the endpoint rejected it.
		if (error instanceof WebhookVerificationError) {
			return Response.json({ error: "bad signature" }, { status: 401 })
		}
		return Response.json({ error: "unparseable payload" }, { status: 400 })
	}
}
