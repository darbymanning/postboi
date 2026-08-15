import { push } from "postboi"
import { subscriptions } from "../../utils/push_store"

/** Push a notification to every stored subscription. */
export default defineEventHandler(async () => {
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
	return { sent }
})
