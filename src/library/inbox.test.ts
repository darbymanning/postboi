import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { createServer, type Server } from "node:http"
import { create_inbox_store, inbox_middleware } from "./inbox_server.js"
import { resolve_inbox, set_inbox_port, INBOX_PATH } from "./inbox.js"
import { inbox_ui } from "./inbox_ui.js"
import Mock from "./mock.js"

/** Stand the inbox up on a real port, so the delivery path is exercised end to end. */
async function start_inbox(): Promise<{
	port: number
	store: ReturnType<typeof create_inbox_store>
	stop(): Promise<void>
}> {
	const store = create_inbox_store()
	const middleware = inbox_middleware(store)
	const server: Server = createServer((request, response) => {
		middleware(request, response, () => {
			response.statusCode = 404
			response.end("nope")
		})
	})
	const port = await new Promise<number>((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const address = server.address()
			resolve(typeof address === "object" && address ? address.port : 0)
		})
	})
	return {
		port,
		store,
		stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
	}
}

const message = {
	to: [{ address: "ada@example.com" }],
	from: { address: "no-reply@example.com" },
	subject: "Hi",
	html: "<p>Hello</p>",
	attachments: [],
}

describe("inbox store", () => {
	it("stores newest first and hands back an id", () => {
		const store = create_inbox_store()
		const first = store.add({ ...message, subject: "one" })
		const second = store.add({ ...message, subject: "two" })
		expect(first.id).not.toBe(second.id)
		expect(store.list().map((m) => m.subject)).toEqual(["two", "one"])
		expect(store.get(first.id)?.subject).toBe("one")
	})

	it("drops the oldest past the limit", () => {
		const store = create_inbox_store(2)
		store.add({ ...message, subject: "one" })
		store.add({ ...message, subject: "two" })
		store.add({ ...message, subject: "three" })
		expect(store.list().map((m) => m.subject)).toEqual(["three", "two"])
	})

	it("notifies subscribers on add and clear, and stops after unsubscribe", () => {
		const store = create_inbox_store()
		const listener = vi.fn()
		const off = store.subscribe(listener)
		store.add(message)
		store.clear()
		expect(listener).toHaveBeenCalledTimes(2)
		off()
		store.add(message)
		expect(listener).toHaveBeenCalledTimes(2)
	})
})

describe("inbox middleware", () => {
	let inbox: Awaited<ReturnType<typeof start_inbox>>

	beforeEach(async () => {
		inbox = await start_inbox()
	})
	afterEach(() => inbox.stop())

	it("passes non-inbox requests through to the app", async () => {
		const response = await fetch(`http://127.0.0.1:${inbox.port}/some/app/route`)
		expect(response.status).toBe(404)
		expect(await response.text()).toBe("nope")
	})

	it("does not swallow a route that merely starts with the same characters", async () => {
		const response = await fetch(`http://127.0.0.1:${inbox.port}${INBOX_PATH}-elsewhere`)
		expect(await response.text()).toBe("nope")
	})

	it("serves the UI", async () => {
		const response = await fetch(`http://127.0.0.1:${inbox.port}${INBOX_PATH}`)
		expect(response.headers.get("content-type")).toContain("text/html")
		expect(await response.text()).toContain("You've Got")
	})

	it("ships the CRT and sound on, and a way to turn each off", async () => {
		const html = await (await fetch(`http://127.0.0.1:${inbox.port}${INBOX_PATH}`)).text()
		// Scanlines over a message you're checking the design of — and a "Welcome!" in a
		// shared office — are the opposite of useful, so the toggles are not decoration.
		expect(html).toContain('class="crt"')
		expect(html).toContain('data-sounds="on"')
		expect(html).toContain('id="t-crt"')
		expect(html).toContain('id="t-sound"')
		expect(html).toContain("prefers-reduced-motion")
	})

	it("starts with each piece turned off when the server says so", async () => {
		const html = inbox_ui({ crt: false, sounds: false, intro: false })
		expect(html).not.toContain('class="crt"')
		expect(html).toContain('data-sounds="off"')
		expect(html).toContain('data-intro="off"')
		// The controls stay — the option sets the starting state, it doesn't remove the toggle.
		expect(html).toContain('id="t-crt"')
		expect(html).toContain('id="t-sound"')
	})

	it("defaults every piece on", async () => {
		const html = inbox_ui()
		expect(html).toContain('class="crt"')
		expect(html).toContain('data-sounds="on"')
		expect(html).toContain('data-intro="on"')
	})

	it("serves each sound as playable audio", async () => {
		for (const name of ["welcome", "mail", "goodbye"]) {
			const response = await fetch(`http://127.0.0.1:${inbox.port}${INBOX_PATH}/api/sounds/${name}`)
			expect(response.status, name).toBe(200)
			expect(response.headers.get("content-type")).toBe("audio/wav")
			const bytes = new Uint8Array(await response.arrayBuffer())
			// Decoded back to real RIFF/WAVE, not left as base64 text.
			expect(String.fromCharCode(...bytes.slice(0, 4)), name).toBe("RIFF")
			expect(String.fromCharCode(...bytes.slice(8, 12)), name).toBe("WAVE")
		}
	})

	it("404s a sound that doesn't exist", async () => {
		const response = await fetch(`http://127.0.0.1:${inbox.port}${INBOX_PATH}/api/sounds/nope`)
		expect(response.status).toBe(404)
	})

	it("accepts, lists and clears messages", async () => {
		const posted = await fetch(`http://127.0.0.1:${inbox.port}${INBOX_PATH}/api/messages`, {
			method: "POST",
			body: JSON.stringify({ ...message, subject: "Captured" }),
		})
		expect(posted.status).toBe(201)

		const listed = await fetch(`http://127.0.0.1:${inbox.port}${INBOX_PATH}/api/messages`)
		const { messages } = (await listed.json()) as { messages: Array<{ subject: string }> }
		expect(messages).toHaveLength(1)
		expect(messages[0].subject).toBe("Captured")

		await fetch(`http://127.0.0.1:${inbox.port}${INBOX_PATH}/api/messages`, { method: "DELETE" })
		expect(inbox.store.list()).toHaveLength(0)
	})

	it("serves a message body as its own document", async () => {
		const stored = inbox.store.add({ ...message, html: "<p>Body here</p>" })
		const response = await fetch(
			`http://127.0.0.1:${inbox.port}${INBOX_PATH}/api/messages/${stored.id}/body`
		)
		expect(await response.text()).toBe("<p>Body here</p>")
	})

	it("escapes a text-only body rather than rendering it as markup", async () => {
		const stored = inbox.store.add({ ...message, html: undefined, text: "<script>x</script>" })
		const response = await fetch(
			`http://127.0.0.1:${inbox.port}${INBOX_PATH}/api/messages/${stored.id}/body`
		)
		const text = await response.text()
		expect(text).toContain("&lt;script&gt;")
		expect(text).not.toContain("<script>x")
	})

	it("serves attachments decoded", async () => {
		const stored = inbox.store.add({
			...message,
			attachments: [
				{
					name: "note.txt",
					mime_type: "text/plain",
					content: Buffer.from("hi there").toString("base64"),
				},
			],
		})
		const response = await fetch(
			`http://127.0.0.1:${inbox.port}${INBOX_PATH}/api/messages/${stored.id}/attachments/0`
		)
		expect(await response.text()).toBe("hi there")
		expect(response.headers.get("content-disposition")).toContain("note.txt")
	})

	it("404s an unknown message", async () => {
		const response = await fetch(
			`http://127.0.0.1:${inbox.port}${INBOX_PATH}/api/messages/nope/body`
		)
		expect(response.status).toBe(404)
	})
})

describe("inbox discovery", () => {
	beforeEach(() => {
		set_inbox_port(null as unknown as number)
		delete process.env.POSTBOI_INBOX
	})
	afterEach(() => {
		delete process.env.POSTBOI_INBOX
	})

	it("uses an injected port", async () => {
		set_inbox_port(4321)
		const inbox = await resolve_inbox()
		expect(inbox?.url).toBe(`http://localhost:4321${INBOX_PATH}`)
	})

	it("lets POSTBOI_INBOX override the injected port", async () => {
		set_inbox_port(4321)
		process.env.POSTBOI_INBOX = "9999"
		expect((await resolve_inbox())?.url).toContain("9999")
	})

	it("lets POSTBOI_INBOX=off switch it off entirely", async () => {
		set_inbox_port(4321)
		process.env.POSTBOI_INBOX = "off"
		expect(await resolve_inbox()).toBeNull()
	})

	it("ignores a nonsense port", async () => {
		process.env.POSTBOI_INBOX = "banana"
		expect(await resolve_inbox()).toBeNull()
	})
})

describe("delivery", () => {
	afterEach(() => set_inbox_port(null as unknown as number))

	it("delivers a captured send to a running inbox", async () => {
		const inbox = await start_inbox()
		set_inbox_port(inbox.port)
		const resolved = await resolve_inbox()

		const mail = new Mock({ sink: resolved!.deliver, default: { from: "dev@example.com" } })
		await mail.send({ to: "ada@example.com", subject: "Captured", body: "<p>Hello</p>" })

		expect(inbox.store.list()).toHaveLength(1)
		expect(inbox.store.list()[0].subject).toBe("Captured")
		await inbox.stop()
	})

	it("prints the mail instead when the inbox has gone away", async () => {
		const inbox = await start_inbox()
		set_inbox_port(inbox.port)
		const resolved = await resolve_inbox()
		await inbox.stop()

		const log = vi.spyOn(console, "log").mockImplementation(() => {})
		const mail = new Mock({ sink: resolved!.deliver, default: { from: "dev@example.com" } })
		await mail.send({ to: "ada@example.com", subject: "Orphaned", body: "<p>Hello</p>" })

		// Never a silent success: an unreachable inbox falls back to the console, and the
		// message is still captured for assertions.
		expect(log).toHaveBeenCalled()
		expect(String(log.mock.calls[0][0])).toContain("Orphaned")
		expect(mail.sent).toHaveLength(1)
		log.mockRestore()
	})
})
