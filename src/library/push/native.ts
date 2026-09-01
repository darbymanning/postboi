/**
 * Push registration for Expo and React Native apps — `postboi/push/expo`.
 *
 * The phone's twin of `postboi/push`: the same `subscribe()` / `unsubscribe()` /
 * `subscription()` surface, over `expo-notifications` instead of `PushManager`. Same
 * reasons for the same walls, and the same state machine underneath, so a settings
 * screen shared between the web app and the phone app reads the same either side.
 *
 * What it hands back is an Expo push token by default — the `ExponentPushToken[…]` that
 * `postboi/expo` sends to, with Expo holding the FCM and APNs credentials — or, with
 * `native: true`, the raw device token for `postboi/fcm` and `postboi/apns`. Either way
 * the registration says which provider it belongs to, because a token from one is
 * meaningless to the others.
 *
 * `expo-notifications` and `expo-constants` are optional peers: this module is only ever
 * imported inside an Expo app, where both already are.
 */
import * as Notifications from "expo-notifications"
import Constants from "expo-constants"
import { useState, useSyncExternalStore } from "react"
import { machine, type Filing, type MachineState } from "./controller.js"

/** What `subscribe` hands back — POST it to your server and store it. */
export interface PushRegistration {
	/** The token to store and send to: `ExponentPushToken[…]`, or the raw device token with `native: true`. */
	token: string
	/** Which server provider it belongs to — `postboi/expo`, `postboi/fcm` or `postboi/apns`. */
	provider: "expo" | "fcm" | "apns"
	/** Which kind of phone. */
	platform: "ios" | "android"
}

/**
 * Somewhere to remember that the user switched push off — the shape of
 * `@react-native-async-storage/async-storage`, which any key-value store adapts to in
 * three lines. Without one, the off switch lasts until the app restarts, because the
 * OS remembers permission but not the choice.
 */
export interface PushStorage {
	getItem(key: string): Promise<string | null> | string | null
	setItem(key: string, value: string): Promise<void> | void
	removeItem(key: string): Promise<void> | void
}

/** Options for {@link subscribe}. */
export interface SubscribeOptions {
	/**
	 * Register the raw FCM or APNs device token instead of an Expo push token, for a
	 * server that sends through `postboi/fcm` and `postboi/apns` itself. Default false:
	 * an Expo token, for `postboi/expo`.
	 */
	native?: boolean
	/**
	 * The EAS project id an Expo push token is minted for. Read from `app.json`
	 * (`extra.eas.projectId`, which `eas init` writes) when not passed.
	 */
	project_id?: string
	/**
	 * The Android notification channel the permission prompt needs to exist first, and
	 * the one a send lands in when it names none. Created before asking; a no-op on iOS.
	 */
	channel?: { id?: string; name?: string }
	/** Where the off switch is remembered across launches. See {@link PushStorage}. */
	storage?: PushStorage
}

/** Thrown when a registration can't be made, with `reason` saying which wall was hit. */
export class PushSubscribeError extends Error {
	readonly reason:
		| "unsupported"
		| "permission_denied"
		| "permission_dismissed"
		| "missing_project"
		| "failed"

	constructor(reason: PushSubscribeError["reason"], message: string) {
		super(message)
		this.name = "PushSubscribeError"
		this.reason = reason
	}
}

/** The storage key the off switch is kept under. */
const OFF_KEY = "postboi:push"

/** The off switch when no storage was given: this launch only. */
let switched_off = false

async function is_off(storage: PushStorage | undefined): Promise<boolean> {
	if (!storage) return switched_off
	return (await storage.getItem(OFF_KEY)) === "off"
}

async function set_off(storage: PushStorage | undefined, off: boolean): Promise<void> {
	switched_off = off
	if (!storage) return
	if (off) await storage.setItem(OFF_KEY, "off")
	else await storage.removeItem(OFF_KEY)
}

/**
 * Is push available here at all? Reached as `subscribe.supported()`.
 *
 * Not on the web build of an Expo app — that's a browser, and `postboi/push` is its
 * helper — and not in Expo Go on Android, which lost remote push in SDK 53: a
 * development build is the way to test there. Simulators are fine now (iOS since Xcode
 * 14 on macOS 13, Android emulators with Play services), so there's no device check.
 */
function supported(): boolean {
	const platform = Constants.platform
	if (!platform || platform.web) return false
	if (Constants.executionEnvironment === "storeClient" && platform.android) return false
	return Boolean(platform.ios || platform.android)
}

/** Read Expo's permission answer as one word — provisional counts as granted. */
function read_permission(
	status: Notifications.NotificationPermissionsStatus
): "granted" | "denied" | "undetermined" {
	if (status.granted || status.status === "granted") return "granted"
	const ios = status.ios?.status
	if (
		ios === Notifications.IosAuthorizationStatus.PROVISIONAL ||
		ios === Notifications.IosAuthorizationStatus.EPHEMERAL
	)
		return "granted"
	return status.status === "denied" ? "denied" : "undetermined"
}

/** The current notification permission, without prompting. Reached as `subscribe.permission()`. */
async function permission(): Promise<"granted" | "denied" | "undetermined" | "unsupported"> {
	if (!supported()) return "unsupported"
	return read_permission(await Notifications.getPermissionsAsync())
}

function platform_of(): "ios" | "android" {
	return Constants.platform?.ios ? "ios" : "android"
}

/** The registration a raw device token becomes: the provider follows the platform. */
function native_registration(token: { type: string; data: string }): PushRegistration {
	const platform = token.type === "ios" ? "ios" : "android"
	return { token: token.data, provider: platform === "ios" ? "apns" : "fcm", platform }
}

/** Mint the token this app registers with — no prompt, and the same answer every time. */
async function mint(options: SubscribeOptions): Promise<PushRegistration> {
	if (options.native) return native_registration(await Notifications.getDevicePushTokenAsync())
	const project_id =
		options.project_id ??
		Constants.expoConfig?.extra?.eas?.projectId ??
		Constants.easConfig?.projectId
	if (!project_id) {
		throw new PushSubscribeError(
			"missing_project",
			"No EAS project id — an Expo push token is minted for a project. Run `eas init` (it writes extra.eas.projectId to app.json), or pass { project_id }."
		)
	}
	const token = await Notifications.getExpoPushTokenAsync({ projectId: project_id })
	return { token: token.data, provider: "expo", platform: platform_of() }
}

/**
 * The registration this device already holds, or null. Reached as `subscribe.current()`.
 *
 * Granted permission is the phone's memory of "yes"; the off switch is this module's
 * memory of "no, since" — the state a toggle has to render after someone turned push off
 * in the app while the OS permission stayed granted. Never prompts.
 */
async function current(options: SubscribeOptions = {}): Promise<PushRegistration | null> {
	if (!supported()) return null
	if (await is_off(options.storage)) return null
	if (read_permission(await Notifications.getPermissionsAsync()) !== "granted") return null
	try {
		return await mint(options)
	} catch {
		return null
	}
}

/** Why a subscribe failed, or null if the error didn't come from here. Reached as `subscribe.reason(error)`. */
function reason(error: unknown): PushSubscribeError["reason"] | null {
	return error instanceof PushSubscribeError ? error.reason : null
}

/**
 * Request permission if needed and register, handing back the token to POST to your
 * server. Reuses the token the device already has, so calling it on every launch is safe —
 * and worth doing, because tokens rotate.
 *
 * On Android the notification channel is created first: without one, Android 13+ shows
 * no permission prompt at all, and answers "denied" as if the user had.
 *
 * `subscribe.supported()`, `subscribe.permission()` and `subscribe.current()` answer the
 * three questions a settings screen asks before it can render the switch; none prompt.
 * `subscribe.reason(error)` answers the one it asks afterwards.
 *
 * @example
 * ```ts
 * import { subscribe } from "postboi/push/expo"
 *
 * const registration = await subscribe()
 * await fetch("https://example.com/api/push/register", {
 * 	method: "POST",
 * 	headers: { "Content-Type": "application/json" },
 * 	body: JSON.stringify(registration), // { token, provider: "expo", platform }
 * })
 * ```
 */
async function subscribe_now(options: SubscribeOptions = {}): Promise<PushRegistration> {
	if (!supported()) {
		throw new PushSubscribeError(
			"unsupported",
			Constants.platform?.web
				? "This is the web build — use subscribe() from postboi/push there."
				: "Push isn't available here. Expo Go on Android has no remote push since SDK 53; use a development build."
		)
	}

	// Before the prompt, on purpose — see above. Idempotent, and a no-op on iOS.
	await Notifications.setNotificationChannelAsync(options.channel?.id ?? "default", {
		name: options.channel?.name ?? "Default",
		importance: Notifications.AndroidImportance.MAX,
	}).catch(() => {})

	let status = read_permission(await Notifications.getPermissionsAsync())
	if (status !== "granted") {
		status = read_permission(await Notifications.requestPermissionsAsync())
		if (status === "denied") {
			throw new PushSubscribeError(
				"permission_denied",
				"Notification permission was denied. The OS will not ask again — the user has to change it in Settings."
			)
		}
		if (status !== "granted") {
			throw new PushSubscribeError(
				"permission_dismissed",
				"The permission prompt was dismissed without an answer. You can ask again later."
			)
		}
	}

	let registration: PushRegistration
	try {
		registration = await mint(options)
	} catch (cause) {
		if (cause instanceof PushSubscribeError) throw cause
		throw new PushSubscribeError(
			"failed",
			`Could not get a push token: ${cause instanceof Error ? cause.message : String(cause)}`
		)
	}
	await set_off(options.storage, false)
	return registration
}

export const subscribe = Object.assign(subscribe_now, { supported, permission, current, reason })

/**
 * Unregister this device, returning the registration that was removed so you can delete
 * your stored copy. Returns null when there was nothing registered. Remembers the choice
 * (in `storage`, when given) so `current()` says null until the next `subscribe()`.
 */
export async function unsubscribe(
	options: SubscribeOptions = {}
): Promise<PushRegistration | null> {
	const registration = await current(options)
	if (!registration) return null
	await Notifications.unregisterForNotificationsAsync().catch(() => {})
	await set_off(options.storage, true)
	return registration
}

/** Options for {@link subscription}: how to register, plus everything `subscribe` takes. */
export interface SubscriptionOptions extends SubscribeOptions {
	/**
	 * Where to file the registration: an absolute URL it's POSTed to as JSON — a phone
	 * has no origin for a relative one — or a function for anything beyond that.
	 * Without it the token is only held by the phone, and the server can't push to what
	 * it never learned about.
	 */
	register?: Filing<PushRegistration>
	/**
	 * How to unfile it on disable: a URL sent `DELETE` with `{ token }` as JSON, or a
	 * function receiving the removed registration.
	 */
	unregister?: Filing<PushRegistration>
}

/** Why an enable failed: `subscribe.reason`'s union, plus the register call failing. */
export type PushReason = PushSubscribeError["reason"] | "register_failed"

/** The toggle's state on a phone. */
export type PushState = MachineState<PushSubscribeError["reason"]>

/**
 * This device's push registration as a state machine — the same one `postboi/push`
 * builds for the browser, so `on`, `busy`, `reason`, `toggle()` and the rest mean the
 * same thing on both. Re-files the token when the OS rotates it underneath a running
 * app, while something is listening.
 *
 * @example
 * ```ts
 * import { subscription } from "postboi/push/expo"
 * import AsyncStorage from "@react-native-async-storage/async-storage"
 *
 * const push = subscription({
 * 	register: "https://example.com/push/registrations",
 * 	storage: AsyncStorage,
 * })
 * push.subscribe((state) => render(state.on))
 * ```
 */
export function subscription(options: SubscriptionOptions = {}) {
	return machine<PushRegistration, PushSubscribeError["reason"]>(
		{
			supported,
			current: () => current(options),
			subscribe: () => subscribe_now(options),
			unsubscribe: () => unsubscribe(options),
			reason,
			identify: ({ token }) => ({ token }),
			rotations(listener) {
				const handle = Notifications.addPushTokenListener((token) => {
					// The listener hands over the *device* token. Registered natively that
					// is the registration; registered through Expo, the Expo token that
					// wraps it has changed too, so it's minted afresh.
					const next = options.native ? Promise.resolve(native_registration(token)) : mint(options)
					next.then(listener).catch(() => {})
				})
				return () => handle.remove()
			},
		},
		options
	)
}

export type PushSubscriptionStore = ReturnType<typeof subscription>

/**
 * The toggle as a React hook — the phone's `usePush`, with the same shape as the one in
 * `postboi/react`. Call `toggle` from a press.
 *
 * @example
 * ```tsx
 * const push = usePush({ register: "https://example.com/push/registrations" })
 *
 * <Switch value={push.on} disabled={push.busy || !push.supported} onValueChange={push.toggle} />
 * ```
 */
export function usePush(
	options: SubscriptionOptions = {}
): PushState & Pick<PushSubscriptionStore, "enable" | "disable" | "toggle"> {
	const [controller] = useState(() => subscription(options))
	const state = useSyncExternalStore(controller.subscribe, controller.now, controller.now)
	return {
		...state,
		enable: controller.enable,
		disable: controller.disable,
		toggle: controller.toggle,
	}
}
