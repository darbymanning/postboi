import { describe, it, expect, vi } from "vitest"

import {
	receive,
	parse_user_agent,
	WebhookVerificationError,
	mock_event,
	mock_request,
} from "$library/webhooks/index.js"
import {
	svix_verify,
	timing_safe_equal,
	hmac_sha256,
	base64_encode,
	base64_decode,
	verify_ecdsa_p256_sha256,
	generate_svix_secret,
} from "$library/webhooks/crypto.js"

describe("webhook crypto", () => {
	it("timing_safe_equal compares correctly", () => {
		expect(timing_safe_equal("abc", "abc")).toBe(true)
		expect(timing_safe_equal("abc", "abd")).toBe(false)
		expect(timing_safe_equal("abc", "abcd")).toBe(false)
		expect(timing_safe_equal("", "")).toBe(true)
	})

	it("svix_verify accepts a valid signature and rejects tampering", async () => {
		const secret = generate_svix_secret()
		const body = JSON.stringify({ hello: "world" })
		const id = "msg_1"
		const timestamp = String(Math.floor(Date.now() / 1000))
		const key = base64_decode(secret.slice("whsec_".length))
		const signature = base64_encode(await hmac_sha256(key, `${id}.${timestamp}.${body}`))

		expect(await svix_verify({ secret, id, timestamp, body, signatures: `v1,${signature}` })).toBe(
			"ok"
		)
		// Other versions/garbage entries are skipped; any valid v1 wins.
		expect(
			await svix_verify({
				secret,
				id,
				timestamp,
				body,
				signatures: `v2,bogus v1,${signature}`,
			})
		).toBe("ok")
		expect(
			await svix_verify({
				secret,
				id,
				timestamp,
				body: body + "!",
				signatures: `v1,${signature}`,
			})
		).toBe("invalid_signature")
	})

	it("svix_verify rejects stale timestamps (replay protection)", async () => {
		const secret = generate_svix_secret()
		const body = "{}"
		const id = "msg_1"
		const timestamp = String(Math.floor(Date.now() / 1000) - 3600)
		const key = base64_decode(secret.slice("whsec_".length))
		const signature = base64_encode(await hmac_sha256(key, `${id}.${timestamp}.${body}`))
		expect(await svix_verify({ secret, id, timestamp, body, signatures: `v1,${signature}` })).toBe(
			"stale_timestamp"
		)
	})

	it("verify_ecdsa_p256_sha256 verifies a DER signature against an SPKI key", async () => {
		const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
			"sign",
			"verify",
		])
		const data = "1600000000payload"
		const raw = new Uint8Array(
			await crypto.subtle.sign(
				{ name: "ECDSA", hash: "SHA-256" },
				pair.privateKey,
				new TextEncoder().encode(data)
			)
		)
		// WebCrypto emits raw r||s — wrap it in DER the way SendGrid sends it.
		const der = p1363_to_der(raw)
		const spki = base64_encode(
			new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey))
		)

		expect(
			await verify_ecdsa_p256_sha256({ public_key: spki, signature: base64_encode(der), data })
		).toBe(true)
		expect(
			await verify_ecdsa_p256_sha256({
				public_key: spki,
				signature: base64_encode(der),
				data: data + "!",
			})
		).toBe(false)
	})
})

/** Minimal P1363 (r||s) → DER conversion for the ECDSA test. */
function p1363_to_der(raw: Uint8Array): Uint8Array {
	const integer = (bytes: Uint8Array): Array<number> => {
		let start = 0
		while (start < bytes.length - 1 && bytes[start] === 0) start++
		let body = Array.from(bytes.slice(start))
		if (body[0] & 0x80) body = [0, ...body]
		return [0x02, body.length, ...body]
	}
	const r = integer(raw.slice(0, 32))
	const s = integer(raw.slice(32))
	return new Uint8Array([0x30, r.length + s.length, ...r, ...s])
}

describe("parse_user_agent", () => {
	it.each([
		[
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)",
			{ name: "Apple Mail", os: "iOS", device: "mobile" },
		],
		[
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
			{ name: "Apple Mail", os: "macOS", device: "desktop" },
		],
		[
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			{ name: "Chrome", os: "Windows", device: "desktop" },
		],
		[
			"Mozilla/5.0 (Windows NT 10.0; Microsoft Outlook 16.0.5)",
			{ name: "Outlook", os: "Windows", device: "desktop" },
		],
		["Outlook-iOS/2.0", { name: "Outlook", os: "iOS", device: "mobile" }],
		[
			"Mozilla/5.0 (X11; Linux x86_64) Thunderbird/115.0",
			{ name: "Thunderbird", os: "Linux", device: "desktop" },
		],
		// Google proxies pixel fetches — provider identifiable, device hidden.
		[
			"Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)",
			{ name: "Gmail", os: undefined, device: "unknown" },
		],
		[
			"Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)",
			{ name: "Apple Mail", os: "iPadOS", device: "tablet" },
		],
	])("%s", (ua, expected) => {
		expect(parse_user_agent(ua)).toMatchObject({ ...expected, user_agent: ua })
	})

	it("returns undefined for empty input", () => {
		expect(parse_user_agent(undefined)).toBeUndefined()
		expect(parse_user_agent("")).toBeUndefined()
	})
})

describe("receive — resend", () => {
	it("verifies and normalizes an opened event end to end", async () => {
		const { request, secret } = await mock_request({ provider: "resend", type: "opened" })
		const events = await receive(request, { provider: "resend", secret })

		expect(events).toHaveLength(1)
		expect(events[0]).toMatchObject({
			type: "opened",
			provider: "resend",
			message_id: "mock-email-id",
			email: "recipient@example.com",
			subject: "Mock subject",
			ip: "192.0.2.1",
		})
		expect(events[0].client).toMatchObject({ name: "Apple Mail", os: "iOS", device: "mobile" })
		expect(events[0].timestamp).toBeInstanceOf(Date)
	})

	it("normalizes clicked with the link, bounced with a category", async () => {
		const clicked = await mock_request({ provider: "resend", type: "clicked" })
		const [click] = await receive(clicked.request, { provider: "resend", secret: clicked.secret })
		expect(click).toMatchObject({ type: "clicked", url: "https://example.com/pricing" })
		expect(click.client?.name).toBe("Chrome")

		const bounced = await mock_request({ provider: "resend", type: "bounced" })
		const [bounce] = await receive(bounced.request, { provider: "resend", secret: bounced.secret })
		expect(bounce).toMatchObject({
			type: "bounced",
			bounce: { category: "hard", detail: "mailbox unavailable" },
		})
	})

	it("rejects a wrong secret with a WebhookVerificationError", async () => {
		const { request } = await mock_request({ provider: "resend", type: "delivered" })
		const error = await receive(request, {
			provider: "resend",
			secret: generate_svix_secret(),
		}).catch((e) => e)
		expect(error).toBeInstanceOf(WebhookVerificationError)
		expect(error.code).toBe("invalid_signature")
	})

	it("fails closed when no secret is configured", async () => {
		// "No secret" has to mean it, on any machine — an inherited RESEND_WEBHOOK_SECRET
		// turns this into a test that verification succeeds.
		delete process.env.RESEND_WEBHOOK_SECRET
		const { request } = await mock_request({ provider: "resend", type: "delivered" })
		const error = await receive(request, { provider: "resend" }).catch((e) => e)
		expect(error).toBeInstanceOf(WebhookVerificationError)
		expect(error.code).toBe("missing_secret")
	})

	it("verify: false normalizes without a secret", async () => {
		const { request } = await mock_request({ provider: "resend", type: "delivered" })
		const events = await receive(request, { provider: "resend", verify: false })
		expect(events[0].type).toBe("delivered")
	})

	it("rejects stale timestamps", async () => {
		const secret = generate_svix_secret()
		const body = JSON.stringify({ type: "email.delivered", data: {} })
		const id = "msg_old"
		const timestamp = String(Math.floor(Date.now() / 1000) - 3600)
		const key = base64_decode(secret.slice("whsec_".length))
		const signature = base64_encode(await hmac_sha256(key, `${id}.${timestamp}.${body}`))
		const request = new Request("https://example.com/webhooks", {
			method: "POST",
			headers: {
				"svix-id": id,
				"svix-timestamp": timestamp,
				"svix-signature": `v1,${signature}`,
			},
			body,
		})
		const error = await receive(request, { provider: "resend", secret }).catch((e) => e)
		expect(error).toBeInstanceOf(WebhookVerificationError)
		expect(error.code).toBe("stale_timestamp")
	})

	it("skips non-delivery events (contact.*, domain.*)", async () => {
		const request = new Request("https://example.com/webhooks", {
			method: "POST",
			body: JSON.stringify({ type: "contact.created", data: {} }),
		})
		expect(await receive(request, { provider: "resend", verify: false })).toEqual([])
	})
})

describe("receive — postboi", () => {
	it("verifies the webhook-* Svix-compatible scheme end to end", async () => {
		const { request, secret } = await mock_request({ provider: "postboi", type: "opened" })
		const events = await receive(request, { provider: "postboi", secret })
		expect(events[0]).toMatchObject({
			type: "opened",
			provider: "postboi",
			message_id: "mock-message-id",
			email: "recipient@example.com",
		})
		expect(events[0].client?.name).toBe("Apple Mail")
	})

	it("normalizes bounce categories", async () => {
		const { request, secret } = await mock_request({ provider: "postboi", type: "bounced" })
		const [event] = await receive(request, { provider: "postboi", secret })
		expect(event.bounce).toEqual({ category: "hard", detail: "mailbox unavailable" })
	})

	it("turns inbound mail around: the sender is the address, the answered send the id", async () => {
		const { request, secret } = await mock_request({ provider: "postboi", type: "received" })
		const [event] = await receive(request, { provider: "postboi", secret })
		expect(event).toMatchObject({
			type: "received",
			// Not the recipient — on inbound that would be your own sending address.
			email: "someone@example.com",
			message_id: "mock-message-id",
		})
		expect(event.body?.text).toBe("Thanks — that works for me.")
	})

	it("accepts a space/comma-separated secret list — any candidate verifies", async () => {
		const { request, secret } = await mock_request({ provider: "postboi", type: "opened" })
		// The real secret buried among decoys, both separators in play — rotation and
		// multiple endpoints on one handler both land here.
		const list = `${generate_svix_secret()} ${secret},${generate_svix_secret()}`
		const events = await receive(request, { provider: "postboi", secret: list })
		expect(events[0].type).toBe("opened")
	})

	it("carries an SMS event on the shared vocabulary, with the number in phone", async () => {
		const { request, secret } = await mock_request({
			provider: "postboi",
			type: "delivered",
			channel: "sms",
		})
		const [event] = await receive(request, { provider: "postboi", secret })
		expect(event).toMatchObject({
			type: "delivered",
			channel: "sms",
			phone: "+15557770006",
		})
		// A handler reading `email` must never be handed a phone number.
		expect(event.email).toBeUndefined()
	})

	it("reads WhatsApp's read receipt as the open it is", async () => {
		const { request, secret } = await mock_request({
			provider: "postboi",
			type: "opened",
			channel: "whatsapp",
		})
		// The wire type is channel-scoped: without that, "opened" would map back to
		// whichever of email.opened / whatsapp.read the table happened to list first.
		expect(JSON.parse(await request.clone().text()).type).toBe("whatsapp.read")

		const [event] = await receive(request, { provider: "postboi", secret })
		expect(event).toMatchObject({ type: "opened", channel: "whatsapp", phone: "+15557770006" })
	})

	it("leaves channel unset on email, so absent keeps meaning email", async () => {
		const { request, secret } = await mock_request({ provider: "postboi", type: "delivered" })
		const [event] = await receive(request, { provider: "postboi", secret })
		expect(event.channel).toBeUndefined()
		expect(event.phone).toBeUndefined()
		expect(event.email).toBe("recipient@example.com")
	})

	it("rejects when none of the listed secrets match", async () => {
		const { request } = await mock_request({ provider: "postboi", type: "opened" })
		const list = `${generate_svix_secret()} ${generate_svix_secret()}`
		const error = await receive(request, { provider: "postboi", secret: list }).catch((e) => e)
		expect(error).toBeInstanceOf(WebhookVerificationError)
		expect(error.code).toBe("invalid_signature")
	})
})

describe("receive — provider handling", () => {
	it("throws webhooks_not_supported for providers without events", async () => {
		const request = new Request("https://example.com/webhooks", { method: "POST", body: "{}" })
		const error = await receive(request, { provider: "smtp" as never }).catch((e) => e)
		expect(error).toMatchObject({ code: "webhooks_not_supported", provider: "smtp" })
	})

	it("accepts a custom adapter object", async () => {
		const request = new Request("https://example.com/webhooks", {
			method: "POST",
			body: JSON.stringify({ event: "opened", rcpt: "a@test.com" }),
		})
		const events = await receive(request, {
			verify: false,
			provider: {
				provider: "custom",
				verify() {},
				normalize(body) {
					const payload = JSON.parse(body) as { event: string; rcpt: string }
					return [{ type: "opened", provider: "custom", email: payload.rcpt, raw: payload }]
				},
			},
		})
		expect(events[0]).toMatchObject({ provider: "custom", email: "a@test.com" })
	})
})

describe("receive — lettermint", () => {
	it("rejects a stale signature timestamp (replay protection)", async () => {
		const { request, secret } = await mock_request({ provider: "lettermint", type: "delivered" })
		const body = await request.text()
		const stale = String(Math.floor(Date.now() / 1000) - 3600)
		const key = new TextEncoder().encode(secret)
		const imported = await crypto.subtle.importKey(
			"raw",
			key,
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"]
		)
		const digest = new Uint8Array(
			await crypto.subtle.sign("HMAC", imported, new TextEncoder().encode(`${stale}.${body}`))
		)
		const hex = [...digest].map((b) => b.toString(16).padStart(2, "0")).join("")
		const replay = new Request("https://example.com/webhooks", {
			method: "POST",
			headers: { "x-lettermint-signature": `t=${stale},v1=${hex}` },
			body,
		})
		const error = await receive(replay, { provider: "lettermint", secret }).catch((e) => e)
		expect(error).toBeInstanceOf(WebhookVerificationError)
		expect(error.code).toBe("stale_timestamp")
	})

	it("rejects when the delivery header disagrees with the signed timestamp", async () => {
		const { request, secret } = await mock_request({ provider: "lettermint", type: "delivered" })
		const headers = new Headers(request.headers)
		headers.set("x-lettermint-delivery", "1")
		const forged = new Request(request.url, { method: "POST", headers, body: await request.text() })
		const error = await receive(forged, { provider: "lettermint", secret }).catch((e) => e)
		expect(error).toBeInstanceOf(WebhookVerificationError)
		expect(error.code).toBe("invalid_signature")
	})

	it("classifies bounces and folds the reserved tag entry into one tag", async () => {
		const { request, secret } = await mock_request({ provider: "lettermint", type: "bounced" })
		const [event] = await receive(request, { provider: "lettermint", secret })
		expect(event.bounce).toEqual({ category: "hard", detail: "mailbox unavailable" })
		expect(event.tags).toEqual(["welcome"])

		const soft = JSON.stringify({
			event: "message.soft_bounced",
			timestamp: new Date().toISOString(),
			data: { message_id: "m", recipient: "r@example.com", response: { content: "try later" } },
		})
		const suppressed = JSON.stringify({
			event: "message.suppressed",
			timestamp: new Date().toISOString(),
			data: { message_id: "m", recipient: "r@example.com", reason: "hard_bounce" },
		})
		const { default: adapter } = await import("./webhooks/lettermint.js")
		const ctx = { headers: new Headers(), url: new URL("https://example.com/webhooks") }
		expect((await adapter.normalize(soft, ctx))[0].bounce).toEqual({
			category: "soft",
			detail: "try later",
		})
		expect((await adapter.normalize(suppressed, ctx))[0].bounce).toEqual({
			category: "suppressed",
			detail: "hard_bounce",
		})
	})

	it("turns inbound mail into received, with the sender as the address", async () => {
		const { request, secret } = await mock_request({ provider: "lettermint", type: "received" })
		const [event] = await receive(request, { provider: "lettermint", secret })
		expect(event.type).toBe("received")
		expect(event.email).toBe("someone@example.com")
		expect(event.body?.text).toContain("works for me")
	})

	it("ignores non-delivery events (created, suppression.*, webhook.test)", async () => {
		const { default: adapter } = await import("./webhooks/lettermint.js")
		const ctx = { headers: new Headers(), url: new URL("https://example.com/webhooks") }
		for (const event of ["message.created", "suppression.added", "webhook.test"]) {
			expect(await adapter.normalize(JSON.stringify({ event, data: {} }), ctx)).toEqual([])
		}
	})
})

describe("receive — unosend", () => {
	it("classifies bounces and reads the first recipient of an array", async () => {
		const { default: adapter } = await import("./webhooks/unosend.js")
		const ctx = { headers: new Headers(), url: new URL("https://example.com/webhooks") }
		const soft = JSON.stringify({
			type: "email.bounced",
			created_at: new Date().toISOString(),
			data: {
				email_id: "eml_1",
				to: ["first@example.com", "second@example.com"],
				bounce_type: "soft",
				bounce_reason: "Mailbox full",
			},
		})
		const [event] = await adapter.normalize(soft, ctx)
		expect(event.email).toBe("first@example.com")
		expect(event.bounce).toEqual({ category: "soft", detail: "Mailbox full" })
	})

	it("verifies whichever reading of the whsec_ secret the vendor signs with", async () => {
		const { default: adapter } = await import("./webhooks/unosend.js")
		const { hmac_sha256, hex_encode, base64_encode } = await import("./webhooks/crypto.js")
		const body = JSON.stringify({ type: "email.delivered", data: { email_id: "e" } })
		const raw = new Uint8Array(24).fill(7)
		const secret = `whsec_${base64_encode(raw)}`
		const keys: Array<Uint8Array | string> = [secret, secret.slice(6), raw]
		for (const key of keys) {
			const signature = hex_encode(await hmac_sha256(key, body))
			await expect(
				adapter.verify({
					body,
					headers: new Headers({ "x-unosend-signature": `sha256=${signature}` }),
					url: new URL("https://example.com/webhooks"),
					secret,
				})
			).resolves.toBeUndefined()
		}
		const wrong = hex_encode(await hmac_sha256("something-else", body))
		await expect(
			adapter.verify({
				body,
				headers: new Headers({ "x-unosend-signature": `sha256=${wrong}` }),
				url: new URL("https://example.com/webhooks"),
				secret,
			})
		).rejects.toBeInstanceOf(WebhookVerificationError)
	})

	it("accepts the signature with or without its sha256= prefix", async () => {
		const { request, secret } = await mock_request({ provider: "unosend", type: "opened" })
		const body = await request.text()
		const bare = request.headers.get("x-unosend-signature")!.replace(/^sha256=/, "")
		const unprefixed = new Request(request.url, {
			method: "POST",
			headers: { "x-unosend-signature": bare },
			body,
		})
		const [event] = await receive(unprefixed, { provider: "unosend", secret })
		expect(event.client?.name).toBeTruthy()
		expect(event.ip).toBe("192.0.2.1")
	})
})

describe("receive — sequenzy", () => {
	const ctx = { headers: new Headers(), url: new URL("https://example.com/webhooks") }

	it("rejects a stale timestamp (replay protection)", async () => {
		const { request, secret } = await mock_request({ provider: "sequenzy", type: "delivered" })
		const body = await request.text()
		const { hmac_sha256, hex_encode } = await import("./webhooks/crypto.js")
		const stale = String(Math.floor(Date.now() / 1000) - 3600)
		const hex = hex_encode(await hmac_sha256(secret, `v1:${stale}:${body}`))
		const replay = new Request(request.url, {
			method: "POST",
			headers: { "x-sequenzy-timestamp": stale, "x-sequenzy-signature": `v1=${hex}` },
			body,
		})
		const error = await receive(replay, { provider: "sequenzy", secret }).catch((e) => e)
		expect(error).toBeInstanceOf(WebhookVerificationError)
		expect(error.code).toBe("stale_timestamp")
	})

	it("accepts any v1= value in the header, and any configured secret, during a rotation", async () => {
		const { request, secret } = await mock_request({ provider: "sequenzy", type: "delivered" })
		const body = await request.text()
		const timestamp = request.headers.get("x-sequenzy-timestamp")!
		const { hmac_sha256, hex_encode } = await import("./webhooks/crypto.js")
		const good = hex_encode(await hmac_sha256(secret, `v1:${timestamp}:${body}`))
		const other = hex_encode(await hmac_sha256("retired-secret", `v1:${timestamp}:${body}`))
		const rotated = new Request(request.url, {
			method: "POST",
			headers: {
				"x-sequenzy-timestamp": timestamp,
				"x-sequenzy-signature": `v1=${other},v1=${good}`,
			},
			body,
		})
		const [event] = await receive(rotated, { provider: "sequenzy", secret: `old-one, ${secret}` })
		expect(event.type).toBe("delivered")
		expect(event.message_id).toBe("send_mock")
	})

	it("verifies whichever reading of the whsec_ secret the vendor signs with", async () => {
		const { default: adapter } = await import("./webhooks/sequenzy.js")
		const { hmac_sha256, hex_encode, base64_encode } = await import("./webhooks/crypto.js")
		const body = JSON.stringify({ type: "email.delivered", data: { email_send_id: "s" } })
		const timestamp = String(Math.floor(Date.now() / 1000))
		const raw = new Uint8Array(24).fill(7)
		const secret = `whsec_${base64_encode(raw)}`
		const keys: Array<Uint8Array | string> = [secret, secret.slice(6), raw]
		for (const key of keys) {
			const digest = await hmac_sha256(key, `v1:${timestamp}:${body}`)
			for (const signature of [hex_encode(digest), base64_encode(digest)]) {
				await expect(
					adapter.verify({
						body,
						headers: new Headers({
							"x-sequenzy-timestamp": timestamp,
							"x-sequenzy-signature": `v1=${signature}`,
						}),
						url: ctx.url,
						secret,
					})
				).resolves.toBeUndefined()
			}
		}
		const wrong = hex_encode(await hmac_sha256("something-else", `v1:${timestamp}:${body}`))
		await expect(
			adapter.verify({
				body,
				headers: new Headers({
					"x-sequenzy-timestamp": timestamp,
					"x-sequenzy-signature": `v1=${wrong}`,
				}),
				url: ctx.url,
				secret,
			})
		).rejects.toBeInstanceOf(WebhookVerificationError)
	})

	it("keys events on the send id, reads engagement, and classifies bounces", async () => {
		const { request, secret } = await mock_request({ provider: "sequenzy", type: "clicked" })
		const [clicked] = await receive(request, { provider: "sequenzy", secret })
		expect(clicked.message_id).toBe("send_mock")
		expect(clicked.url).toBe("https://example.com/pricing")
		expect(clicked.ip).toBe("192.0.2.1")
		expect(clicked.client?.name).toBeTruthy()

		const { default: adapter } = await import("./webhooks/sequenzy.js")
		const bounced = JSON.stringify({
			type: "email.bounced",
			created_at: new Date().toISOString(),
			data: { email_send_id: "send_1", message_id: "upstream", recipient: "r@example.com" },
		})
		// Unlabelled is hard: Sequenzy only calls it a bounce once the mailbox was judged bad.
		expect((await adapter.normalize(bounced, ctx))[0].bounce).toEqual({ category: "hard" })
		const soft = JSON.stringify({
			type: "email.bounced",
			data: { email_send_id: "send_1", bounce_type: "soft", reason: "Mailbox full" },
		})
		expect((await adapter.normalize(soft, ctx))[0].bounce).toEqual({
			category: "soft",
			detail: "Mailbox full",
		})
	})

	it("maps delays and exhausted deliveries, and ignores everything that isn't mail", async () => {
		const { default: adapter } = await import("./webhooks/sequenzy.js")
		const one = async (type: string, data: Record<string, unknown> = {}) =>
			adapter.normalize(JSON.stringify({ type, data }), ctx)
		expect((await one("email.delivery_delayed"))[0].type).toBe("delayed")
		expect((await one("email.failed", { failure: { code: "admin_bounce" } }))[0].type).toBe(
			"failed"
		)
		expect((await one("email.unsubscribed"))[0].type).toBe("unsubscribed")
		for (const type of ["campaign.sent", "sms.delivered", "subscriber.updated", "poll.answered"]) {
			expect(await one(type), type).toEqual([])
		}
	})

	it("turns a tracked reply into received, with the sender as the address", async () => {
		const { request, secret } = await mock_request({ provider: "sequenzy", type: "received" })
		const [event] = await receive(request, { provider: "sequenzy", secret })
		expect(event.type).toBe("received")
		expect(event.email).toBe("someone@example.com")
		expect(event.message_id).toBe("send_mock")
		expect(event.body?.text).toContain("works for me")
		expect(event.body?.html).toContain("<p>")
	})
})

describe("mock_event", () => {
	it("builds a normalized event with sensible defaults and overrides", () => {
		const event = mock_event("clicked", { email: "user@example.com" })
		expect(event).toMatchObject({
			type: "clicked",
			email: "user@example.com",
			url: "https://example.com/pricing",
		})
		expect(event.client?.name).toBe("Apple Mail")
	})
})

describe("receive — every provider round-trips through mock_request", () => {
	const cases: Array<[string, Array<"delivered" | "opened" | "clicked" | "bounced">]> = [
		["postboi", ["delivered", "opened", "clicked", "bounced"]],
		["resend", ["delivered", "opened", "clicked", "bounced"]],
		["sendgrid", ["delivered", "opened", "clicked", "bounced"]],
		["mailgun", ["delivered", "opened", "clicked", "bounced"]],
		["postmark", ["delivered", "opened", "clicked", "bounced"]],
		["brevo", ["delivered", "opened", "clicked", "bounced"]],
		["mailersend", ["delivered", "opened", "clicked", "bounced"]],
		// Mandrill has no delivered event — send/deferral/bounce/open/click only.
		["mandrill", ["opened", "clicked", "bounced"]],
		["sparkpost", ["delivered", "opened", "clicked", "bounced"]],
		["mailjet", ["delivered", "opened", "clicked", "bounced"]],
		["mailtrap", ["delivered", "opened", "clicked", "bounced"]],
		["lettermint", ["delivered", "opened", "clicked", "bounced"]],
		["unosend", ["delivered", "opened", "clicked", "bounced"]],
		["sequenzy", ["delivered", "opened", "clicked", "bounced"]],
		["zepto", ["delivered", "opened", "clicked", "bounced"]],
		["elasticemail", ["delivered", "opened", "clicked", "bounced"]],
		// Plunk's documented payload is minimal — no click URL surfaced.
		["plunk", ["delivered", "opened", "bounced"]],
		["ses", ["delivered", "opened", "clicked", "bounced"]],
		["scaleway", ["delivered", "bounced"]],
	]

	it.each(cases)("%s", async (provider, types) => {
		for (const type of types) {
			const { request, secret } = await mock_request({ provider, type })
			const events = await receive(request, { provider: provider as never, secret })
			expect(events.length, `${provider}/${type} events`).toBeGreaterThanOrEqual(1)
			const event = events[0]
			expect(event.type, `${provider}/${type} type`).toBe(type)
			expect(event.provider).toBe(provider)
			expect(event.email, `${provider}/${type} email`).toBe("recipient@example.com")
			expect(event.message_id, `${provider}/${type} message_id`).toBeTruthy()
			if (type === "clicked") {
				expect(event.url, `${provider} clicked url`).toBe("https://example.com/pricing")
			}
			if (type === "bounced") {
				expect(event.bounce?.category, `${provider} bounce category`).toBeTruthy()
			}
		}
	})

	// Zepto normalizes delivered/opened/clicked/bounced fine, but only if the adapter maps
	// them; the parameterized case above covers it. MailPace needs Ed25519 — feature-gated.
	it("mailpace (Ed25519, when the runtime supports it)", async (ctx) => {
		try {
			await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"])
		} catch {
			ctx.skip()
			return
		}
		for (const type of ["delivered", "bounced"] as const) {
			const { request, secret } = await mock_request({ provider: "mailpace", type })
			const events = await receive(request, { provider: "mailpace", secret })
			expect(events[0]).toMatchObject({ type, provider: "mailpace" })
		}
	})

	it("signed providers reject a wrong secret", async () => {
		for (const provider of [
			"sendgrid",
			"mailgun",
			"mailersend",
			"mandrill",
			"mailtrap",
			"lettermint",
			"unosend",
			"sequenzy",
		]) {
			const { request } = await mock_request({ provider, type: "delivered" })
			const error = await receive(request, {
				provider: provider as never,
				secret: "wrong-secret",
			}).catch((e) => e)
			expect(error, `${provider} wrong secret`).toBeInstanceOf(WebhookVerificationError)
		}
	})

	it("shared-secret providers reject a wrong token", async () => {
		for (const provider of ["postmark", "brevo", "mailjet", "ses", "elasticemail", "smsworks"]) {
			const { request } = await mock_request({ provider, type: "delivered" })
			const error = await receive(request, {
				provider: provider as never,
				secret: "not-the-token",
			}).catch((e) => e)
			expect(error, `${provider} wrong token`).toBeInstanceOf(WebhookVerificationError)
			expect(error.code).toBe("invalid_signature")
		}
	})

	it("confirms SNS subscription handshakes and returns no events", async () => {
		const fetch_spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"))
		try {
			const secret = "sns-token"
			const request = new Request(`https://example.com/webhooks?token=${secret}`, {
				method: "POST",
				body: JSON.stringify({
					Type: "SubscriptionConfirmation",
					SubscribeURL: "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=x",
				}),
			})
			const events = await receive(request, { provider: "ses", secret })
			expect(events).toEqual([])
			expect(fetch_spy).toHaveBeenCalledWith(
				"https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=x"
			)
		} finally {
			fetch_spy.mockRestore()
		}
	})

	it("never confirms a subscribe URL outside amazonaws.com", async () => {
		const fetch_spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"))
		try {
			const secret = "sns-token"
			const request = new Request(`https://example.com/webhooks?token=${secret}`, {
				method: "POST",
				body: JSON.stringify({
					Type: "SubscriptionConfirmation",
					SubscribeURL: "https://evil.example.com/steal",
				}),
			})
			const events = await receive(request, { provider: "ses", secret })
			expect(events).toEqual([])
			expect(fetch_spy).not.toHaveBeenCalled()
		} finally {
			fetch_spy.mockRestore()
		}
	})
})

describe("receive — smsworks (SMS delivery reports and replies)", () => {
	// Twilio's receipts are polled; The SMS Works pushes them, so this is the first
	// webhook adapter whose events are about a number rather than an address.
	it("a delivery report is a delivered event about a phone number, never an email", async () => {
		const { request, secret } = await mock_request({ provider: "smsworks", type: "delivered" })
		const [event] = await receive(request, { provider: "smsworks", secret })
		expect(event).toMatchObject({
			type: "delivered",
			provider: "smsworks",
			channel: "sms",
			phone: "+447700900123",
			message_id: "d87e93c0-fa08-4903-becd-aeb5b0ab3b6a",
			tags: ["otp"],
		})
		expect(event.email).toBeUndefined()
		expect(event.timestamp).toBeInstanceOf(Date)
	})

	it("maps the statuses: SENT, the three failures, and never SCHEDULED", async () => {
		const secret = "smsworks-token"
		const url = `https://example.com/webhooks?token=${secret}`
		const post = (payload: Record<string, unknown>) =>
			receive(new Request(url, { method: "POST", body: JSON.stringify(payload) }), {
				provider: "smsworks",
				secret,
			})
		const base = { messageid: "m1", destination: "447700900123", modified: "2026-08-07T10:00:00Z" }

		expect((await post({ ...base, status: "SENT" }))[0].type).toBe("sent")
		for (const status of ["UNDELIVERABLE", "REJECTED", "EXPIRED"]) {
			expect((await post({ ...base, status }))[0].type, status).toBe("failed")
		}
		// The provider still holding the message is not something that happened to it.
		expect(await post({ ...base, status: "SCHEDULED" })).toEqual([])
		// Lower-case, just in case a payload ever arrives that way.
		expect((await post({ ...base, status: "delivered" }))[0].type).toBe("delivered")
		// A healthy report can carry an empty failure object; that is not a retry.
		const healthy = {
			...base,
			status: "SENT",
			failurereason: { code: 0, details: "", permanent: false },
		}
		expect((await post(healthy))[0]).toMatchObject({ type: "sent", bounce: undefined })
	})

	it("takes a list of reports, and refuses a body that is no report at all", async () => {
		const secret = "smsworks-token"
		const url = `https://example.com/webhooks?token=${secret}`
		const post = (body: string) =>
			receive(new Request(url, { method: "POST", body }), { provider: "smsworks", secret })
		const events = await post(
			JSON.stringify([
				{ messageid: "a", status: "DELIVERED", destination: 447700900123 },
				{ messageid: "b", status: "SCHEDULED", destination: 447700900124 },
				{ messageid: "c", status: "EXPIRED", destination: 447700900125 },
			])
		)
		expect(events.map((event) => [event.message_id, event.type])).toEqual([
			["a", "delivered"],
			["c", "failed"],
		])
		const error = await post("null").catch((e) => e)
		expect(error).toMatchObject({ code: "invalid_payload", provider: "smsworks" })
	})

	it("leaves phone unset for a destination that isn't a number, rather than inventing one", async () => {
		const secret = "smsworks-token"
		const request = new Request(`https://example.com/webhooks?token=${secret}`, {
			method: "POST",
			body: JSON.stringify({ messageid: "m1", status: "DELIVERED", destination: "4477" }),
		})
		const [event] = await receive(request, { provider: "smsworks", secret })
		expect(event.type).toBe("delivered")
		expect(event.phone).toBeUndefined()
	})

	it("classifies a failure by the permanent flag, with the carrier's code in the detail", async () => {
		const { request, secret } = await mock_request({ provider: "smsworks", type: "failed" })
		const [event] = await receive(request, { provider: "smsworks", secret })
		expect(event.type).toBe("failed")
		expect(event.bounce?.category).toBe("hard")
		expect(event.bounce?.detail).toBe(
			"5001 Handset Error: Number does not exist or has not been assigned to a user."
		)
	})

	it("a SENT carrying a temporary failure is delayed — the carrier is still trying", async () => {
		const { request, secret } = await mock_request({ provider: "smsworks", type: "delayed" })
		const [event] = await receive(request, { provider: "smsworks", secret })
		expect(event.type).toBe("delayed")
		expect(event.bounce?.category).toBe("soft")
		expect(event.bounce?.detail).toContain("3001")
	})

	it("reads an inbound reply for an opt-out and nothing else", async () => {
		const { request, secret } = await mock_request({ provider: "smsworks", type: "unsubscribed" })
		const [event] = await receive(request, { provider: "smsworks", secret })
		// The number is the sender's — they are the one opting out.
		expect(event).toMatchObject({
			type: "unsubscribed",
			channel: "sms",
			phone: "+447700900123",
			message_id: "328827210622192878142",
		})

		const url = `https://example.com/webhooks?token=${secret}`
		const reply = new Request(url, {
			method: "POST",
			body: JSON.stringify({
				messagetype: "incoming",
				messageid: "in-2",
				content: "Thanks, see you at 3",
				from: "447700900123",
			}),
		})
		expect(await receive(reply, { provider: "smsworks", secret })).toEqual([])
	})

	it("accepts the token as a basic-auth password, the option their reply webhooks offer", async () => {
		const secret = "smsworks-token"
		const request = new Request("https://example.com/webhooks", {
			method: "POST",
			headers: { authorization: `Basic ${btoa(`postboi:${secret}`)}` },
			body: JSON.stringify({ messageid: "m1", status: "DELIVERED", destination: 447700900123 }),
		})
		const events = await receive(request, { provider: "smsworks", secret })
		expect(events[0]).toMatchObject({ type: "delivered", phone: "+447700900123" })
	})
})
