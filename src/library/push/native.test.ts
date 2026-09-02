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

function granted() {
	expo.permissions.status = "granted"
	expo.permissions.granted = true
}

/** A user who said yes at the prompt: the next request comes back granted. */
function says_yes() {
	expo.notifications.requestPermissionsAsync.mockResolvedValueOnce({
		status: "granted",
		granted: true,
		canAskAgain: true,
	})
}

beforeEach(async () => {
	vi.clearAllMocks()
	expo.listeners.clear()
	expo.permissions.status = "undetermined"
	expo.permissions.granted = false
	expo.permissions.canAskAgain = true
	delete expo.permissions.ios
	expo.constants.platform = { ios: {} }
	expo.constants.executionEnvironment = "standalone"
	expo.constants.expoConfig = { extra: { eas: { projectId: "proj-1" } } }
	// The module-level memory is per process: forget whatever the last test registered.
	await unsubscribe()
	vi.clearAllMocks()
})

describe("subscribe", () => {
	it("creates the Android channel, asks, and hands back an Expo token for the project", async () => {
		says_yes()

		expect(await subscribe()).toEqual(EXPO_REGISTRATION)
		// The channel comes before the prompt: on Android 13+ there is no prompt without one.
		const channel = expo.notifications.setNotificationChannelAsync.mock.invocationCallOrder[0]
		const asked = expo.notifications.requestPermissionsAsync.mock.invocationCallOrder[0]
		expect(channel).toBeLessThan(asked)
		expect(expo.notifications.setNotificationChannelAsync).toHaveBeenCalledWith("default", {
			name: "Default",
			importance: 5,
		})
		// The device token is fetched here and handed over, so the platform's echo of that
		// fetch is one the rotation listener can recognise as its own.
		expect(expo.notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({
			projectId: "proj-1",
			devicePushToken: { type: "ios", data: "a".repeat(64) },
		})
	})

	it("doesn't ask again once granted", async () => {
		granted()
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

		// Android reports a backed-out prompt as denied-but-can-ask-again. That's a shrug,
		// not a wall: "go to Settings" would be the wrong advice.
		expo.notifications.requestPermissionsAsync.mockResolvedValueOnce({
			status: "denied",
			granted: false,
			canAskAgain: true,
		})
		const backed_out = await subscribe().catch((e) => e)
		expect(subscribe.reason(backed_out)).toBe("permission_dismissed")

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
		granted()
		expect(await subscribe({ native: true })).toEqual({
			token: "a".repeat(64),
			provider: "apns",
			platform: "ios",
		})
		expo.constants.platform = { android: {} }
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
		granted()
		expo.constants.expoConfig = { extra: {} }
		const error = await subscribe().catch((e) => e)
		expect(subscribe.reason(error)).toBe("missing_project")
		expect(String(error)).toContain("eas init")
		// An explicit id wins, and a native registration never needed one.
		expect(await subscribe({ project_id: "proj-2" })).toEqual(EXPO_REGISTRATION)
		expect(expo.notifications.getExpoPushTokenAsync).toHaveBeenLastCalledWith(
			expect.objectContaining({ projectId: "proj-2" })
		)
		expect(await subscribe({ native: true })).toMatchObject({ provider: "apns" })
	})

	it("reports a token exchange that fails as failed, not as one of the walls", async () => {
		granted()
		expo.notifications.getExpoPushTokenAsync.mockRejectedValueOnce(new Error("offline"))
		const error = await subscribe().catch((e) => e)
		expect(subscribe.reason(error)).toBe("failed")
		expect(String(error)).toContain("offline")
		// Nothing was remembered for a subscribe that didn't happen.
		expect(await subscribe.current()).toBeNull()
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
	it("is what the last subscribe registered — not what permission alone would say", async () => {
		// Android 12 and below grant by default: a fresh install has permission and no
		// registration, and a toggle that read "granted" as "on" would lie.
		granted()
		expect(await subscribe.current()).toBeNull()

		await subscribe()
		expect(await subscribe.current()).toEqual(EXPO_REGISTRATION)
		// Reported from memory: no prompt, and no token exchange.
		expect(expo.notifications.requestPermissionsAsync).not.toHaveBeenCalled()
		expect(expo.notifications.getExpoPushTokenAsync).toHaveBeenCalledTimes(1)
	})

	it("is null once permission has been revoked in Settings, whatever was remembered", async () => {
		granted()
		await subscribe()
		expo.permissions.status = "denied"
		expo.permissions.granted = false
		expo.permissions.canAskAgain = false
		expect(await subscribe.current()).toBeNull()
	})

	it("remembers the registration in the storage given, and forgets it on unsubscribe", async () => {
		granted()
		const storage = memory_storage()

		await subscribe({ storage })
		expect(JSON.parse(storage.store.get("postboi:push")!)).toEqual(EXPO_REGISTRATION)
		expect(await subscribe.current({ storage })).toEqual(EXPO_REGISTRATION)
		// A different memory knows nothing about it.
		expect(await subscribe.current()).toBeNull()

		expect(await unsubscribe({ storage })).toEqual(EXPO_REGISTRATION)
		expect(expo.notifications.unregisterForNotificationsAsync).toHaveBeenCalled()
		expect(storage.store.has("postboi:push")).toBe(false)
		// Permission is still granted, but the user said no: that's what a toggle renders.
		expect(await subscribe.current({ storage })).toBeNull()
		expect(await unsubscribe({ storage })).toBeNull()
	})

	it("ignores a memory it can't read", async () => {
		const storage = memory_storage()
		storage.store.set("postboi:push", "not json")
		expect(await subscribe.current({ storage })).toBeNull()
		storage.store.set("postboi:push", JSON.stringify({ token: 1 }))
		expect(await subscribe.current({ storage })).toBeNull()
	})
})

describe("subscription", () => {
	it("enables, files the registration at an absolute URL, and lands on", async () => {
		says_yes()
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

	it("refuses a relative register URL up front, rather than as a bare register_failed", () => {
		expect(() => subscription({ register: "/push/registrations" })).toThrow(/absolute URL/)
		expect(() => subscription({ unregister: "push" })).toThrow(/absolute URL/)
		// Functions and absolute URLs are fine.
		subscription({ register: async () => {}, unregister: "http://localhost:5173/push" })
	})

	it("unfiles by token on disable", async () => {
		granted()
		await subscribe()
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
		expect(await subscribe.current()).toBeNull()
		vi.unstubAllGlobals()
	})

	it("re-files a token the OS rotates underneath a running app, while something listens", async () => {
		granted()
		await subscribe()
		const filed: Array<unknown> = []
		const push = subscription({
			register: async (registration) => void filed.push(registration),
		})

		const stop = push.subscribe(() => {})
		await vi.waitFor(() => expect(push.now().on).toBe(true))
		expect(expo.listeners.size).toBe(1)

		// The platform echoes the token this module itself just fetched: not a rotation.
		for (const listener of expo.listeners) listener({ type: "ios", data: "a".repeat(64) })
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(filed).toHaveLength(0)
		expect(expo.notifications.getExpoPushTokenAsync).toHaveBeenCalledTimes(1)

		// A different device token is one the OS rolled: minted afresh, remembered, filed.
		expo.notifications.getExpoPushTokenAsync.mockResolvedValueOnce({
			type: "expo",
			data: "ExponentPushToken[rotated]",
		})
		for (const listener of expo.listeners) listener({ type: "ios", data: "b".repeat(64) })
		await vi.waitFor(() => expect(filed).toHaveLength(1))
		expect(filed[0]).toMatchObject({ token: "ExponentPushToken[rotated]" })
		expect(await subscribe.current()).toMatchObject({ token: "ExponentPushToken[rotated]" })

		// Detaching the last listener lets the native listener go too.
		stop()
		expect(expo.listeners.size).toBe(0)
	})

	it("lets a rotation that lands during the first read through once the read says on", async () => {
		granted()
		await subscribe()
		const filed: Array<unknown> = []
		const push = subscription({
			register: async (registration) => void filed.push(registration),
		})
		// Hold the first read on the permission check, and rotate underneath it.
		let release!: () => void
		expo.notifications.getPermissionsAsync.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = () => resolve({ ...expo.permissions })
				})
		)
		push.subscribe(() => {})
		expo.notifications.getExpoPushTokenAsync.mockResolvedValueOnce({
			type: "expo",
			data: "ExponentPushToken[rotated]",
		})
		for (const listener of expo.listeners) listener({ type: "ios", data: "c".repeat(64) })
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(filed).toHaveLength(0)

		release()
		await vi.waitFor(() => expect(filed).toHaveLength(1))
	})

	it("re-reads reality when a screen comes back, and listens to nothing where push isn't supported", async () => {
		granted()
		await subscribe()
		const push = subscription({ register: async () => {} })
		const stop = push.subscribe(() => {})
		await vi.waitFor(() => expect(push.now().on).toBe(true))
		stop()

		// Turned off elsewhere while the screen was away.
		await unsubscribe()
		push.subscribe(() => {})
		await vi.waitFor(() => expect(push.now().on).toBe(false))

		expo.constants.platform = { web: {} }
		expo.listeners.clear()
		const web = subscription({ register: async () => {} })
		web.subscribe(() => {})
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(expo.listeners.size).toBe(0)
		expect(web.now().supported).toBe(false)
	})
})
