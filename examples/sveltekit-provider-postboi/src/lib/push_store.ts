import type { PushSubscriptionJSON } from "postboi/push"

/**
 * Where subscriptions live between subscribe and send. In-memory on purpose — this is
 * the example's database. A restart forgets everyone; a real app stores rows keyed by
 * endpoint (the endpoint IS the address, and there's no way to recover one later).
 */
export const subscriptions = new Map<string, PushSubscriptionJSON>()
