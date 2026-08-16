/**
 * The push toggle for Svelte — reactive properties over the framework-neutral state
 * machine in `./controller.ts`, via `createSubscriber`.
 *
 * `createSubscriber` is what makes this both reactive and lazy: nothing listens (and
 * the controller touches no browser API) until an effect actually reads a property, and
 * when the last effect reading it is destroyed the listener detaches again — so a
 * destroyed component doesn't keep a machine pumping state at it, with no `destroy()`
 * for anyone to remember. It's a runtime import, not a compiler construct, which is why
 * this is a plain `.ts` module and the published file runs anywhere.
 *
 * It lives behind `postboi/svelte` rather than `postboi/push` because the browser
 * client is plain DOM that React and Vue import too, and none of them should pull in
 * Svelte to get `subscribe()`.
 */
import { createSubscriber } from "svelte/reactivity"
import { subscription as machine, type PushReason, type SubscriptionOptions } from "./controller.js"

/**
 * This browser's push subscription as reactive state — read `on`, `busy`, `supported`
 * and `reason` straight off it. Named after what it renders as, and not
 * `PushSubscription`, which would shadow the DOM global of that name in the one domain
 * where code handles the real one.
 */
export interface PushToggle {
	/** Web Push exists in this browser. Always false during SSR. */
	readonly supported: boolean
	/** This browser holds a subscription. */
	readonly on: boolean
	/** An enable or disable is in flight. */
	readonly busy: boolean
	/** Why the last enable failed, or null. Dismissed permission prompts stay null. */
	readonly reason: PushReason | null
	/** Subscribe if this browser isn't, unsubscribe if it is. Call it from a click. */
	toggle(): Promise<void>
	/** Prompt if needed, subscribe, and file the subscription with the server. */
	enable(): Promise<void>
	/** Unsubscribe this browser and, when configured, unfile it from the server. */
	disable(): Promise<void>
	/** Re-read reality. Rarely needed — the first read already does it once. */
	refresh(): Promise<void>
}

/**
 * The push toggle's state machine, as reactive properties. `register` is where the
 * subscription the browser mints gets filed — a URL it's POSTed to, or a function — and
 * without it the server never learns the address, so nothing can ever push to it.
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
export function subscription(options: SubscriptionOptions = {}): PushToggle {
	const store = machine(options)
	const subscribed = createSubscriber((update) => store.subscribe(update))
	// Getters read the machine itself, so they're current even before anything listens;
	// `subscribed()` inside each is what registers the effect dependency. The methods
	// are the machine's own free-standing closures — already safe to hand to a handler
	// by name, nothing to bind.
	return {
		get supported() {
			subscribed()
			return store.supported
		},
		get on() {
			subscribed()
			return store.on
		},
		get busy() {
			subscribed()
			return store.busy
		},
		get reason() {
			subscribed()
			return store.reason
		},
		toggle: store.toggle,
		enable: store.enable,
		disable: store.disable,
		refresh: store.refresh,
	}
}
