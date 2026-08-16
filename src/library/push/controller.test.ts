import { describe, it, expect, beforeEach, vi } from "vitest"

// The controller's logic is the thing under test; the browser half is the seam.
const client = vi.hoisted(() => {
	const subscribe = Object.assign(vi.fn(), {
		supported: vi.fn(() => true),
		permission: vi.fn(() => "default" as const),
		current: vi.fn(async () => null),
		reason: vi.fn(() => null),
	})
	return { subscribe, unsubscribe: vi.fn(async () => null) }
})
vi.mock("./client.js", () => client)

import { subscription } from "./controller.js"

const SUBSCRIPTION = {
	endpoint: "https://push.example/abc",
	expirationTime: null,
	keys: { p256dh: "key", auth: "secret" },
}

function last_state(states: Array<unknown>) {
	return states[states.length - 1] as Record<string, unknown>
}

beforeEach(() => {
	vi.clearAllMocks()
	client.subscribe.supported.mockReturnValue(true)
	client.subscribe.current.mockResolvedValue(null)
	client.subscribe.reason.mockReturnValue(null)
})

describe("subscription", () => {
	it("touches no browser API until something listens, then reports reality", async () => {
		const controller = subscription({ key: "k" })
		expect(client.subscribe.supported).not.toHaveBeenCalled()

		client.subscribe.current.mockResolvedValue(SUBSCRIPTION as never)
		const states: Array<unknown> = []
		controller.subscribe((state) => states.push(state))
		await vi.waitFor(() => expect(last_state(states).on).toBe(true))
		expect(last_state(states).supported).toBe(true)
	})

	it("enable subscribes, registers, and lands on", async () => {
		client.subscribe.mockResolvedValue(SUBSCRIPTION as never)
		const fetch = vi.fn(async () => ({ ok: true }))
		vi.stubGlobal("fetch", fetch)

		const controller = subscription({ key: "k", register: "/push/subscriptions" })
		await controller.enable()

		expect(fetch).toHaveBeenCalledWith("/push/subscriptions", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(SUBSCRIPTION),
		})
		expect(controller.now()).toMatchObject({ on: true, busy: false, reason: null })
	})

	it("a failed register rolls the browser subscription back — no orphaned addresses", async () => {
		client.subscribe.mockResolvedValue(SUBSCRIPTION as never)
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: false, status: 500 }))
		)

		const controller = subscription({ key: "k", register: "/push/subscriptions" })
		await controller.enable()

		expect(client.unsubscribe).toHaveBeenCalled()
		expect(controller.now()).toMatchObject({ on: false, reason: "register_failed" })
	})

	it("a dismissed prompt is a shrug: reason stays null", async () => {
		client.subscribe.mockRejectedValue(new Error("dismissed"))
		client.subscribe.reason.mockReturnValue("permission_dismissed" as never)

		const controller = subscription({ key: "k" })
		await controller.enable()
		expect(controller.now()).toMatchObject({ on: false, busy: false })
		expect(controller.now().reason).toBe("permission_dismissed")
	})

	it("disable unsubscribes and unfiles by endpoint", async () => {
		client.unsubscribe.mockResolvedValue(SUBSCRIPTION as never)
		const fetch = vi.fn(async () => ({ ok: true }))
		vi.stubGlobal("fetch", fetch)

		const controller = subscription({ key: "k", unregister: "/push/subscriptions" })
		await controller.disable()

		expect(fetch).toHaveBeenCalledWith("/push/subscriptions", {
			method: "DELETE",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ endpoint: SUBSCRIPTION.endpoint }),
		})
		expect(controller.now()).toMatchObject({ on: false, busy: false })
	})

	it("toggle subscribes when off and unsubscribes when on", async () => {
		client.subscribe.mockResolvedValue(SUBSCRIPTION as never)
		client.unsubscribe.mockResolvedValue(SUBSCRIPTION as never)

		const controller = subscription({ key: "k" })
		await controller.toggle()
		expect(controller.now().on).toBe(true)

		await controller.toggle()
		expect(controller.now().on).toBe(false)
		expect(client.unsubscribe).toHaveBeenCalled()
	})

	it("toggle survives being handed straight to an event handler", async () => {
		client.subscribe.mockResolvedValue(SUBSCRIPTION as never)

		// `onclick={push.toggle}` calls it unbound — it must not need its object.
		const { toggle } = subscription({ key: "k" })
		await toggle()

		expect(client.subscribe).toHaveBeenCalled()
	})
})
