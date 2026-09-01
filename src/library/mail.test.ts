import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mail } from "./mail.js"

/** Answers the hosted testing API's three-call paste flow and records every call. */
function stub_hosted() {
	const calls: Array<{ path: string; method: string; body?: unknown }> = []
	const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input))
		calls.push({
			path: url.pathname,
			method: init?.method ?? "GET",
			body: init?.body ? JSON.parse(String(init.body)) : undefined,
		})
		const answer =
			init?.method === "POST" && url.pathname === "/v1/testing"
				? { id: "run_9", address: "acme+test-zzz@send.postboi.email" }
				: url.pathname.endsWith("/source")
					? { ok: true }
					: { id: "run_9", status: "received", report: { status: "pass", findings: [] } }
		return new Response(JSON.stringify(answer), {
			headers: { "content-type": "application/json" },
		})
	})
	return { calls, fetcher }
}

describe("mail({ test })", () => {
	let restore: typeof globalThis.fetch

	beforeEach(() => {
		restore = globalThis.fetch
		vi.stubEnv("POSTBOI_TOKEN", "tok")
		vi.stubEnv("POSTBOI_API_URL", "https://api.test")
	})

	afterEach(() => {
		globalThis.fetch = restore
		vi.unstubAllEnvs()
	})

	it("runs the named test through the hosted paste flow and answers the report", async () => {
		const { calls, fetcher } = stub_hosted()
		globalThis.fetch = fetcher as typeof fetch

		const test = await mail({
			test: "welcome",
			subject: "Welcome v3",
			body: "<p>hi</p>",
			clients: ["outlook-windows"],
		})

		expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
			"POST /v1/testing",
			"POST /v1/testing/run_9/source",
			"GET /v1/testing/run_9",
		])
		// The name rides as `series` — same name, same dashboard entry, new attempt.
		expect(calls[0].body).toEqual({ series: "welcome", clients: ["outlook-windows"] })
		expect(calls[1].body).toEqual({ subject: "Welcome v3", html: "<p>hi</p>" })
		expect(test.status).toBe("received")
		expect(test.report?.status).toBe("pass")
		expect(test.url).toBe("https://api.test/dashboard/testing/run_9")
	})

	it("two calls with one name are two attempts on one entry", async () => {
		const { calls, fetcher } = stub_hosted()
		globalThis.fetch = fetcher as typeof fetch

		await mail({ test: "test-1", body: "foo" })
		await mail({ test: "test-1", body: "bar" })

		const creates = calls.filter((c) => c.method === "POST" && c.path === "/v1/testing")
		expect(creates.map((c) => (c.body as { series: string }).series)).toEqual(["test-1", "test-1"])
	})

	it("refuses a body that isn't rendered HTML", async () => {
		const form = new FormData()
		form.set("name", "Ada")
		await expect(mail({ test: "contact", body: form })).rejects.toThrow(/HTML string/)
	})

	it("fails plainly without a token", async () => {
		vi.stubEnv("POSTBOI_TOKEN", "")
		await expect(mail({ test: "welcome", body: "<p>hi</p>" })).rejects.toThrow(/POSTBOI_TOKEN/)
	})

	it("types: recipients and tests don't mix, clients needs test", () => {
		// Compile-time contracts — the narrowing Darby asked for. Nothing runs.
		function never_called() {
			// @ts-expect-error — `to` is not allowed alongside `test`
			void mail({ test: "foo", to: "me@example.com", body: "<p>hi</p>" })
			// @ts-expect-error — `clients` only exists on a test send
			void mail({ to: "me@example.com", body: "<p>hi</p>", clients: ["outlook-windows"] })
			// @ts-expect-error — a test still needs a body
			void mail({ test: "foo" })
		}
		expect(typeof never_called).toBe("function")
	})
})
