/**
 * The push toggle as runes — Svelte's wrapper around the framework-neutral state
 * machine in `./controller.ts`.
 *
 * A `.svelte.ts` module rather than a plain one because `$state` is a compiler
 * construct: the reactivity has to be written where Svelte can see it. That's also why
 * it lives behind `postboi/svelte` instead of `postboi/push` — the browser client is
 * plain DOM that React and Vue import too, and none of them should pull in Svelte to
 * get `subscribe()`.
 */
import {
	subscription as store,
	type PushReason,
	type PushSubscriptionStore,
	type SubscriptionOptions,
} from "./controller.js"

/**
 * This browser's push subscription, as reactive state. Read `on`, `busy`, `supported`
 * and `reason` straight off it — no `$` prefix, no `get()`.
 */
class PushSubscription {
	#store: PushSubscriptionStore
	// Four primitives rather than one `$state` object: an object would be wrapped in
	// Svelte's deep proxy, and a page that only wants a toggle would carry that
	// machinery for four booleans it replaces wholesale anyway.
	#supported = $state(false)
	#on = $state(false)
	#busy = $state(false)
	#reason = $state<PushReason | null>(null)

	constructor(options: SubscriptionOptions) {
		this.#store = store(options)
		// Listening is what wakes the machine: the controller answers with reality now
		// (is push supported here, is this browser already subscribed) and again on every
		// change. During SSR that first answer is simply "unsupported", so a server render
		// produces the same markup as a browser that hasn't subscribed.
		this.#store.subscribe((next) => {
			this.#supported = next.supported
			this.#on = next.on
			this.#busy = next.busy
			this.#reason = next.reason
		})
	}

	/** Web Push exists in this browser. Always false during SSR. */
	get supported(): boolean {
		return this.#supported
	}

	/** This browser holds a subscription. */
	get on(): boolean {
		return this.#on
	}

	/** An enable or disable is in flight. */
	get busy(): boolean {
		return this.#busy
	}

	/** Why the last enable failed, or null. Dismissed permission prompts stay null. */
	get reason(): PushReason | null {
		return this.#reason
	}

	// Bound, so they survive being handed to an event handler by name —
	// `onclick={push.toggle}` is the whole point.

	/** Subscribe if this browser isn't, unsubscribe if it is. Call it from a click. */
	toggle = (): Promise<void> => this.#store.toggle()

	/** Prompt if needed, subscribe, and file the subscription with the server. */
	enable = (): Promise<void> => this.#store.enable()

	/** Unsubscribe this browser and, when configured, unfile it from the server. */
	disable = (): Promise<void> => this.#store.disable()

	/** Re-read reality. Rarely needed — listening already does it once. */
	refresh = (): Promise<void> => this.#store.refresh()
}

/**
 * The push toggle's state machine, as runes. `register` is where the subscription the
 * browser mints gets filed — a URL it's POSTed to, or a function — and without it the
 * server never learns the address, so nothing can ever push to it.
 *
 * **Call `toggle()` from a click.** Browsers auto-deny a permission prompt that isn't
 * tied to a user gesture, and once denied they never ask again.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 * 	import { subscription } from "postboi/svelte"
 *
 * 	const push = subscription({ register: "/push/subscriptions" })
 * </script>
 *
 * <button onclick={push.toggle} disabled={push.busy}>
 * 	{push.on ? "Unsubscribe" : "Subscribe"}
 * </button>
 * ```
 */
export function subscription(options: SubscriptionOptions = {}): PushSubscription {
	return new PushSubscription(options)
}

export type { PushSubscription }
