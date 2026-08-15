import { webhook } from "postboi/webhooks"

// Provider delivery events. h3's toWebRequest hands webhook() the raw web Request —
// signatures verify over the exact bytes, and this conversion preserves them. Set
// <PROVIDER>_WEBHOOK_SECRET in .env and point the provider's webhook at POST /webhooks.
const handle = webhook(async (event) => {
	console.log(`${event.type} — ${event.email ?? ""}`)
})

export default defineEventHandler((event) => handle(toWebRequest(event)))
