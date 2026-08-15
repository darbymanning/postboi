import { json } from "@sveltejs/kit"
import { push } from "postboi"
import { subscriptions } from "$lib/push_store"

// The server half of Web Push: file the subscription the browser minted, and send to it.
// The VAPID keys come from env (bunx postboi init --push generates the pair).

/** The page POSTs the subscription `subscribe()` returned. Store it — it IS the address. */
export async function POST({ request }) {
	const subscription = await request.json()
	subscriptions.set(subscription.endpoint, subscription)
	return json({ stored: subscriptions.size })
}

/** Push a notification to every stored subscription. */
export async function PUT() {
	let sent = 0
	for (const [endpoint, subscription] of subscriptions) {
		try {
			await push({
				to: subscription,
				title: "It works",
				message: "This came from your own server, via push().",
				url: "/push",
			})
			sent++
		} catch (error) {
			// Expiring subscriptions are push's steady state, not an error — the right
			// response is to delete your stored copy, never to retry or alert.
			if (push.expired(error)) subscriptions.delete(endpoint)
			else throw error
		}
	}
	return json({ sent })
}
