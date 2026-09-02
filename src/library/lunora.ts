import type { LifecycleOptions, LifecycleUser } from "./lifecycle.js"
import { mail } from "./mail.js"
import { postboi as better_auth_plugin, type PostboiAuthOptions } from "./better_auth.js"

/**
 * `postboi/lunora` — an opt-in package for a Lunora backend, in the convention its
 * auth, payments and email packages already use: something you register once, which
 * then hangs off the context every action and background job is handed.
 *
 * ```ts
 * import { postboi } from "postboi/lunora"
 *
 * export default defineApp({
 *   packages: [postboi()],
 * })
 *
 * // and thereafter, in any action or job:
 * await ctx.postboi.track(user.email, "project_created", { plan })
 * ```
 *
 * Everything runs in the customer's backend with the customer's token: this is
 * transport, and nothing is hosted on our side. `POSTBOI_TOKEN` is read from the
 * environment like every other credential the library uses.
 *
 * **Signups need nothing extra.** Lunora bundles Better Auth, so `auth()` below
 * returns the same plugin `postboi/better-auth` exports — one line in the auth config
 * and `auth.signed_up` starts arriving. This package is for everything *after* that:
 * the events only your own code knows about.
 */

export interface LunoraOptions extends LifecycleOptions {
	/** What the context property is called. Defaults to `postboi`. */
	as?: string
}

/** What lands on the context. Deliberately small — it is the whole surface. */
export interface PostboiContext {
	/** Record an event about a contact. Creates the contact if the address is new. */
	track(
		to: string | { external_id: string },
		event: string,
		properties?: Record<string, unknown>,
		options?: { at?: string | Date; idempotency_key?: string }
	): Promise<void>
	/** Upsert the contact behind a user. `data` merges; it never replaces. */
	identify(user: LifecycleUser): Promise<void>
	/** Send one email, for the transactional mail a job actually has to send itself. */
	send: typeof mail
}

/** The context object, on its own — for wiring by hand, or in a test. */
export function context(options: LunoraOptions = {}): PostboiContext {
	const client = options.client ?? (mail as unknown as NonNullable<LifecycleOptions["client"]>)
	const on_error =
		options.on_error ??
		((error: unknown, where: { event: string }) => {
			const reason = error instanceof Error ? error.message : String(error)
			console.warn(`[postboi] ${where.event} not recorded: ${reason}`)
		})
	return {
		async track(to, event, properties, call = {}) {
			try {
				await client.events.track(to, event, properties, { create: true, ...call })
			} catch (error) {
				// A background job that throws here gets retried by the scheduler, which
				// would send the *email* twice to record the event once.
				on_error(error, { event })
			}
		},
		async identify(user) {
			const email = user.email?.trim().toLowerCase()
			if (!email) return
			const id = user.id === null || user.id === undefined ? undefined : String(user.id)
			try {
				await client.contacts.add(email, {
					...(user.name ? { name: user.name } : {}),
					...(id ? { external_id: id } : {}),
					...(user.data && Object.keys(user.data).length > 0 ? { data: user.data } : {}),
				})
			} catch (error) {
				on_error(error, { event: "identify", email })
			}
		},
		send: mail,
	}
}

/**
 * The package. Registering it puts `ctx.postboi` on every action and background job.
 * The shape is structural on purpose — `name` plus an `extend(ctx)` — so this file
 * depends on nothing of Lunora's, and a rename on their side is a one-line fix here
 * rather than a broken build for everyone.
 */
export function postboi(options: LunoraOptions = {}) {
	const key = options.as ?? "postboi"
	const built = context(options)
	return {
		name: "postboi",
		key,
		extend<T extends Record<string, unknown>>(ctx: T): T & Record<string, PostboiContext> {
			return Object.assign(ctx, { [key]: built })
		},
	}
}

/**
 * The Better Auth plugin, re-exported so a Lunora app configures signups from the same
 * import as everything else. It is the very same plugin `postboi/better-auth` exports —
 * one code path, so the `auth.*` events cannot differ by which door they came through.
 */
export function auth(options: PostboiAuthOptions = {}) {
	return better_auth_plugin(options)
}

export { lifecycle } from "./lifecycle.js"
export type { LifecycleClient, LifecycleOptions, LifecycleUser } from "./lifecycle.js"
