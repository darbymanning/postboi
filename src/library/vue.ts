/**
 * `<Captcha>` for Vue — Nuxt or plain Vue 3. Drop-in spam protection for a native
 * `<form>`: renders the hidden honeypot field and, on the Postboi provider, activates the managed
 * invisible captcha on the surrounding form. The publishable key is baked in by
 * `bunx postboi sync`, so no props are needed.
 *
 * Written with render functions (no SFC) so it needs no build-tool configuration here;
 * Vue itself is an optional peer dependency.
 *
 * @example
 * ```vue
 * <script setup>
 * import { Captcha } from "postboi/vue"
 * </script>
 *
 * <template>
 * 	<form method="post" action="/api/contact">
 * 		<input name="contact→name" required />
 * 		<Captcha />
 * 		<button>Send</button>
 * 	</form>
 * </template>
 * ```
 */

import { computed, defineComponent, h, onMounted, onUnmounted, ref } from "vue"
import { push_controller } from "./push/controller.js"
import type { PushControllerOptions, PushState } from "./push/controller.js"
import { HONEYPOT_FIELD } from "./captcha.js"
import { activate_captcha, honeypot_style } from "./form.js"

export const Captcha = defineComponent({
	name: "Captcha",
	props: {
		/** Publishable key (`pk_…`) override. Defaults to the key baked by `bunx postboi sync`. */
		pk: { type: String, required: false },
		/** Origin serving the captcha loader. Defaults to https://postboi.app. */
		origin: { type: String, required: false },
		/** Render the hidden honeypot field. Defaults to true. */
		honeypot: { type: Boolean, default: true },
	},
	setup(props) {
		const marker = ref<HTMLElement>()

		onMounted(function () {
			activate_captcha(marker.value, props.pk, props.origin)
		})

		return () =>
			props.honeypot
				? h("input", {
						ref: marker,
						type: "text",
						name: HONEYPOT_FIELD,
						tabindex: "-1",
						autocomplete: "off",
						"aria-hidden": "true",
						style: honeypot_style,
					})
				: h("span", { ref: marker, hidden: true })
	},
})

export default Captcha

/**
 * The push-toggle state machine as a composable — `postboi/push`'s `push_controller`,
 * plugged into Vue. Call `enable` from a click: browsers auto-deny permission prompts
 * that aren't tied to a user gesture, and once denied they never ask again.
 *
 * @example
 * ```vue
 * <script setup>
 * import { usePush } from "postboi/vue"
 * const push = usePush({ key: VAPID_PUBLIC_KEY, register: "/push/subscriptions" })
 * </script>
 *
 * <template>
 * 	<button :disabled="push.busy.value" @click="push.on.value ? push.disable() : push.enable()">
 * 		{{ push.on.value ? "Unsubscribe" : "Subscribe" }}
 * 	</button>
 * </template>
 * ```
 */
export function usePush(options: PushControllerOptions) {
	const controller = push_controller(options)
	const state = ref<PushState>(controller.now())

	onMounted(() => {
		const stop = controller.subscribe((next) => (state.value = next))
		onUnmounted(stop)
	})

	return {
		supported: computed(() => state.value.supported),
		on: computed(() => state.value.on),
		busy: computed(() => state.value.busy),
		reason: computed(() => state.value.reason),
		enable: controller.enable,
		disable: controller.disable,
	}
}
