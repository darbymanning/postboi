import { describe, it, expect } from "vitest"
import { webhook } from "./handler.js"
import { mock_request } from "./mock.js"

/**
 * The universal handler's own concern is the carrier shapes — one export that works as
 * a Next route handler (bare Request) and as an Astro/Remix/SvelteKit handler (context
 * carrying .request). The response contract it wraps around receive() is exercised
 * per-status here and again through postboi/kit's delegation in kit.test.ts.
 */
describe("postboi/webhooks webhook()", () => {
	it("takes a bare Request — a Next route handler or Worker fetch branch", async () => {
		const { request, secret } = await mock_request({ provider: "resend", type: "opened" })

		const seen: Array<string> = []
		const handler = webhook((event) => void seen.push(`${event.type}:${event.email}`), {
			provider: "resend",
			secret,
		})
		const response = await handler(request)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ received: 1 })
		expect(seen).toEqual(["opened:recipient@example.com"])
	})

	it("takes a context carrying .request — Astro, Remix, SvelteKit", async () => {
		const { request, secret } = await mock_request({ provider: "resend", type: "delivered" })

		const seen: Array<string> = []
		const handler = webhook((event) => void seen.push(event.type), {
			provider: "resend",
			secret,
		})
		const response = await handler({ request })

		expect(response.status).toBe(200)
		expect(seen).toEqual(["delivered"])
	})

	it("returns 401 on a bad signature so the provider knows it was rejected", async () => {
		const { request } = await mock_request({ provider: "resend", type: "delivered" })

		const handler = webhook(() => {}, { provider: "resend", secret: "whsec_d3JvbmchIQ==" })
		expect((await handler(request)).status).toBe(401)
	})

	it("returns 400 on an unparseable payload", async () => {
		const request = new Request("https://example.com/webhooks", {
			method: "POST",
			body: "not json",
		})
		const handler = webhook(() => {}, { provider: "resend", verify: false })
		expect((await handler(request)).status).toBe(400)
	})

	it("returns 500 when the handler throws, so the provider retries", async () => {
		const { request, secret } = await mock_request({ provider: "resend", type: "delivered" })

		const handler = webhook(
			() => {
				throw new Error("database down")
			},
			{ provider: "resend", secret }
		)
		expect((await handler(request)).status).toBe(500)
	})
})
