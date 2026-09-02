/**
 * The shared access-token cache for providers whose credential is not the thing they
 * send — plus the Google service-account JWT that two of them (FCM, Gmail) trade for one.
 *
 * FCM and Gmail exchange a signed service-account JWT; HMS and SendPulse exchange an app
 * secret. All end up carrying a short-lived bearer token, all would otherwise pay that
 * exchange on every single message, and all would stampede it on a cold batch send —
 * `push()` fans out five at a time, so five concurrent first sends would mean five token
 * requests. Caching the **in-flight promise** rather than the result is what makes that
 * one request.
 *
 * Module-level like the VAPID and APNs caches, and for the same reason: the zero-config
 * `mail()` / `push()` construct a fresh provider per call, so anything per-instance would
 * never hit. Keys are namespaced by the caller (`gmail:…`, `sendpulse:…`) so two
 * providers sharing a credential id never share a token.
 *
 * Internal: not part of the public surface.
 */
import { pem_to_der, to_base64url } from "./encoding.js"

type Entry = {
	pending: Promise<{ value: string; expires_at: number }>
	/** Known once the exchange has settled — what the sweep reads, without awaiting. */
	expires_at?: number
}

const cache = new Map<string, Entry>()

/** Forget every cached token — for tests, which share the module-level cache. */
export function clear_token_cache(): void {
	cache.clear()
}

/** Drop one credential's token, so the next send mints a fresh one. */
export function forget_token(key: string): void {
	cache.delete(key)
}

/**
 * Drop entries whose token has lapsed, so a long-lived process keying per mailbox doesn't
 * grow without bound. Synchronous on purpose: a cold cache must be filled in the same
 * tick the miss was seen, or two concurrent first sends both exchange.
 */
function sweep(now: number): void {
	for (const [key, entry] of cache) {
		if (entry.expires_at !== undefined && entry.expires_at <= now) cache.delete(key)
	}
}

/**
 * The cached bearer token for `key`, running `exchange` only when there isn't a live one.
 * `exchange` returns the token and its lifetime in seconds, exactly as an OAuth2 token
 * endpoint reports them.
 */
export async function cached_token(
	key: string,
	now: number,
	exchange: () => Promise<{ value: string; expires_in: number }>
): Promise<string> {
	const entry = cache.get(key)
	if (entry) {
		try {
			const token = await entry.pending
			// A minute of headroom, so a token can't lapse between this check and the request
			// that carries it.
			if (token.expires_at > now + 60_000) return token.value
		} catch {
			// A failed exchange must not poison the cache — fall through and retry.
		}
	}

	sweep(now)
	const fresh: Entry = {
		pending: exchange().then(({ value, expires_in }) => ({
			value,
			expires_at: now + expires_in * 1000,
		})),
	}
	fresh.pending.then(
		(token) => {
			fresh.expires_at = token.expires_at
		},
		() => {}
	)
	cache.set(key, fresh)
	try {
		return (await fresh.pending).value
	} catch (error) {
		cache.delete(key)
		throw error
	}
}

/**
 * A signed service-account JWT for Google's token endpoint — the `assertion` of a
 * `jwt-bearer` grant. `subject` is the Workspace user to act as (domain-wide
 * delegation); FCM has none. The PEM is unescaped first, because env files often carry
 * it with literal `\n`s, as Google's own SDKs allow.
 */
export async function google_service_account_assertion(options: {
	client_email: string
	private_key: string
	scope: string
	subject?: string
	/** Current time in milliseconds. */
	now: number
	/** Lifetime in seconds; Google allows up to an hour. */
	lifetime_s?: number
}): Promise<string> {
	const encoder = new TextEncoder()
	const issued = Math.floor(options.now / 1000)
	const claims: Record<string, string | number> = {
		iss: options.client_email,
		scope: options.scope,
		aud: "https://oauth2.googleapis.com/token",
		iat: issued,
		exp: issued + (options.lifetime_s ?? 3600),
	}
	if (options.subject) claims.sub = options.subject
	const header = to_base64url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })))
	const payload = to_base64url(encoder.encode(JSON.stringify(claims)))
	const signing_input = `${header}.${payload}`
	const key = await crypto.subtle.importKey(
		"pkcs8",
		pem_to_der(options.private_key.replace(/\\n/g, "\n")),
		{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
		false,
		["sign"]
	)
	const signature = await crypto.subtle.sign(
		"RSASSA-PKCS1-v1_5",
		key,
		encoder.encode(signing_input)
	)
	return `${signing_input}.${to_base64url(new Uint8Array(signature))}`
}
