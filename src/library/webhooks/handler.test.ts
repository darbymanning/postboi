import { describe, it, expect } from "vitest"
import { webhook, type NodeRequest } from "./handler.js"
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

/** A signed web Request reshaped into what node's http server hands middleware. */
async function as_node(request: Request): Promise<NodeRequest> {
	const bytes = new Uint8Array(await request.arrayBuffer())
	const headers: Record<string, string> = {}
	request.headers.forEach((value, name) => (headers[name] = value))
	return {
		method: "POST",
		url: "/webhooks",
		headers,
		async *[Symbol.asyncIterator]() {
			yield bytes
		},
	}
}

function fake_response() {
	return {
		statusCode: 0,
		headers: {} as Record<string, string>,
		body: "",
		setHeader(name: string, value: string) {
			this.headers[name] = value
		},
		end(chunk: string) {
			this.body = chunk
		},
	}
}

describe("webhook.node()", () => {
	it("reads the raw stream itself, so no body parser can break verification", async () => {
		const { request, secret } = await mock_request({ provider: "resend", type: "opened" })

		const seen: Array<string> = []
		const middleware = webhook.node((event) => void seen.push(`${event.type}:${event.email}`), {
			provider: "resend",
			secret,
		})
		const res = fake_response()
		await middleware(await as_node(request), res)

		expect(res.statusCode).toBe(200)
		expect(JSON.parse(res.body)).toEqual({ received: 1 })
		expect(res.headers["content-type"]).toBe("application/json")
		expect(seen).toEqual(["opened:recipient@example.com"])
	})

	it("answers 401 on a bad signature, same contract as the fetch handler", async () => {
		const { request } = await mock_request({ provider: "resend", type: "delivered" })

		const middleware = webhook.node(() => {}, { provider: "resend", secret: "whsec_d3JvbmchIQ==" })
		const res = fake_response()
		await middleware(await as_node(request), res)

		expect(res.statusCode).toBe(401)
	})
})

describe("webhook() — endpoint handshake (Meta)", () => {
	const url = (query: string) => `https://example.com/webhooks/whatsapp?${query}`
	const options = { provider: "meta" as const, secret: "app-secret", verify_token: "chosen-token" }

	it("echoes the challenge as plain text when the verify token matches", async () => {
		const handler = webhook(() => {}, options)
		const response = await handler(
			new Request(url("hub.mode=subscribe&hub.verify_token=chosen-token&hub.challenge=1158201444"))
		)
		expect(response.status).toBe(200)
		expect(response.headers.get("content-type")).toBe("text/plain")
		expect(await response.text()).toBe("1158201444")
	})

	it("answers 401 when the token is wrong or missing, so a stranger can't subscribe you", async () => {
		const handler = webhook(() => {}, options)
		const wrong = await handler(
			new Request(url("hub.mode=subscribe&hub.verify_token=guess&hub.challenge=1"))
		)
		expect(wrong.status).toBe(401)
		const absent = await handler(new Request(url("hub.mode=subscribe&hub.challenge=1")))
		expect(absent.status).toBe(401)
	})

	it("fails closed with no verify token configured", async () => {
		delete process.env.META_WEBHOOK_VERIFY_TOKEN
		const handler = webhook(() => {}, { provider: "meta", secret: "app-secret" })
		const response = await handler(
			new Request(url("hub.mode=subscribe&hub.verify_token=anything&hub.challenge=1"))
		)
		expect(response.status).toBe(401)
		expect((await response.json()).error).toMatch(/META_WEBHOOK_VERIFY_TOKEN/)
	})

	it("verify: false does not open the handshake — there is no payload to trust", async () => {
		// A stranger with the URL could otherwise subscribe it to their own app.
		delete process.env.META_WEBHOOK_VERIFY_TOKEN
		const handler = webhook(() => {}, { provider: "meta", verify: false })
		const response = await handler(
			new Request(url("hub.mode=subscribe&hub.verify_token=anything&hub.challenge=7"))
		)
		expect(response.status).toBe(401)
	})

	it("sends a GET that isn't a handshake on to receive(), as it always did", async () => {
		// Same answer for every provider, handshake or not: the request has no signature.
		const meta = webhook(() => {}, options)
		expect((await meta(new Request(url("hello=world")))).status).toBe(401)
		expect((await meta(new Request("https://example.com/webhooks/whatsapp"))).status).toBe(401)
		const resend = webhook(() => {}, { provider: "resend", secret: "whsec_d3JvbmchIQ==" })
		expect((await resend(new Request("https://example.com/webhooks"))).status).toBe(401)
	})

	it("reaches the node adapter too, method and query intact", async () => {
		const middleware = webhook.node(() => {}, options)
		const res = fake_response()
		await middleware(
			{
				method: "GET",
				url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=chosen-token&hub.challenge=99",
				headers: {},
				async *[Symbol.asyncIterator]() {},
			},
			res
		)
		expect(res.statusCode).toBe(200)
		expect(res.body).toBe("99")
	})

	it("drops a body a GET arrived with, rather than throwing before any response is written", async () => {
		const middleware = webhook.node(() => {}, options)
		const res = fake_response()
		await middleware(
			{
				method: "GET",
				url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=chosen-token&hub.challenge=5",
				headers: { "content-length": "2" },
				async *[Symbol.asyncIterator]() {
					yield new TextEncoder().encode("{}")
				},
			},
			res
		)
		expect(res.statusCode).toBe(200)
		expect(res.body).toBe("5")
	})
})
