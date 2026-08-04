import type { SentMessage } from "./mock.js"
import { read_env } from "./env.js"

/**
 * The local development inbox — where mail goes while you're building, instead of a
 * provider. Nothing here is configured by the app: the inbox announces itself (the
 * `postboi/vite` plugin serves it and injects its port, or `postboi dev` writes one to a
 * discovery file), and `mail()` notices. Running the inbox *is* the opt-in, so code that
 * sends is identical in dev and production.
 */

/** Where the inbox accepts captured messages, on whichever host is serving it. */
export const INBOX_ENDPOINT = "/__postboi/api/messages"

/** The inbox UI's path, for the notice printed on the first captured send. */
export const INBOX_PATH = "/__postboi"

/**
 * Where `postboi dev` advertises its port, relative to the project root. Inside
 * `node_modules` on purpose: it's machine-local, disposable, and already ignored by git.
 */
export const INBOX_DISCOVERY = "node_modules/.postboi/inbox.json"

/** A captured message, plus the fields the inbox lists it by. */
export interface InboxMessage extends SentMessage {
	/** Identifies this capture within one inbox run. */
	id: string
	/** When the inbox received it (epoch ms). */
	received_at: number
}

/** A reachable inbox: where to look at it, and how to hand it a message. */
export interface Inbox {
	/** The inbox UI, for the notice printed the first time mail is captured. */
	url: string
	/**
	 * Hand over a captured message. False means the inbox didn't take it — the caller
	 * prints the mail instead, and never falls through to sending it for real.
	 */
	deliver(message: SentMessage): Promise<boolean>
}

let injected: number | null = null

/**
 * Record the port the inbox is listening on. Called by the `postboi/vite` plugin, which
 * appends the call to this module's source in the SSR build — the same trick
 * {@link set_bundled_config} uses, for the same reason: the plugin runs in Vite's own
 * module registry and your server code runs in another, so a plain call across them would
 * set this on a copy nothing reads.
 *
 * @internal
 */
export function set_inbox_port(port: number): void {
	injected = port
}

/** Is this an env value asking for the inbox to stay out of the way? */
function is_off(value: string): boolean {
	return /^(off|false|0|no)$/i.test(value)
}

function valid_port(value: number): boolean {
	return Number.isInteger(value) && value > 0 && value < 65536
}

/**
 * Read the port `postboi dev` advertised. Node/Bun only — under Workers there's no
 * filesystem, which is why the Vite plugin injects the port instead.
 */
async function read_discovery(): Promise<number | null> {
	if (typeof process === "undefined" || !process.versions?.node) return null
	try {
		const { readFileSync } = await import("node:fs")
		const { join } = await import("node:path")
		const raw = readFileSync(join(process.cwd(), INBOX_DISCOVERY), "utf8")
		const port = (JSON.parse(raw) as { port?: unknown }).port
		return typeof port === "number" && valid_port(port) ? port : null
	} catch {
		// Missing (no inbox running), unparseable, or no fs — all mean "no inbox".
		return null
	}
}

/**
 * Find the inbox's port, in precedence order: an explicit `POSTBOI_INBOX` (which can also
 * switch it off), then a port the Vite plugin injected, then the discovery file.
 *
 * Deliberately unmemoised. The inbox can start after the app has already sent — checking
 * each time is one failed `readFileSync` on a path that isn't there, on a code path that
 * only runs in development.
 */
async function discover(): Promise<number | null> {
	const env = read_env("POSTBOI_INBOX")?.trim()
	if (env) {
		if (is_off(env)) return null
		const port = Number(env)
		return valid_port(port) ? port : null
	}
	if (injected !== null) return injected
	return read_discovery()
}

/** POST a captured message to a listening inbox. */
async function post(port: number, message: SentMessage): Promise<boolean> {
	try {
		const response = await fetch(`http://127.0.0.1:${port}${INBOX_ENDPOINT}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(message),
		})
		return response.ok
	} catch {
		// A dev server that was killed hard leaves its port behind in the discovery file.
		return false
	}
}

/**
 * The inbox to route this send to, or null when none is listening. Callers gate this on
 * development themselves — nothing here checks, so a test can drive it directly.
 */
export async function resolve_inbox(): Promise<Inbox | null> {
	const port = await discover()
	if (port === null) return null
	return {
		url: `http://localhost:${port}${INBOX_PATH}`,
		deliver: (message) => post(port, message),
	}
}
