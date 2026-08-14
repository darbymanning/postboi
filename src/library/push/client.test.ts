import { describe, it, expect, afterEach, vi } from "vitest"
import { subscribe, unsubscribe } from "./client.js"

/**
 * The browser half of push, faked at the four globals `supported()` looks for. No DOM
 * environment: `PushManager` and friends are only ever felt through these calls, and a
 * fake that answers them proves the same thing a jsdom would.
 */
function browser({
	subscription,
	registered = true,
	windowed = true,
}: {
	subscription?: unknown
	registered?: boolean
	windowed?: boolean
} = {}) {
	vi.stubGlobal(
		"window",
		windowed ? { PushManager: class {}, Notification: { permission: "granted" } } : undefined
	)
	vi.stubGlobal("Notification", { permission: "granted" })
	vi.stubGlobal("navigator", {
		serviceWorker: {
			getRegistration: async () =>
				registered
					? { pushManager: { getSubscription: async () => subscription ?? null } }
					: undefined,
		},
	})
}

const STORED = {
	endpoint: "https://push.example/abc",
	expirationTime: null,
	keys: { p256dh: "a-public-key", auth: "an-auth-secret" },
}

const fake_subscription = () => ({ toJSON: () => STORED, unsubscribe: vi.fn(async () => true) })

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("subscribe.current", () => {
	it("hands back the subscription this browser already has", async () => {
		browser({ subscription: fake_subscription() })
		expect(await subscribe.current()).toEqual(STORED)
	})

	/**
	 * The state the whole helper exists for: permission is still granted, so
	 * `subscribe.permission()` says "granted" while there is nothing subscribed — which is
	 * what a browser looks like after someone turned notifications off again.
	 */
	it("is null when permission is granted but nothing is subscribed", async () => {
		browser({ subscription: null })
		expect(subscribe.permission()).toBe("granted")
		expect(await subscribe.current()).toBeNull()
	})

	it("is null with no service worker registered, and in a browser without Web Push", async () => {
		browser({ registered: false })
		expect(await subscribe.current()).toBeNull()

		browser({ windowed: false, subscription: fake_subscription() })
		expect(await subscribe.current()).toBeNull()
	})
})

describe("unsubscribe", () => {
	it("still removes the subscription and returns the copy you stored", async () => {
		const subscription = fake_subscription()
		browser({ subscription })

		expect(await unsubscribe()).toEqual(STORED)
		expect(subscription.unsubscribe).toHaveBeenCalled()
		// And the browser is empty afterwards, as far as anyone asking is concerned.
		browser({ subscription: null })
		expect(await subscribe.current()).toBeNull()
	})
})
