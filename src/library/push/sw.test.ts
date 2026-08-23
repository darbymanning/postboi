import { describe, it, expect, afterEach, vi } from "vitest"
import { receive } from "./sw.js"
import { fake_worker, fake_subscription, STORED, VAPID_KEY } from "../../testing/worker.js"

/** `receive()` reads the worker globals, so the fake goes onto `globalThis`. */
function install(worker: ReturnType<typeof fake_worker>) {
	for (const [key, value] of Object.entries(worker.scope)) vi.stubGlobal(key, value)
	vi.stubGlobal("fetch", worker.fetch)
	return worker
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("the push handler", () => {
	it("shows what the Web Push provider sent, with the url carried on data for the click", async () => {
		const w = install(fake_worker())
		receive()

		await w.fire("push", {
			data: {
				json: () => ({ title: "Shipped", body: "On its way", icon: "/i.png", url: "/orders/7" }),
			},
		})

		expect(w.shown).toEqual([
			["Shipped", { body: "On its way", icon: "/i.png", data: { url: "/orders/7" } }],
		])
	})

	/**
	 * `userVisibleOnly` means every push owes the user a notification, and a browser that
	 * sees one skipped revokes the permission — so a payload from something that isn't
	 * postboi, or none at all, still has to show something rather than throw.
	 */
	it("still shows something for a payload that isn't ours, and for no payload at all", async () => {
		const w = install(fake_worker())
		receive()

		await w.fire("push", {
			data: {
				json: () => {
					throw new SyntaxError("not JSON")
				},
				text: () => "plain text",
			},
		})
		await w.fire("push", { data: null })

		expect(w.shown.map(([title, options]) => [title, (options as { body: string }).body])).toEqual([
			["", "plain text"],
			["", ""],
		])
	})

	it("merges the notification override over the defaults", async () => {
		const w = install(fake_worker())
		receive({ notification: (payload) => ({ title: payload.title ?? "Acme", tag: "orders" }) })

		await w.fire("push", { data: { json: () => ({ body: "no title on this one" }) } })

		expect(w.shown).toEqual([
			[
				"Acme",
				{
					body: "no title on this one",
					icon: undefined,
					data: { url: undefined },
					tag: "orders",
				},
			],
		])
	})
})

describe("the notificationclick handler", () => {
	it("focuses the tab already showing the url rather than opening a second one", async () => {
		const w = install(fake_worker({ windows: ["https://app.example/orders/7"] }))
		receive()

		await w.fire("notificationclick", {
			notification: { close: () => {}, data: { url: "/orders/7" } },
		})

		expect(w.focused).toEqual(["https://app.example/orders/7"])
		expect(w.opened).toEqual([])
	})

	it("opens a window when nothing is showing it, and does nothing without a url", async () => {
		const w = install(fake_worker({ windows: ["https://app.example/settings"] }))
		receive()

		await w.fire("notificationclick", {
			notification: { close: () => {}, data: { url: "/orders/7" } },
		})
		await w.fire("notificationclick", { notification: { close: () => {}, data: null } })

		expect(w.opened).toEqual(["https://app.example/orders/7"])
		expect(w.focused).toEqual([])
	})

	/** An app whose click means something looser than exact-match-or-new-window (a
	 * single-window PWA navigating its one open tab, an action button that answers in
	 * place) takes the click over — but never the close, which every handler owes. */
	it("hands the click to `click` instead of the default, data and action included", async () => {
		const w = install(fake_worker({ windows: ["https://app.example/orders/7"] }))
		const clicks: Array<unknown> = []
		let closed = false
		receive({ click: async (data, action) => void clicks.push([data, action]) })

		await w.fire("notificationclick", {
			notification: {
				close: () => (closed = true),
				data: { url: "/orders/7", thread: "t1" },
			},
			action: "reply",
		})

		expect(clicks).toEqual([[{ url: "/orders/7", thread: "t1" }, "reply"]])
		expect(closed).toBe(true)
		// The default would have focused the tab already showing the url — `click` replaces
		// it entirely, so nothing else moved.
		expect(w.focused).toEqual([])
		expect(w.opened).toEqual([])
	})
})

describe("the pushsubscriptionchange handler", () => {
	/** The whole reason this file exists: a rotation the server is never told about is one
	 * notification that silently goes nowhere. */
	it("re-subscribes and files the replacement with the endpoint it replaced", async () => {
		const w = install(fake_worker({ subscription: fake_subscription() }))
		receive({ key: VAPID_KEY, register: "/push/subscriptions" })

		await w.fire("pushsubscriptionchange", {
			oldSubscription: { endpoint: "https://push.example/old" },
		})

		expect(w.subscribed).toHaveLength(1)
		expect((w.subscribed[0] as { userVisibleOnly: boolean }).userVisibleOnly).toBe(true)
		expect(w.posted).toEqual([
			["/push/subscriptions", { ...STORED, old_endpoint: "https://push.example/old" }],
		])
	})

	it("takes the replacement the browser already made rather than minting a second", async () => {
		const w = install(fake_worker())
		const filed: Array<unknown> = []
		receive({ key: VAPID_KEY, register: async (s) => void filed.push(s) })

		await w.fire("pushsubscriptionchange", { newSubscription: fake_subscription() })

		expect(w.subscribed).toEqual([])
		expect(filed).toEqual([STORED])
	})

	/** A key that only exists at runtime (a Workers secret behind an endpoint) can't be in
	 * the options as a string — and a rotation wakes the worker cold, so an eager fetch at
	 * startup would lose the race. The function form is asked exactly when minting needs it. */
	it("resolves a function key at the moment a rotation actually needs one", async () => {
		const w = install(fake_worker({ subscription: fake_subscription() }))
		let asked = 0
		receive({
			key: async () => (asked++, VAPID_KEY),
			register: "/push/subscriptions",
		})
		expect(asked).toBe(0)

		// The browser handing over its own replacement needs no key, so none is fetched.
		await w.fire("pushsubscriptionchange", { newSubscription: fake_subscription() })
		expect(asked).toBe(0)

		await w.fire("pushsubscriptionchange", {
			oldSubscription: { endpoint: "https://push.example/old" },
		})
		expect(asked).toBe(1)
		expect(w.subscribed).toHaveLength(1)
		expect(w.posted).toEqual([
			["/push/subscriptions", STORED],
			["/push/subscriptions", { ...STORED, old_endpoint: "https://push.example/old" }],
		])
	})

	it("treats a function key that resolves to nothing as no key at all", async () => {
		const w = install(fake_worker({ subscription: fake_subscription() }))
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		receive({ key: async () => null, register: "/push/subscriptions" })

		await w.fire("pushsubscriptionchange", {})

		expect(w.subscribed).toEqual([])
		expect(w.posted).toEqual([])
		expect(warn).toHaveBeenCalledOnce()
		warn.mockRestore()
	})

	it("says so in the console rather than failing silently when there is no key to re-subscribe with", async () => {
		const w = install(fake_worker({ subscription: fake_subscription() }))
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		receive({ register: "/push/subscriptions" })

		await w.fire("pushsubscriptionchange", {})

		expect(w.posted).toEqual([])
		expect(warn.mock.calls[0]?.[0]).toContain("bunx postboi sync")
		warn.mockRestore()
	})
})
