/**
 * The Svelte wrapper's own surface: property delegation, laziness, and detached
 * handoff. Controller semantics (rollback, busy, reasons) are controller.test.ts's job.
 *
 * The client mock is a copy of controller.test.ts's on purpose: `vi.mock` factories
 * hoist, and a shared helper module would be packaged into dist by `svelte-package`
 * (which ships every non-test file in src/library) — vitest import and all.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

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

import { subscription } from "./toggle.js"

const SUBSCRIPTION = {
	endpoint: "https://push.example/abc",
	expirationTime: null,
	keys: { p256dh: "key", auth: "secret" },
}

beforeEach(() => {
	vi.clearAllMocks()
	client.subscribe.supported.mockReturnValue(true)
	client.subscribe.current.mockResolvedValue(null)
	client.subscribe.reason.mockReturnValue(null)
})

describe("subscription (postboi/svelte)", () => {
	it("construction touches no browser API — laziness survives the wrapper", () => {
		const push = subscription({ register: "/push" })

		expect(client.subscribe.supported).not.toHaveBeenCalled()
		// Untracked reads don't start the machine either; they just report its state.
		expect(push.on).toBe(false)
		expect(push.busy).toBe(false)
	})

	it("properties read the machine live, with no store ceremony", async () => {
		client.subscribe.mockResolvedValue(SUBSCRIPTION as never)
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: true }))
		)

		const push = subscription({ register: "/push" })
		await push.enable()
		expect(push.on).toBe(true)
		expect(push.reason).toBe(null)

		// `supported` comes from the read, which stays lazy — an explicit refresh runs it.
		expect(push.supported).toBe(false)
		await push.refresh()
		expect(push.supported).toBe(true)
	})

	it("toggle works detached, exactly as onclick={push.toggle} hands it over", async () => {
		client.subscribe.current.mockResolvedValue(SUBSCRIPTION as never)
		client.unsubscribe.mockResolvedValue(SUBSCRIPTION as never)

		const { toggle } = subscription({ register: "/push" })
		await toggle()

		expect(client.unsubscribe).toHaveBeenCalled()
	})
})
