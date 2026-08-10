/**
 * A `fetch`-shaped request over HTTP/2, for the one service that refuses HTTP/1.1.
 *
 * APNs is that service, and it is the only reason this file exists. Node's global `fetch`
 * is undici, which speaks HTTP/1.1 only — `allowH2` is an opt-in on a `Client`, not
 * something the global picks up — so `fetch("https://api.push.apple.com/…")` dies with a
 * parser error before Apple ever sees the request. Workers and Deno negotiate h2 in fetch
 * already, and have no `node:http2`. So the rule is simply **use `node:http2` where it
 * exists, the global `fetch` where it doesn't**, which lands every runtime on the one
 * client that works there.
 *
 * Internal: not part of the public surface.
 */

type Http2 = typeof import("node:http2")
type Session = import("node:http2").ClientHttp2Session

// Loaded lazily (same pattern as smtp.ts and aws.ts) so bundlers targeting non-node
// platforms can bundle push() without resolving node:http2 — esbuild demotes an
// unresolvable dynamic import to a warning only inside a try, so the try is load-bearing.
// `undefined` means "not this runtime, use fetch"; the module is looked up once.
let http2: Http2 | null | undefined
async function load_http2(): Promise<Http2 | null> {
	if (http2 !== undefined) return http2
	try {
		const mod = await import("node:http2")
		// ponytail: a runtime shipping a stub node:http2 would import and then fail on
		// connect. Checking connect is a function is the cheap 90% of that; if a real
		// platform ever lands in the gap, the fix is an explicit runtime check here.
		http2 = typeof mod.connect === "function" ? mod : null
	} catch {
		http2 = null
	}
	return http2
}

/**
 * Live sessions by origin. HTTP/2 multiplexes, and APNs is built expecting one long
 * connection carrying many notifications — without reuse every send would pay a fresh TLS
 * handshake, which is most of the latency of a push. Module-level for the same reason the
 * token caches are: the zero-config `push()` builds a provider per call.
 */
const sessions = new Map<string, Session>()

/** Forget every pooled session — for tests, and for a caller that wants a clean slate. */
export function close_http2_sessions(): void {
	for (const session of sessions.values()) session.close()
	sessions.clear()
}

function session_for(mod: Http2, origin: string): Session {
	const existing = sessions.get(origin)
	if (existing && !existing.closed && !existing.destroyed) return existing

	const session = mod.connect(origin)
	// A pooled session must never be the reason a process won't exit — a script that sends
	// one notification and returns should still return.
	session.unref()
	// Evict on the way out rather than checking liveness on the way in: GOAWAY, idle
	// timeouts and dropped sockets all land here, and a stale entry would fail a real send.
	const forget = () => {
		if (sessions.get(origin) === session) sessions.delete(origin)
	}
	session.on("close", forget)
	session.on("goaway", forget)
	// An unhandled 'error' on a session is a process-level crash in Node. The pending
	// request rejects through its own handler; this one only exists to stop that.
	session.on("error", forget)

	sessions.set(origin, session)
	return session
}

/**
 * POST over HTTP/2 and resolve a real {@link Response}, so callers can treat it exactly
 * like a `fetch` result. Falls back to the global `fetch` on runtimes without
 * `node:http2` — where fetch already does HTTP/2 and this whole file is unnecessary.
 */
export async function http2_fetch(url: string, init: RequestInit = {}): Promise<Response> {
	const mod = await load_http2()
	if (!mod) return fetch(url, init)

	const target = new URL(url)
	const session = session_for(mod, target.origin)
	const headers: Record<string, string> = {
		":method": init.method ?? "POST",
		":path": `${target.pathname}${target.search}`,
	}
	// `new Headers` lowercases as it goes, which HTTP/2 requires — a capitalised header
	// name is a protocol error, not a nicety.
	for (const [key, value] of new Headers(init.headers)) headers[key] = value

	return new Promise<Response>((resolve, reject) => {
		const stream = session.request(headers)
		const chunks: Array<Uint8Array> = []
		let status = 0
		let response_headers = new Headers()

		const signal = init.signal
		const abort = () => {
			stream.close(mod.constants.NGHTTP2_CANCEL)
			reject(new Error(signal?.reason instanceof Error ? signal.reason.message : "aborted"))
		}
		// Loading node:http2 puts an await between the caller's signal and this listener, so
		// a signal that aborted in the meantime has already fired and would never reach it —
		// the request would go out despite being cancelled.
		if (signal?.aborted) return abort()
		signal?.addEventListener("abort", abort, { once: true })
		const done = () => signal?.removeEventListener("abort", abort)

		stream.on("response", (received) => {
			status = Number(received[":status"] ?? 0)
			const pairs: Array<[string, string]> = []
			for (const [key, value] of Object.entries(received)) {
				// Pseudo-headers (:status) aren't valid in a Headers bag, and array-valued
				// headers don't arise on the responses this sends.
				if (key.startsWith(":") || value === undefined) continue
				pairs.push([key, String(value)])
			}
			response_headers = new Headers(pairs)
		})
		stream.on("data", (chunk: Uint8Array) => chunks.push(chunk))
		stream.on("error", (error) => {
			done()
			reject(error)
		})
		stream.on("end", () => {
			done()
			const body = chunks.length ? Buffer.concat(chunks) : null
			// 204/304 must not carry a body, and Response's constructor enforces it.
			resolve(
				new Response(status === 204 || status === 304 ? null : body, {
					status,
					headers: response_headers,
				})
			)
		})

		if (init.body) stream.end(init.body as string | Uint8Array)
		else stream.end()
	})
}
