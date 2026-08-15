import { receive, WebhookVerificationError } from "postboi/webhooks"

// Provider delivery events on a Next.js route handler. `receive()` takes the web
// Request directly — App Router hands you one, so there's no raw-body configuration
// (the Pages Router's bodyParser dance isn't needed here).
//
// Point your provider's webhook at POST /webhooks and set <PROVIDER>_WEBHOOK_SECRET.
export async function POST(request: Request) {
	try {
		const events = await receive(request)
		for (const event of events) {
			console.log(`${event.type} — ${event.email ?? ""}`)
		}
		return Response.json({ received: events.length })
	} catch (error) {
		// A failed signature is a 401 so the provider knows the endpoint rejected it —
		// anything else unparseable is a 400.
		if (error instanceof WebhookVerificationError) {
			return Response.json({ error: "bad signature" }, { status: 401 })
		}
		return Response.json({ error: "unparseable payload" }, { status: 400 })
	}
}
