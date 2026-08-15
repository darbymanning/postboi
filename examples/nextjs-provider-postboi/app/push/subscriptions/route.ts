import { push } from "postboi"
import type { PushSubscriptionJSON } from "postboi/push"

// The server half of Web Push: file the subscription the browser minted, and send to it.
// In-memory on purpose — this is the example's database. A restart forgets everyone; a
// real app stores rows keyed by endpoint (the endpoint IS the address).
const subscriptions = new Map<string, PushSubscriptionJSON>()

/** The page POSTs the subscription `subscribe()` returned. Store it. */
export async function POST(request: Request) {
	const subscription = (await request.json()) as PushSubscriptionJSON
	subscriptions.set(subscription.endpoint, subscription)
	return Response.json({ stored: subscriptions.size })
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
			// Expiring subscriptions are push's steady state, not an error — delete your
			// stored copy, never retry or alert.
			if (push.expired(error)) subscriptions.delete(endpoint)
			else throw error
		}
	}
	return Response.json({ sent })
}
