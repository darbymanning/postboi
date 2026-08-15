import type { APIRoute } from "astro"
import { webhook } from "postboi/webhooks"

// Provider delivery events. webhook() accepts Astro's context directly (it carries
// .request), so the handler is the entire endpoint — signature verified, payload
// normalized, provider answered correctly. Set <PROVIDER>_WEBHOOK_SECRET in .env.
export const POST: APIRoute = webhook(async (event) => {
	console.log(`${event.type} — ${event.email ?? ""}`)
})
