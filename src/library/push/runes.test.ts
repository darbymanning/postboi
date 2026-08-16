/**
 * The runes wrapper. Named `runes.test.ts` rather than `subscription.svelte.test.ts`
 * because the vitest project excludes `*.svelte.test.ts` — that pattern is reserved for
 * component tests needing a browser. This one is a `.svelte.ts` *module*, so the state
 * runs perfectly well in node.
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

import { subscription } from "./subscription.svelte.js"

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

describe("subscription (runes)", () => {
	it("reads as plain properties — no store subscription in sight", async () => {
		client.subscribe.current.mockResolvedValue(SUBSCRIPTION as never)

		const push = subscription({ register: "/push" })
		await vi.waitFor(() => expect(push.on).toBe(true))
		expect(push.supported).toBe(true)
		expect(push.busy).toBe(false)
		expect(push.reason).toBe(null)
	})

	it("toggle flips it, and works detached from the object", async () => {
		client.subscribe.mockResolvedValue(SUBSCRIPTION as never)
		client.unsubscribe.mockResolvedValue(SUBSCRIPTION as never)
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: true }))
		)

		const push = subscription({ register: "/push" })
		// Exactly what `onclick={push.toggle}` does with it.
		const { toggle } = push

		await toggle()
		expect(push.on).toBe(true)

		await toggle()
		expect(push.on).toBe(false)
	})

	it("a failed enable surfaces the reason", async () => {
		client.subscribe.mockRejectedValue(new Error("no"))
		client.subscribe.reason.mockReturnValue("permission_denied" as never)

		const push = subscription()
		await push.enable()

		expect(push.reason).toBe("permission_denied")
		expect(push.on).toBe(false)
	})

	it("constructs during SSR without touching a browser API", () => {
		client.subscribe.supported.mockReturnValue(false)

		const push = subscription({ register: "/push" })

		expect(push.supported).toBe(false)
		expect(push.on).toBe(false)
	})
})
