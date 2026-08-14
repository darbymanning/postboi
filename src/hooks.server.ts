import type { Handle } from "@sveltejs/kit"

/**
 * The docs moved to docs.postboi.app with the rest of the brand; docs.postboi.email is kept
 * alive only to forward the links already loose in the world — READMEs, old release notes,
 * search results.
 *
 * GET-only, matching the app's own redirect: a 301 turns a POST into a GET and drops its
 * body. Nothing here takes a POST today, but a docs site grows a search or feedback endpoint
 * eventually, and the guard costs one comparison.
 */
export const handle: Handle = async ({ event, resolve }) => {
	if (event.request.method === "GET" && event.url.hostname === "docs.postboi.email") {
		const to = new URL(event.url)
		to.protocol = "https:"
		to.hostname = "docs.postboi.app"
		return new Response(null, { status: 301, headers: { location: to.href } })
	}

	return resolve(event)
}
