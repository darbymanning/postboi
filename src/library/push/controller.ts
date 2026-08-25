/**
 * The subscribe-page state machine, written once. Every settings page that offers a
 * push toggle re-implements the same dance — `current()` on mount, busy/error state,
 * subscribe-then-register, the user-gesture rule — so it lives here instead.
 *
 * Framework-neutral on purpose: it owns the logic and publishes changes through the
 * store contract, and each ecosystem's wrapper owns the reactivity. `usePush`
 * (`postboi/react`), `use_push` (`postboi/vue`) and the reactive `subscription`
 * (`postboi/svelte`) are all a few lines around this file.
 */
import { subscribe, unsubscribe } from "./client.js"
import type { PushSubscriptionJSON } from "./client.js"

/** Why an enable failed: `subscribe.reason`'s union, plus the register call failing. */
export type PushReason = NonNullable<ReturnType<typeof subscribe.reason>> | "register_failed"

export interface PushState {
	/** Web Push exists in this browser. Always false during SSR. */
	supported: boolean
	/** This browser holds a subscription. */
	on: boolean
	/** An enable or disable is in flight. */
	busy: boolean
	/** Why the last enable failed, or null. Dismissed permission prompts stay null. */
	reason: PushReason | null
}

export interface SubscriptionOptions {
	/**
	 * VAPID public key — the same one the server signs with. Optional once
	 * `bunx postboi sync` has baked it; subscribe() resolves the default.
	 */
	key?: string
	/**
	 * Where to file the subscription the browser mints: a URL it's POSTed to as JSON,
	 * or a function for anything beyond that. Without it the subscription is only held
	 * by the browser — the server can't push to what it never learned about.
	 */
	register?: string | ((subscription: PushSubscriptionJSON) => Promise<unknown>)
	/**
	 * How to unfile it on disable: a URL sent `DELETE` with `{ endpoint }` as JSON, or
	 * a function receiving the removed subscription.
	 */
	unregister?: string | ((subscription: PushSubscriptionJSON) => Promise<unknown>)
	/** Path to the service worker, when it isn't served at a conventional one —
	 * `subscribe()` finds `/sw.js` and SvelteKit's `/service-worker.js` on its own. */
	sw?: string
}

async function file(
	target: string | ((subscription: PushSubscriptionJSON) => Promise<unknown>),
	subscription: PushSubscriptionJSON,
	method: "POST" | "DELETE"
): Promise<void> {
	if (typeof target === "function") {
		await target(subscription)
		return
	}
	const response = await fetch(target, {
		method,
		headers: { "content-type": "application/json" },
		body: JSON.stringify(method === "POST" ? subscription : { endpoint: subscription.endpoint }),
	})
	if (!response.ok) throw new Error(`${method} ${target} answered ${response.status}`)
}

/**
 * This browser's push subscription as a state machine — supported, on, busy, why the
 * last attempt failed, and the calls that change it. Safe to construct anywhere,
 * including during SSR: no browser API is touched until something subscribes to the
 * state or calls {@link enable}.
 *
 * Svelte, React and Vue each have a wrapper that makes this reactive in their idiom —
 * reach for this one directly from vanilla JS, or from a framework we don't ship a
 * wrapper for. Call `toggle()`/`enable()` from a click: browsers auto-deny permission
 * prompts that aren't tied to a user gesture, and once denied they never ask again.
 *
 * @example
 * ```ts
 * import { subscription } from "postboi/push"
 *
 * const push = subscription({ register: "/push/subscriptions" })
 * push.subscribe((state) => button.replaceChildren(state.on ? "Unsubscribe" : "Subscribe"))
 * button.addEventListener("click", push.toggle)
 * ```
 */
export function subscription(options: SubscriptionOptions = {}) {
	let state: PushState = { supported: false, on: false, busy: false, reason: null }
	const listeners = new Set<(state: PushState) => void>()
	let first_read: Promise<void> | null = null
	// Bumped whenever an enable or disable settles `on` for real, so a refresh() that
	// started before the change can't land its stale snapshot on top afterwards.
	let generation = 0

	function set(patch: Partial<PushState>) {
		state = { ...state, ...patch }
		for (const listener of listeners) listener(state)
	}

	/** Re-read reality: is push supported here, and is this browser subscribed? */
	async function refresh(): Promise<void> {
		if (!subscribe.supported()) return
		const seen = generation
		const on = Boolean(await subscribe.current())
		// An enable/disable that landed while we were reading owns `on` now — the answer
		// we got predates it.
		set(seen === generation ? { supported: true, on } : { supported: true })
	}

	/** The initial read, started at most once — by the first listener or first toggle. */
	function first_refresh(): Promise<void> {
		first_read ??= refresh()
		return first_read
	}

	/** Prompt if needed, subscribe, and file the subscription with the server. */
	async function enable(): Promise<void> {
		if (state.busy) return
		set({ busy: true, reason: null })
		try {
			const subscription = await subscribe({
				key: options.key,
				sw: options.sw,
			})
			if (options.register) {
				try {
					await file(options.register, subscription, "POST")
				} catch {
					// The server never learned the address, so the browser shouldn't keep
					// a subscription nothing will ever push to. The rollback failing too
					// must not eat the real story — the register call is what broke.
					await unsubscribe().catch(() => {})
					generation += 1
					set({ busy: false, on: false, reason: "register_failed" })
					return
				}
			}
			generation += 1
			set({ busy: false, on: true })
		} catch (error) {
			// A dismissed prompt is a shrug, not an error — reason stays null for it.
			set({ busy: false, reason: subscribe.reason(error) })
		}
	}

	/** Unsubscribe this browser and, when configured, unfile it from the server. */
	async function disable(): Promise<void> {
		if (state.busy) return
		set({ busy: true })
		try {
			const removed = await unsubscribe()
			if (removed && options.unregister) {
				await file(options.unregister, removed, "DELETE").catch(() => {})
			}
			generation += 1
			set({ busy: false, on: false })
		} catch {
			// The unsubscribe itself failed, so the browser still holds the subscription.
			// `on` stays as it was; what matters is releasing `busy` — stuck true would
			// disable the toggle until a full reload.
			set({ busy: false })
		}
	}

	/**
	 * Flip it: subscribe if this browser isn't, unsubscribe if it is. What a switch in a
	 * settings page actually wants, and safe to hand straight to a click handler —
	 * `onclick={push.toggle}` rather than a ternary that has to read the state itself.
	 * A click that beats the initial read waits for it, so an already-subscribed browser
	 * gets the unsubscribe the user asked for, not a duplicate registration.
	 */
	async function toggle(): Promise<void> {
		if (state.busy) return
		await first_refresh()
		return state.on ? disable() : enable()
	}

	return {
		// The state's fields, readable straight off the machine — `push.on` from a click
		// handler or vanilla JS. Live values, but not reactive: a framework template
		// should read them through its wrapper (or the store contract below) instead.
		/** Web Push exists in this browser. Always false during SSR. */
		get supported() {
			return state.supported
		},
		/** This browser holds a subscription. */
		get on() {
			return state.on
		},
		/** An enable or disable is in flight. */
		get busy() {
			return state.busy
		},
		/** Why the last enable failed, or null. Dismissed permission prompts stay null. */
		get reason() {
			return state.reason
		},
		/** Svelte store contract: called with the state now and on every change. */
		subscribe(listener: (state: PushState) => void): () => void {
			listeners.add(listener)
			listener(state)
			void first_refresh()
			return () => listeners.delete(listener)
		},
		/** The current state — for `useSyncExternalStore` and friends. */
		now: () => state,
		refresh,
		enable,
		disable,
		toggle,
	}
}

export type PushSubscriptionStore = ReturnType<typeof subscription>
