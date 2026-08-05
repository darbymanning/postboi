import type { SentMessage } from "./mock.js"
import type { InboxMessage } from "./inbox.js"
import { INBOX_PATH } from "./inbox.js"
import { inbox_ui, type InboxUiOptions } from "./inbox_ui.js"
import { SOUNDS } from "./inbox_sounds.js"
import { ART } from "./inbox_art.js"
import { DESKTOP } from "./inbox_desktop.js"

/**
 * The dev inbox's storage and HTTP surface. Kept apart from the transport that mounts it:
 * the `postboi/vite` plugin hands this to Vite's own middleware stack, and `postboi dev`
 * hands it to a bare Node server, but it's the same inbox either way.
 */

/**
 * The slice of Node's `IncomingMessage` this needs, declared structurally so the published
 * types never oblige a consumer to have `@types/node` installed.
 */
export interface InboxRequest {
	url?: string
	method?: string
	headers?: Record<string, string | Array<string> | undefined>
	on(event: string, listener: (...args: Array<unknown>) => void): unknown
}

/** The slice of Node's `ServerResponse` this needs. See {@link InboxRequest}. */
export interface InboxResponse {
	statusCode: number
	setHeader(name: string, value: string): unknown
	write(chunk: string): unknown
	end(chunk?: string | Uint8Array): unknown
	on(event: string, listener: () => void): unknown
}

/** A connect-style middleware — what Vite's `server.middlewares.use` takes. */
export type InboxMiddleware = (
	request: InboxRequest,
	response: InboxResponse,
	next: () => void
) => void

/** The captured messages, and the means to watch for more. */
export interface InboxStore {
	/** Store a captured message and return it with its assigned id. */
	add(message: SentMessage): InboxMessage
	/** Every stored message, newest first. */
	list(): Array<InboxMessage>
	/** One message by id. */
	get(id: string): InboxMessage | undefined
	/** Empty the inbox. */
	clear(): void
	/** Watch for arrivals and clears. Returns the unsubscribe. */
	subscribe(listener: () => void): () => void
}

/**
 * An in-memory inbox. Memory is the right store for something whose whole lifetime is one
 * `bun run dev`: nothing to migrate, nothing to clean up, and restarting the dev server
 * giving you an empty inbox is what you'd want anyway.
 *
 * @param limit How many messages to keep before dropping the oldest.
 */
export function create_inbox_store(limit = 200): InboxStore {
	const messages: Array<InboxMessage> = []
	const listeners = new Set<() => void>()
	let counter = 0

	const notify = () => {
		for (const listener of listeners) listener()
	}

	return {
		add(message) {
			const stored: InboxMessage = { ...message, id: `${++counter}`, received_at: Date.now() }
			messages.unshift(stored)
			if (messages.length > limit) messages.length = limit
			notify()
			return stored
		},
		list: () => messages,
		get: (id) => messages.find((message) => message.id === id),
		clear() {
			messages.length = 0
			notify()
		},
		subscribe(listener) {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
	}
}

function send_json(response: InboxResponse, status: number, body: unknown): void {
	const text = JSON.stringify(body)
	response.statusCode = status
	response.setHeader("content-type", "application/json")
	// The inbox is a dev tool showing the newest state; a cached list is never what you want.
	response.setHeader("cache-control", "no-store")
	response.end(text)
}

/** Collect a request body. Capped — an attachment-heavy send is still only a few MB. */
function read_body(request: InboxRequest, limit = 32 * 1024 * 1024): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = ""
		let size = 0
		request.on("data", (chunk: unknown) => {
			const text = String(chunk)
			size += text.length
			if (size > limit) return reject(new Error("inbox: message too large"))
			body += text
		})
		request.on("end", () => resolve(body))
		request.on("error", (error: unknown) => reject(error))
	})
}

/**
 * A message's HTML, as its own document for the preview iframe. Served separately rather
 * than injected into the UI so the email's CSS can't reach the inbox chrome around it —
 * the mail renders in the isolation a real client would give it.
 */
function body_document(message: InboxMessage): string {
	if (message.html) return message.html
	const text = message.text ?? ""
	const escaped = text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
	return `<!doctype html><meta charset="utf-8"><pre style="font:13px ui-monospace,monospace;white-space:pre-wrap;word-wrap:break-word;margin:12px">${escaped}</pre>`
}

/**
 * The inbox's HTTP surface, mounted under {@link INBOX_PATH}. Requests for anything else
 * fall through to `next()`, so this is safe to stack in front of an app's own routes.
 */
export function inbox_middleware(
	store: InboxStore,
	base: string = INBOX_PATH,
	ui: InboxUiOptions = {}
): InboxMiddleware {
	return (request, response, next) => {
		const url = request.url ?? ""
		const path = url.split("?")[0].replace(/\/+$/, "") || "/"
		if (path !== base && !path.startsWith(`${base}/`)) return next()
		const route = path.slice(base.length) || "/"
		const method = request.method ?? "GET"

		if (route === "/" && method === "GET") {
			response.statusCode = 200
			response.setHeader("content-type", "text/html; charset=utf-8")
			response.setHeader("cache-control", "no-store")
			return void response.end(inbox_ui(ui))
		}

		const art_match = /^\/api\/art\/([a-z]+)$/.exec(route)
		if (art_match && method === "GET") {
			const png = ART[art_match[1]]
			if (!png) return void send_json(response, 404, { error: "no such art" })
			response.statusCode = 200
			response.setHeader("content-type", "image/png")
			response.setHeader("cache-control", "max-age=86400")
			return void response.end(Buffer.from(png, "base64"))
		}

		const desktop_match = /^\/api\/desktop\/([a-z]+)$/.exec(route)
		if (desktop_match && method === "GET") {
			const asset = DESKTOP[desktop_match[1]]
			if (!asset) return void send_json(response, 404, { error: "no such desktop asset" })
			const bytes = Buffer.from(asset.data, "base64")
			response.setHeader("content-type", asset.type)
			response.setHeader("cache-control", "max-age=86400")
			// Video elements ask for ranges rather than the whole file, and some browsers refuse to
			// play a source that answers a range request with the entire body.
			response.setHeader("accept-ranges", "bytes")
			const range = /^bytes=(\d*)-(\d*)$/.exec(String(request.headers?.range ?? ""))
			if (range && (range[1] !== "" || range[2] !== "")) {
				const start = range[1] === "" ? bytes.length - Number(range[2]) : Number(range[1])
				const end = range[1] === "" || range[2] === "" ? bytes.length - 1 : Number(range[2])
				if (start < 0 || start > end || end >= bytes.length) {
					response.statusCode = 416
					response.setHeader("content-range", `bytes */${bytes.length}`)
					return void response.end()
				}
				response.statusCode = 206
				response.setHeader("content-range", `bytes ${start}-${end}/${bytes.length}`)
				return void response.end(bytes.subarray(start, end + 1))
			}
			response.statusCode = 200
			return void response.end(bytes)
		}

		const sound_match = /^\/api\/sounds\/([a-z]+)$/.exec(route)
		if (sound_match && method === "GET") {
			const sound = SOUNDS[sound_match[1]]
			if (!sound) return void send_json(response, 404, { error: "no such sound" })
			response.statusCode = 200
			response.setHeader("content-type", sound.type)
			// The bytes never change for a given build, so let the browser keep them.
			response.setHeader("cache-control", "max-age=86400")
			return void response.end(Buffer.from(sound.data, "base64"))
		}

		if (route === "/api/messages" && method === "POST") {
			return void read_body(request)
				.then((body) => {
					const message = store.add(JSON.parse(body) as SentMessage)
					send_json(response, 201, { id: message.id })
				})
				.catch((error: unknown) => {
					send_json(response, 400, { error: String(error) })
				})
		}

		if (route === "/api/messages" && method === "GET") {
			return void send_json(response, 200, { messages: store.list() })
		}

		if (route === "/api/messages" && method === "DELETE") {
			store.clear()
			return void send_json(response, 200, { ok: true })
		}

		// Live updates. One long-lived response per open tab, closed when the tab goes away.
		if (route === "/api/events" && method === "GET") {
			response.statusCode = 200
			response.setHeader("content-type", "text/event-stream")
			response.setHeader("cache-control", "no-store")
			response.setHeader("connection", "keep-alive")
			response.write(": open\n\n")
			const unsubscribe = store.subscribe(() => response.write("data: change\n\n"))
			request.on("close", () => unsubscribe())
			response.on("close", () => unsubscribe())
			return
		}

		const body_match = /^\/api\/messages\/([^/]+)\/body$/.exec(route)
		if (body_match && method === "GET") {
			const message = store.get(body_match[1])
			if (!message) return void send_json(response, 404, { error: "no such message" })
			response.statusCode = 200
			response.setHeader("content-type", "text/html; charset=utf-8")
			response.setHeader("cache-control", "no-store")
			return void response.end(body_document(message))
		}

		const attachment_match = /^\/api\/messages\/([^/]+)\/attachments\/(\d+)$/.exec(route)
		if (attachment_match && method === "GET") {
			const message = store.get(attachment_match[1])
			const attachment = message?.attachments[Number(attachment_match[2])]
			if (!attachment) return void send_json(response, 404, { error: "no such attachment" })
			response.statusCode = 200
			response.setHeader("content-type", attachment.mime_type)
			response.setHeader("content-disposition", `attachment; filename="${attachment.name}"`)
			// Providers take base64, so that's what the mock captured — decode it back for download.
			return void response.end(Buffer.from(attachment.content, "base64"))
		}

		send_json(response, 404, { error: "not found" })
	}
}
