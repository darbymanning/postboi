/**
 * The shared access-token cache for push providers whose credential is not the thing they
 * send.
 *
 * FCM exchanges a signed service-account JWT; HMS exchanges an app secret. Both end up
 * carrying a short-lived bearer token, both would otherwise pay that exchange on every
 * single notification, and both would stampede it on a cold batch send — `push()` fans out
 * five at a time, so five concurrent first sends would mean five token requests. Caching
 * the **in-flight promise** rather than the result is what makes that one request.
 *
 * Module-level like the VAPID and APNs caches, and for the same reason: the zero-config
 * `push()` constructs a fresh provider per call, so anything per-instance would never hit.
 *
 * Internal: not part of the public surface.
 */

const cache = new Map<string, Promise<{ value: string; expires_at: number }>>()

/** Forget every cached token — for tests, which share the module-level cache. */
export function clear_token_cache(): void {
	cache.clear()
}

/** Drop one credential's token, so the next send mints a fresh one. */
export function forget_token(key: string): void {
	cache.delete(key)
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
	const pending = cache.get(key)
	if (pending) {
		try {
			const token = await pending
			// A minute of headroom, so a token can't lapse between this check and the request
			// that carries it.
			if (token.expires_at > now + 60_000) return token.value
		} catch {
			// A failed exchange must not poison the cache — fall through and retry.
		}
	}

	const fresh = exchange().then(({ value, expires_in }) => ({
		value,
		expires_at: now + expires_in * 1000,
	}))
	cache.set(key, fresh)
	try {
		return (await fresh).value
	} catch (error) {
		cache.delete(key)
		throw error
	}
}
