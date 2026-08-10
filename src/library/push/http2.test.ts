import { describe, it, expect, afterAll } from "vitest"
import { createServer, type Http2Server } from "node:http2"
import { http2_fetch, close_http2_sessions } from "./http2.js"

/**
 * A real HTTP/2 server, because a mocked one would prove nothing: the entire reason this
 * module exists is that Node's `fetch` cannot speak this protocol, and the only way to
 * know the replacement does is to make it talk to something that only answers HTTP/2.
 * Plaintext h2c — the TLS handshake is not what's under test.
 */
const sessions: Array<unknown> = []
const requests: Array<Record<string, unknown>> = []

const server: Http2Server = createServer()
server.on("session", (session) => sessions.push(session))
server.on("stream", (stream, headers) => {
	requests.push(headers)
	const chunks: Array<Buffer> = []
	stream.on("data", (chunk: Buffer) => chunks.push(chunk))
	stream.on("end", () => {
		const body = Buffer.concat(chunks).toString()
		stream.respond({ ":status": 200, "apns-id": "abc-123", "content-type": "application/json" })
		stream.end(JSON.stringify({ echoed: JSON.parse(body || "null") }))
	})
})

const origin = await new Promise<string>((resolve) => {
	server.listen(0, "127.0.0.1", () => {
		const address = server.address()
		resolve(`http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`)
	})
})

afterAll(() => {
	close_http2_sessions()
	server.close()
})

describe("http2_fetch", () => {
	it("round-trips a POST and hands back a normal Response", async () => {
		const response = await http2_fetch(`${origin}/3/device/abc`, {
			headers: { "apns-topic": "com.example.app", "content-type": "application/json" },
			body: JSON.stringify({ hello: "world" }),
		})

		expect(response.status).toBe(200)
		expect(response.headers.get("apns-id")).toBe("abc-123")
		expect(await response.json()).toEqual({ echoed: { hello: "world" } })

		const [sent] = requests
		expect(sent[":method"]).toBe("POST")
		expect(sent[":path"]).toBe("/3/device/abc")
		expect(sent["apns-topic"]).toBe("com.example.app")
	})

	it("reuses one session across sends — the reason APNs uses HTTP/2 at all", async () => {
		await http2_fetch(`${origin}/3/device/one`, { body: "{}" })
		await http2_fetch(`${origin}/3/device/two`, { body: "{}" })
		expect(requests.length).toBeGreaterThanOrEqual(3)
		expect(sessions).toHaveLength(1)
	})

	it("gives up when the caller's signal aborts", async () => {
		const controller = new AbortController()
		const pending = http2_fetch(`${origin}/3/device/slow`, {
			body: "{}",
			signal: controller.signal,
		})
		controller.abort()
		await expect(pending).rejects.toThrow()
	})
})
