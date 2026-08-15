import { subscriptions } from "../../utils/push_store"

/** The page POSTs the subscription `subscribe()` returned. Store it — it IS the address. */
export default defineEventHandler(async (event) => {
	const subscription = await readBody(event)
	subscriptions.set(subscription.endpoint, subscription)
	return { stored: subscriptions.size }
})
