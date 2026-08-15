/**
 * The framework-agnostic webhook handler — `receive()` wrapped in the response contract
 * providers expect, taking the request in whichever shape a framework hands it over.
 *
 * Next.js route handlers, Cloudflare Workers and plain fetch handlers pass a web
 * `Request`; SvelteKit, Astro and Remix pass a context object carrying `.request`. One
 * handler accepts both, so the same line works in all of them:
 *
 *     export const POST = webhook((event) => { … })
 *
 * Frameworks that wrap the request deeper (Hono keeps it at `c.req.raw`) unwrap in
 * place: `app.post("/webhooks", (c) => webhook(handler)(c.req.raw))`.
 */
import { receive, WebhookVerificationError } from "./index.js"
import type { ReceiveOptions, WebhookEvent } from "./index.js"
import { is_error } from "../errors.js"

/** A web `Request`, or any framework context that carries one — both shapes accepted. */
export type RequestCarrier = Request | { request: Request }

function json(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	})
}

/**
 * Build a request handler that receives provider delivery-event webhooks: verifies the
 * signature, normalizes the payload, and calls your handler once per event.
 *
 * Responses are what providers expect: `200 {received}` on success, `401` on a failed
 * signature, `400` on an unparseable payload, and `500` when your handler throws — so
 * the provider retries. SNS subscription handshakes (SES, Scaleway) confirm themselves.
 *
 * @example
 * ```ts
 * // Next.js app/webhooks/route.ts — and the identical line is an Astro APIRoute, a
 * // Remix action, a SvelteKit +server.ts export or a Worker fetch branch.
 * import { webhook } from "postboi/webhooks"
 *
 * export const POST = webhook(async (event) => {
 * 	if (event.type === "bounced") console.log(`${event.email} bounced`)
 * })
 * ```
 */
function build(
	handler: (event: WebhookEvent) => void | Promise<void>,
	options?: ReceiveOptions
): (carrier: RequestCarrier) => Promise<Response> {
	return async (carrier) => {
		const request = carrier instanceof Request ? carrier : carrier.request

		let events: Array<WebhookEvent>
		try {
			events = await receive(request, options)
		} catch (error) {
			if (error instanceof WebhookVerificationError) {
				return json({ error: error.message }, 401)
			}
			const message = is_error(error) ? error.message : String(error)
			return json({ error: message }, 400)
		}

		try {
			for (const event of events) await handler(event)
		} catch (error) {
			// A throwing handler returns 500 so the provider redelivers the event.
			const message = error instanceof Error ? error.message : String(error)
			return json({ error: message }, 500)
		}

		return json({ received: events.length }, 200)
	}
}

/**
 * Node's request shape, structurally — an `IncomingMessage` matches, but nothing here
 * imports node:http, so the module stays loadable on every runtime.
 */
export interface NodeRequest extends AsyncIterable<Uint8Array> {
	method?: string
	url?: string
	headers: Record<string, string | Array<string> | undefined>
}

/** The slice of node's ServerResponse the adapter writes to. */
export interface NodeResponse {
	statusCode: number
	setHeader(name: string, value: string): void
	end(chunk: string): void
}

/**
 * The same handler as `(req, res)` middleware for Express and plain node:http — reached
 * as `webhook.node(handler)`.
 *
 * It exists because of one footgun: signatures verify over the request's **exact raw
 * bytes**, and Express body parsers rewrite them — mount `express.json()` in front of a
 * webhook route and verification fails forever, silently. This adapter reads the raw
 * stream itself, so there's no parser to misconfigure:
 *
 * ```js
 * app.post("/webhooks", webhook.node(async (event) => { … }))
 * ```
 *
 * A JSON body slips past `express.urlencoded()` untouched (wrong content-type), so the
 * common global parser is fine. Just never mount a *JSON* parser ahead of this route —
 * a parser that has already drained the stream leaves no bytes to verify.
 */
function node(
	handler: (event: WebhookEvent) => void | Promise<void>,
	options?: ReceiveOptions
): (req: NodeRequest, res: NodeResponse) => Promise<void> {
	return async (req, res) => {
		const chunks: Array<Uint8Array> = []
		for await (const chunk of req) chunks.push(chunk)
		const body = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0))
		let offset = 0
		for (const chunk of chunks) {
			body.set(chunk, offset)
			offset += chunk.length
		}

		const headers = new Headers()
		for (const [name, value] of Object.entries(req.headers)) {
			if (value === undefined) continue
			headers.set(name, Array.isArray(value) ? value.join(", ") : value)
		}

		// The URL only matters to adapters that sign over it — the host is a stand-in.
		const request = new Request(new URL(req.url ?? "/", "http://localhost"), {
			method: req.method ?? "POST",
			headers,
			body: body.length ? body : undefined,
		})

		const response = await build(handler, options)(request)
		res.statusCode = response.status
		response.headers.forEach((value, name) => res.setHeader(name, value))
		res.end(await response.text())
	}
}

export const webhook = Object.assign(build, { node })
