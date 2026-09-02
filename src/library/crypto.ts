/**
 * WebCrypto HMAC primitives, shared by anything that has to sign or verify bytes.
 *
 * `crypto.subtle` rather than `node:crypto`, so the same code runs everywhere postboi
 * does — Node, Bun, Deno, Cloudflare Workers and other edge runtimes. Webhook
 * verification re-exports these from `webhooks/crypto.ts` (the way it already re-exports
 * base64 from `encoding.ts`), and the providers that sign their own requests — Alibaba
 * Direct Mail's RPC signature — import them directly.
 *
 * AWS SigV4 is the one signer that doesn't come through here: it lives in `aws.ts` on
 * `node:crypto` because its key derivation is four chained HMACs over binary keys.
 *
 * Internal: not part of the public surface.
 */

const encoder = new TextEncoder()

/** Encode bytes as lowercase hex. */
export function hex_encode(bytes: Uint8Array): string {
	let out = ""
	for (const byte of bytes) out += byte.toString(16).padStart(2, "0")
	return out
}

/**
 * Constant-time string comparison. Always walks the full longest length so a mismatch
 * position can't be inferred from timing.
 */
export function timing_safe_equal(a: string, b: string): boolean {
	const length = Math.max(a.length, b.length)
	let diff = a.length === b.length ? 0 : 1
	for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
	return diff === 0
}

async function hmac(hash: "SHA-1" | "SHA-256", key: Uint8Array, data: string): Promise<Uint8Array> {
	const imported = await crypto.subtle.importKey(
		"raw",
		key as BufferSource,
		{ name: "HMAC", hash },
		false,
		["sign"]
	)
	return new Uint8Array(await crypto.subtle.sign("HMAC", imported, encoder.encode(data)))
}

/** HMAC-SHA256 of `data`. A string key is used as its UTF-8 bytes. */
export function hmac_sha256(key: Uint8Array | string, data: string): Promise<Uint8Array> {
	return hmac("SHA-256", typeof key === "string" ? encoder.encode(key) : key, data)
}

/** HMAC-SHA1 of `data` (Mandrill's webhook scheme, Alibaba's RPC signature). A string key
 * is used as its UTF-8 bytes. */
export function hmac_sha1(key: Uint8Array | string, data: string): Promise<Uint8Array> {
	return hmac("SHA-1", typeof key === "string" ? encoder.encode(key) : key, data)
}
