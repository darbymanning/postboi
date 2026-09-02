import { mail } from "./mail.js"
import type { ContactEvent } from "./postboi_provider.js"

/**
 * The half every first-party lifecycle plugin shares: turning a user record from
 * somebody else's system into an event on a Postboi contact, and never letting that
 * throw where it wasn't asked to.
 *
 * The rule the plugins are built around, and the reason this file exists rather than
 * three copies of it: **a signup must not fail because email tracking failed.** These
 * hooks sit inside somebody's authentication path or their database mutation. A
 * network blip at Postboi that turned into a 500 at the sign-up form would be a far
 * worse bug than a missing timeline row, so every call here is caught, reported
 * through `on_error`, and the caller carries on.
 *
 * The events written are `auth.*`, the same names the hosted Clerk and Supabase
 * integrations write (see the app's LIFECYCLE.md, Phase D) — so a welcome sequence
 * triggered by `auth.signed_up` works whether the customer connected a provider's
 * webhooks or dropped one of these plugins into their own backend.
 */

/** The subset of a Postboi client these plugins use. `mail` satisfies it. */
export interface LifecycleClient {
	events: {
		track(
			to: string | { external_id: string },
			event: string,
			properties?: Record<string, unknown>,
			options?: { at?: string | Date; idempotency_key?: string; create?: boolean }
		): Promise<ContactEvent>
	}
	contacts: {
		update(
			email: string,
			changes: { name?: string | null; data?: Record<string, string> | null }
		): Promise<unknown>
		add(
			email: string,
			contact?: { name?: string; data?: Record<string, string>; external_id?: string }
		): Promise<unknown>
	}
}

/** A person as the plugins see them, whatever shape their system stores. */
export interface LifecycleUser {
	id?: string | number | null
	email?: string | null
	name?: string | null
	/** Anything else worth keeping on the contact, as strings. */
	data?: Record<string, string>
}

export interface LifecycleOptions {
	/** Where events go. Defaults to `mail`, which reads `POSTBOI_TOKEN` from the environment. */
	client?: LifecycleClient
	/**
	 * Rename or switch off any event. `false` means "don't record this one" — sign-ins
	 * are the usual candidate, being one event per session on a busy product.
	 */
	events?: {
		signed_up?: string | false
		signed_in?: string | false
		updated?: string | false
		deleted?: string | false
		verified?: string | false
	}
	/** Extra properties on the event, from whatever the source record carries. */
	properties?: (user: LifecycleUser, raw: unknown) => Record<string, unknown> | undefined
	/** Extra attributes on the contact — `data` merges, it never replaces. */
	attributes?: (user: LifecycleUser, raw: unknown) => Record<string, string> | undefined
	/**
	 * What to do when a track fails. The default writes one line to the console: these
	 * hooks run inside a sign-up, and a thrown error there costs a customer.
	 */
	on_error?: (error: unknown, context: { event: string; email?: string }) => void
}

/** The five moments a plugin reports, and the names they get by default. */
export type LifecycleMoment = "signed_up" | "signed_in" | "updated" | "deleted" | "verified"

const DEFAULT_NAMES: Record<LifecycleMoment, string> = {
	signed_up: "auth.signed_up",
	signed_in: "auth.signed_in",
	updated: "auth.user_updated",
	deleted: "auth.user_deleted",
	verified: "auth.email_verified",
}

function default_on_error(error: unknown, context: { event: string; email?: string }): void {
	const reason = error instanceof Error ? error.message : String(error)
	console.warn(`[postboi] ${context.event} not recorded: ${reason}`)
}

/**
 * One reporter, shared by every plugin. `report` never rejects; a caller may await it
 * without wrapping it, which is what makes it safe to drop into a database hook.
 */
export function lifecycle(options: LifecycleOptions = {}) {
	const client = options.client ?? (mail as unknown as LifecycleClient)
	const on_error = options.on_error ?? default_on_error

	/** The configured name for a moment, or undefined when it's switched off. */
	function name_of(moment: LifecycleMoment): string | undefined {
		const configured = options.events?.[moment]
		if (configured === false) return undefined
		return configured ?? DEFAULT_NAMES[moment]
	}

	return {
		name_of,

		/**
		 * Record one moment. Returns whether anything was written — false covers both
		 * "switched off" and "the user record had no address", neither of which is an
		 * error worth reporting.
		 */
		async report(
			moment: LifecycleMoment,
			user: LifecycleUser,
			raw: unknown = user
		): Promise<boolean> {
			const event = name_of(moment)
			if (!event) return false
			const email = user.email?.trim().toLowerCase()
			// An id with no address is nobody we can mail. The hosted integrations can
			// resolve one through the identity table; a plugin running in somebody
			// else's backend has no such table to read.
			if (!email) return false

			const external_id = user.id === null || user.id === undefined ? undefined : String(user.id)
			const properties = {
				...(external_id ? { user_id: external_id } : {}),
				...(options.properties?.(user, raw) ?? {}),
			}
			const data = { ...(user.data ?? {}), ...(options.attributes?.(user, raw) ?? {}) }

			try {
				// The contact first, so a brand-new one carries its name and id from the
				// moment it exists rather than acquiring them on the next update.
				if (moment === "signed_up") {
					await client.contacts.add(email, {
						...(user.name ? { name: user.name } : {}),
						...(external_id ? { external_id } : {}),
						...(Object.keys(data).length > 0 ? { data } : {}),
					})
				} else if (user.name || Object.keys(data).length > 0) {
					await client.contacts.update(email, {
						...(user.name ? { name: user.name } : {}),
						...(Object.keys(data).length > 0 ? { data } : {}),
					})
				}
				await client.events.track(email, event, properties, { create: true })
				return true
			} catch (error) {
				on_error(error, { event, email })
				return false
			}
		},
	}
}

export type Lifecycle = ReturnType<typeof lifecycle>
