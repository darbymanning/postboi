"use client"

/**
 * `<Captcha>` for React — Next.js, Remix, or plain React. Drop-in spam protection for a
 * native `<form>`: renders the hidden honeypot field and, on the Postboi provider, activates the
 * managed invisible captcha on the surrounding form. The publishable key is baked in by
 * `bunx postboi sync`, so no props are needed.
 *
 * Written with `createElement` (no JSX) so it needs no build-tool configuration here;
 * React itself is an optional peer dependency.
 *
 * @example
 * ```tsx
 * import { Captcha } from "postboi/react"
 *
 * <form action={action}>
 * 	<input name="contact→name" required />
 * 	<Captcha />
 * 	<button>Send</button>
 * </form>
 * ```
 */

import { createElement, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { push_controller } from "./push/controller.js"
import type { PushControllerOptions, PushState } from "./push/controller.js"
import { HONEYPOT_FIELD } from "./captcha.js"
import { activate_captcha, honeypot_style_object } from "./form.js"

export interface CaptchaProps {
	/** Publishable key (`pk_…`) override. Defaults to the key baked by `bunx postboi sync`. */
	pk?: string
	/** Origin serving the captcha loader. Defaults to https://postboi.app. */
	origin?: string
	/** Render the hidden honeypot field. Defaults to true. */
	honeypot?: boolean
}

export function Captcha({ pk, origin, honeypot = true }: CaptchaProps) {
	const marker = useRef<HTMLElement>(null)

	useEffect(() => {
		activate_captcha(marker.current, pk, origin)
	}, [pk, origin])

	return honeypot
		? createElement("input", {
				ref: marker,
				type: "text",
				name: HONEYPOT_FIELD,
				tabIndex: -1,
				autoComplete: "off",
				"aria-hidden": "true",
				style: honeypot_style_object,
			})
		: createElement("span", { ref: marker, hidden: true })
}

/**
 * The push-toggle state machine as a hook — `postboi/push`'s `push_controller`, plugged
 * into React. Call `enable` from a click: browsers auto-deny permission prompts that
 * aren't tied to a user gesture, and once denied they never ask again.
 *
 * @example
 * ```tsx
 * const push = use_push({ key: VAPID_PUBLIC_KEY, register: "/push/subscriptions" })
 *
 * <button onClick={push.on ? push.disable : push.enable} disabled={push.busy}>
 * 	{push.on ? "Unsubscribe" : "Subscribe"}
 * </button>
 * ```
 */
export function use_push(options: PushControllerOptions): PushState & {
	enable: () => Promise<void>
	disable: () => Promise<void>
} {
	const [controller] = useState(() => push_controller(options))
	const state = useSyncExternalStore(controller.subscribe, controller.now, controller.now)
	return { ...state, enable: controller.enable, disable: controller.disable }
}
