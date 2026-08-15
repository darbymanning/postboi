import type { APIRoute } from "astro"
import { push } from "postboi"
import type { PushSubscriptionJSON } from "postboi/push"

// The server half of Web Push: POST files the subscription the browser minted, PUT
// sends to everyone stored. In-memory on purpose — this is the example's database. A
// restart forgets everyone; a real app stores rows keyed by endpoint (the endpoint IS
// the address).
const subscriptions = new Map<string, PushSubscriptionJSON>()

export const POST: APIRoute = async ({ request }) => {
	const subscription = (await request.json()) as PushSubscriptionJSON
	subscriptions.set(subscription.endpoint, subscription)
	return Response.json({ stored: subscriptions.size })
}

export const PUT: APIRoute = async () => {
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
