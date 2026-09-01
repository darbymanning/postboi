import { describe, it, expect, beforeEach, vi } from "vitest"

/**
 * The phone half of push, faked at the two Expo modules it stands on. Neither is
 * installed here — an Expo app is the only place this module runs — so the fakes are
 * the whole of what `native.ts` can feel, which is the same thing a device would prove.
 */
const expo = vi.hoisted(() => {
	const permissions = { status: "undetermined", granted: false, canAskAgain: true } as {
		status: "granted" | "denied" | "undetermined"
		granted: boolean
		canAskAgain: boolean
		ios?: { status: number }
	}
	const listeners = new Set<(token: { type: string; data: string }) => void>()
	return {
		permissions,
		listeners,
		notifications: {
			IosAuthorizationStatus: {
				NOT_DETERMINED: 0,
				DENIED: 1,
				AUTHORIZED: 2,
				PROVISIONAL: 3,
				EPHEMERAL: 4,
			},
			AndroidImportance: { MIN: 1, LOW: 2, DEFAULT: 3, HIGH: 4, MAX: 5 },
			getPermissionsAsync: vi.fn(async () => ({ ...permissions })),
			requestPermissionsAsync: vi.fn(async () => ({ ...permissions })),
			getExpoPushTokenAsync: vi.fn(async () => ({
				type: "expo",
				data: "ExponentPushToken[abc]",
			})),
			getDevicePushTokenAsync: vi.fn(async () => ({ type: "ios", data: "a".repeat(64) })),
			unregisterForNotificationsAsync: vi.fn(async () => {}),
			setNotificationChannelAsync: vi.fn(async () => null),
			addPushTokenListener: vi.fn((listener: (token: { type: string; data: string }) => void) => {
				listeners.add(listener)
				return { remove: () => listeners.delete(listener) }
			}),
		},
		constants: {
			expoConfig: { extra: { eas: { projectId: "proj-1" } } },
			easConfig: null,
			executionEnvironment: "standalone",
			platform: { ios: {} } as { ios?: unknown; android?: unknown; web?: unknown },
		},
	}
})
vi.mock("expo-notifications", () => expo.notifications)
vi.mock("expo-constants", () => ({ default: expo.constants }))

import { subscribe, unsubscribe, subscription, PushSubscribeError } from "./native.js"

const EXPO_REGISTRATION = { token: "ExponentPushToken[abc]", provider: "expo", platform: "ios" }

/** An in-memory AsyncStorage, the shape `storage` takes. */
function memory_storage() {
	const store = new Map<string, string>()
	return {
		store,
		getItem: async (key: string) => store.get(key) ?? null,
		setItem: async (key: string, value: string) => void store.set(key, value),
		removeItem: async (key: string) => void store.delete(key),
	}
}

beforeEach(async () => {
	vi.clearAllMocks()
	expo.listeners.clear()
	expo.permissions.status = "undetermined"
	expo.permissions.granted = false
	delete expo.permissions.ios
	expo.constants.platform = { ios: {} }
	expo.constants.executionEnvironment = "standalone"
	expo.constants.expoConfig = { extra: { eas: { projectId: "proj-1" } } }
	// The module-level off switch is per process; a fresh subscribe resets it.
	expo.permissions.status = "granted"
	expo.permissions.granted = true
	await subscribe()
	expo.permissions.status = "undetermined"
	expo.permissions.granted = false
	vi.clearAllMocks()
})

describe("subscribe", () => {
	it("creates the Android channel, asks, and hands back an Expo token for the project", async () => {
		expo.notifications.requestPermissionsAsync.mockResolvedValueOnce({
			status: "granted",
			granted: true,
			canAskAgain: true,
		})

		expect(await subscribe()).toEqual(EXPO_REGISTRATION)
		// The channel comes before the prompt: on Android 13+ there is no prompt without one.
		const channel = expo.notifications.setNotificationChannelAsync.mock.invocationCallOrder[0]
		const asked = expo.notifications.requestPermissionsAsync.mock.invocationCallOrder[0]
		expect(channel).toBeLessThan(asked)
		expect(expo.notifications.setNotificationChannelAsync).toHaveBeenCalledWith("default", {
			name: "Default",
			importance: 5,
		})
		expect(expo.notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: "proj-1" })
	})

	it("doesn't ask again once granted", async () => {
		expo.permissions.status = "granted"
		expo.permissions.granted = true
		await subscribe()
		expect(expo.notifications.requestPermissionsAsync).not.toHaveBeenCalled()
	})

	it("tells denied and dismissed apart, and both from a subscribe that isn't ours", async () => {
		expo.notifications.requestPermissionsAsync.mockResolvedValueOnce({
			status: "denied",
			granted: false,
			canAskAgain: false,
		})
		const denied = await subscribe().catch((e) => e)
		expect(subscribe.reason(denied)).toBe("permission_denied")
		expect(String(denied)).toContain("Settings")

		expo.notifications.requestPermissionsAsync.mockResolvedValueOnce({
			status: "undetermined",
			granted: false,
			canAskAgain: true,
		})
		const dismissed = await subscribe().catch((e) => e)
		expect(subscribe.reason(dismissed)).toBe("permission_dismissed")

		expect(subscribe.reason(new Error("other"))).toBeNull()
		expect(denied).toBeInstanceOf(PushSubscribeError)
	})

	it("treats iOS provisional authorization as granted", async () => {
		expo.permissions.status = "undetermined"
		expo.permissions.ios = { status: 3 }
		await subscribe()
		expect(expo.notifications.requestPermissionsAsync).not.toHaveBeenCalled()
		expect(await subscribe.permission()).toBe("granted")
	})

	it("hands back the raw device token, tagged for the provider that sends to it", async () => {
		expo.permissions.status = "granted"
		expo.permissions.granted = true
		expect(await subscribe({ native: true })).toEqual({
			token: "a".repeat(64),
			provider: "apns",
			platform: "ios",
		})
		expo.notifications.getDevicePushTokenAsync.mockResolvedValueOnce({
			type: "android",
			data: "fcm-token",
		})
		expect(await subscribe({ native: true })).toEqual({
			token: "fcm-token",
			provider: "fcm",
			platform: "android",
		})
		expect(expo.notifications.getExpoPushTokenAsync).not.toHaveBeenCalled()
	})

	it("refuses to mint an Expo token for no project, and says how to get one", async () => {
		expo.permissions.status = "granted"
		expo.permissions.granted = true
		expo.constants.expoConfig = { extra: {} }
		const error = await subscribe().catch((e) => e)
		expect(subscribe.reason(error)).toBe("missing_project")
		expect(String(error)).toContain("eas init")
		// An explicit id wins, and a native registration never needed one.
		expect(await subscribe({ project_id: "proj-2" })).toEqual(EXPO_REGISTRATION)
		expect(expo.notifications.getExpoPushTokenAsync).toHaveBeenLastCalledWith({
			projectId: "proj-2",
		})
		expect(await subscribe({ native: true })).toMatchObject({ provider: "apns" })
	})

	it("is unsupported on the web build and in Expo Go on Android, and says which", async () => {
		expo.constants.platform = { web: {} }
		expect(subscribe.supported()).toBe(false)
		expect(await subscribe.permission()).toBe("unsupported")
		const web = await subscribe().catch((e) => e)
		expect(subscribe.reason(web)).toBe("unsupported")
		expect(String(web)).toContain("postboi/push")

		expo.constants.platform = { android: {} }
		expo.constants.executionEnvironment = "storeClient"
		expect(subscribe.supported()).toBe(false)
		const go = await subscribe().catch((e) => e)
		expect(String(go)).toContain("development build")

		// Expo Go on iOS still has it.
		expo.constants.platform = { ios: {} }
		expect(subscribe.supported()).toBe(true)
	})
})

describe("current and unsubscribe", () => {
	it("reports the registration once permission is granted, without prompting", async () => {
		expect(await subscribe.current()).toBeNull()
		expo.permissions.status = "granted"
		expo.permissions.granted = true
		expect(await subscribe.current()).toEqual(EXPO_REGISTRATION)
		expect(expo.notifications.requestPermissionsAsync).not.toHaveBeenCalled()
	})

	it("remembers the off switch — in memory, or in the storage given", async () => {
		expo.permissions.status = "granted"
		expo.permissions.granted = true
		const storage = memory_storage()

		expect(await unsubscribe({ storage })).toEqual(EXPO_REGISTRATION)
		expect(expo.notifications.unregisterForNotificationsAsync).toHaveBeenCalled()
		expect(storage.store.get("postboi:push")).toBe("off")
		// Permission is still granted, but the user said no: that's what a toggle renders.
		expect(await subscribe.current({ storage })).toBeNull()
		expect(await unsubscribe({ storage })).toBeNull()

		// Subscribing again clears it.
		expect(await subscribe({ storage })).toEqual(EXPO_REGISTRATION)
		expect(storage.store.has("postboi:push")).toBe(false)
		expect(await subscribe.current({ storage })).toEqual(EXPO_REGISTRATION)
	})
})

describe("subscription", () => {
	it("enables, files the registration at an absolute URL, and lands on", async () => {
		expo.notifications.requestPermissionsAsync.mockResolvedValueOnce({
			status: "granted",
			granted: true,
			canAskAgain: true,
		})
		const fetch = vi.fn(async () => ({ ok: true }))
		vi.stubGlobal("fetch", fetch)

		const push = subscription({ register: "https://example.com/push/registrations" })
		await push.enable()

		expect(fetch).toHaveBeenCalledWith("https://example.com/push/registrations", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(EXPO_REGISTRATION),
		})
		expect(push.now()).toMatchObject({ on: true, busy: false, reason: null })
		vi.unstubAllGlobals()
	})

	it("unfiles by token on disable", async () => {
		expo.permissions.status = "granted"
		expo.permissions.granted = true
		const fetch = vi.fn(async () => ({ ok: true }))
		vi.stubGlobal("fetch", fetch)

		const push = subscription({ unregister: "https://example.com/push/registrations" })
		await push.toggle()

		expect(fetch).toHaveBeenCalledWith("https://example.com/push/registrations", {
			method: "DELETE",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ token: "ExponentPushToken[abc]" }),
		})
		expect(push.now()).toMatchObject({ on: false })
		vi.unstubAllGlobals()
	})

	it("re-files a token the OS rotates underneath a running app, while something listens", async () => {
		expo.permissions.status = "granted"
		expo.permissions.granted = true
		const filed: Array<unknown> = []
		const push = subscription({
			register: async (registration) => void filed.push(registration),
		})

		const stop = push.subscribe(() => {})
		await vi.waitFor(() => expect(push.now().on).toBe(true))
		expect(expo.listeners.size).toBe(1)

		expo.notifications.getExpoPushTokenAsync.mockResolvedValueOnce({
			type: "expo",
			data: "ExponentPushToken[rotated]",
		})
		for (const listener of expo.listeners) listener({ type: "ios", data: "b".repeat(64) })
		await vi.waitFor(() => expect(filed).toHaveLength(1))
		expect(filed[0]).toMatchObject({ token: "ExponentPushToken[rotated]" })

		// Detaching the last listener lets the native listener go too.
		stop()
		expect(expo.listeners.size).toBe(0)
	})
})
