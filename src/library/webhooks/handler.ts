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
export function webhook(
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
