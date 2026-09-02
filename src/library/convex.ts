import type { LifecycleClient, LifecycleOptions, LifecycleUser } from "./lifecycle.js"
import { mail } from "./mail.js"

/**
 * `postboi/convex` — track and identify from a Convex backend.
 *
 * The thing to know before anything else: **Convex mutations cannot do network I/O.**
 * Only actions can. So the pattern is always the same — the mutation that stores the
 * user schedules an action, and the action calls these:
 *
 * ```ts
 * // convex/postboi.ts
 * import { internalAction } from "./_generated/server"
 * import { v } from "convex/values"
 * import { track, identify } from "postboi/convex"
 *
 * export const signed_up = internalAction({
 *   args: { email: v.string(), name: v.optional(v.string()), id: v.string() },
 *   handler: async (_ctx, args) => {
 *     await identify({ id: args.id, email: args.email, name: args.name })
 *     await track(args.email, "auth.signed_up")
 *   },
 * })
 *
 * // convex/users.ts
 * export const create = mutation({
 *   handler: async (ctx, args) => {
 *     const id = await ctx.db.insert("users", args)
 *     await ctx.scheduler.runAfter(0, internal.postboi.signed_up, { ...args, id })
 *     return id
 *   },
 * })
 * ```
 *
 * Scheduling rather than awaiting is not a workaround — it is the better shape. The
 * mutation commits on its own, and the event follows; a Postboi outage delays a
 * timeline row and never rolls back a signup.
 *
 * Convex projects that use Clerk for auth model user creation as a Clerk webhook
 * instead. That path is covered by the hosted Clerk integration and needs none of
 * this — connect it in the dashboard and the same `auth.*` events arrive.
 */

/**
 * `POSTBOI_TOKEN` is read from the environment; set it in the Convex dashboard.
 *
 * The same options every plugin here takes — an alias rather than its own shape, so a
 * project that configures one of them configures all of them the same way.
 */
export type ConvexOptions = LifecycleOptions

/**
 * Record an event from inside a Convex action. The contact is created if the address
 * is unknown, because an action reporting a signup is exactly the case where it is.
 */
export async function track(
	to: string | { external_id: string },
	event: string,
	properties?: Record<string, unknown>,
	options: ConvexOptions & { at?: string | Date; idempotency_key?: string } = {}
): Promise<void> {
	const client = options.client ?? (mail as unknown as LifecycleClient)
	try {
		await client.events.track(to, event, properties, {
			create: true,
			...(options.at ? { at: options.at } : {}),
			...(options.idempotency_key ? { idempotency_key: options.idempotency_key } : {}),
		})
	} catch (error) {
		// Same rule as every other plugin here: the customer's write already committed,
		// and a throw now would retry an action that has nothing left to do.
		;(options.on_error ?? default_error)(error, { event })
	}
}

/**
 * Upsert the contact behind a user — name, your own id, and any attributes worth
 * segmenting on. `data` merges, so this never clears what another path set.
 */
export async function identify(user: LifecycleUser, options: ConvexOptions = {}): Promise<void> {
	const email = user.email?.trim().toLowerCase()
	if (!email) return
	const client = options.client ?? (mail as unknown as LifecycleClient)
	const id = user.id === null || user.id === undefined ? undefined : String(user.id)
	try {
		await client.contacts.add(email, {
			...(user.name ? { name: user.name } : {}),
			...(id ? { external_id: id } : {}),
			...(user.data && Object.keys(user.data).length > 0 ? { data: user.data } : {}),
		})
	} catch (error) {
		;(options.on_error ?? default_error)(error, { event: "identify", email })
	}
}

function default_error(error: unknown, context: { event: string; email?: string }): void {
	const reason = error instanceof Error ? error.message : String(error)
	console.warn(`[postboi] ${context.event} not recorded: ${reason}`)
}

/**
 * The pair, bound to one set of options — for a project that wants its own client or
 * its own error handling in one place rather than at every call.
 *
 * ```ts
 * const postboi = convex({ on_error: (error) => console.error(error) })
 * await postboi.identify({ id, email, name })
 * await postboi.track(email, "project_created", { plan })
 * ```
 */
export function convex(options: ConvexOptions = {}) {
	return {
		track: (
			to: string | { external_id: string },
			event: string,
			properties?: Record<string, unknown>,
			call: { at?: string | Date; idempotency_key?: string } = {}
		) => track(to, event, properties, { ...options, ...call }),
		identify: (user: LifecycleUser) => identify(user, options),
	}
}

export type { LifecycleClient, LifecycleOptions, LifecycleUser } from "./lifecycle.js"
