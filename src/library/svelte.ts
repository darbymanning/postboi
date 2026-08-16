/**
 * Postboi's Svelte surface: the prop-free `<Captcha />` and the runes push toggle —
 * the same pairing `postboi/react` and `postboi/vue` carry for their ecosystems.
 *
 * The component keeps its default export, so `import Captcha from "postboi/svelte"`
 * reads exactly as it always has.
 */
export { default, default as Captcha } from "./Captcha.svelte"
export { subscription, type PushToggle } from "./push/toggle.js"
export type { PushReason, PushState, SubscriptionOptions } from "./push/controller.js"
