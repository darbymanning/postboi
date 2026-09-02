import { lifecycle, type LifecycleOptions, type LifecycleUser } from "./lifecycle.js"

/**
 * `postboi/better-auth` — a Better Auth plugin that puts signups, sign-ins and profile
 * changes on the contact's timeline, so a welcome sequence needs no webhook, no
 * endpoint and no second copy of who your users are.
 *
 * ```ts
 * import { betterAuth } from "better-auth"
 * import { postboi } from "postboi/better-auth"
 *
 * export const auth = betterAuth({
 *   database: …,
 *   plugins: [postboi()],
 * })
 * ```
 *
 * Two things about how it behaves, both deliberate:
 *
 * - **It never fails a sign-up.** Every call is caught and reported through
 *   `on_error` (a console line by default). A network blip at Postboi turning into a
 *   500 at somebody's sign-up form would be a far worse bug than a missing timeline
 *   row.
 * - **It writes the same `auth.*` names the hosted Clerk and Supabase integrations
 *   write.** A sequence triggered by `auth.signed_up` works whether the customer
 *   connected a provider's webhooks or dropped this into their own backend — which
 *   also means moving between the two changes nothing downstream.
 *
 * Sign-ins are one event per session, which on a busy product is a great deal of
 * timeline. `postboi({ events: { signed_in: false } })` switches them off.
 */

/** What Better Auth stores about a user. Structural, so this needs no dependency on it. */
export interface BetterAuthUser {
	id: string
	email: string
	name?: string | null
	emailVerified?: boolean | null
	image?: string | null
	createdAt?: Date | string
	updatedAt?: Date | string
	[key: string]: unknown
}

export interface BetterAuthSession {
	id: string
	userId: string
	[key: string]: unknown
}

export interface PostboiAuthOptions extends LifecycleOptions {
	/**
	 * Look the user up for a session, when reporting sign-ins. Better Auth's session
	 * hook is given the session, not the user — and a plugin that guessed would be
	 * mailing the wrong person. Without this, sign-ins are skipped and say so once.
	 */
	user_for_session?: (session: BetterAuthSession) => Promise<BetterAuthUser | undefined>
}

function as_user(user: BetterAuthUser): LifecycleUser {
	return {
		id: user.id,
		email: user.email,
		name: user.name ?? undefined,
		...(user.emailVerified ? { data: { email_verified: "true" } } : {}),
	}
}

/**
 * The plugin. Returns a plain object in Better Auth's plugin shape — `id` plus
 * `databaseHooks` — rather than importing its types, so `postboi` stays a dependency
 * of nobody's auth config.
 */
export function postboi(options: PostboiAuthOptions = {}) {
	const reporter = lifecycle(options)
	let warned_about_sessions = false

	return {
		id: "postboi",
		databaseHooks: {
			user: {
				create: {
					async after(user: BetterAuthUser) {
						await reporter.report("signed_up", as_user(user), user)
						// A social sign-in arrives already verified, and that is the same
						// fact `auth.email_verified` reports for everyone else.
						if (user.emailVerified) await reporter.report("verified", as_user(user), user)
					},
				},
				update: {
					async after(user: BetterAuthUser) {
						await reporter.report("updated", as_user(user), user)
					},
				},
			},
			session: {
				create: {
					async after(session: BetterAuthSession) {
						if (!reporter.name_of("signed_in")) return
						if (!options.user_for_session) {
							if (!warned_about_sessions) {
								warned_about_sessions = true
								console.warn(
									"[postboi] sign-ins aren't being recorded: pass `user_for_session` so the plugin can resolve the session's user, or `events: { signed_in: false }` to stop asking."
								)
							}
							return
						}
						const user = await options.user_for_session(session).catch(() => undefined)
						if (user) await reporter.report("signed_in", as_user(user), session)
					},
				},
			},
		},
	}
}

export { lifecycle } from "./lifecycle.js"
export type { LifecycleClient, LifecycleOptions, LifecycleUser } from "./lifecycle.js"
