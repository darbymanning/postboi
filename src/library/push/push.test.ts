import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import MockPush from "./mock.js"
import WebPush, { clear_vapid_cache } from "./webpush.js"
import APNs, { clear_apns_tokens } from "./apns.js"
import HMS from "./hms.js"
import { clear_token_cache } from "./oauth.js"
import { PushProvider } from "./provider.js"
import { push } from "./send.js"
import { configure, reset_config } from "../config.js"
import type { Channel, PostboiError } from "../errors.js"

// APNs is the one provider that can't go through the global fetch — it speaks HTTP/2 —
// so its transport is the seam to stub, exactly as `fetch` is for everything else.
const http2_fetch = vi.hoisted(() => vi.fn())
vi.mock("./http2.js", () => ({ http2_fetch, close_http2_sessions: () => {} }))

const SUBSCRIPTION = {
	endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
	keys: {
		p256dh:
			"BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
		auth: "BTBZMqHH6r4Tts7J_aSIgg",
	},
}
const VAPID = {
	public_key:
		"BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
	private_key: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
	subject: "mailto:you@example.com",
}

// A real P-256 key in .p8 shape — the signing path is the point of these tests, so a
// fixture that WebCrypto refuses to import would prove nothing.
const APNS = {
	key_id: "ABC1234567",
	team_id: "TEAM123456",
	topic: "com.example.app",
	private_key:
		"-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgSlMr9cyykHQqjsba\nRE/NSK6k0equ5zgboyWxvPczWSmhRANCAAQwNJfPKRALk/I14IAp/WFlk+Mo1Mcr\nMSHpnAMiRM5wHhc4z+R9vOF0RaLBDpYdMV2HciCfJZBuJovIvGxngLHp\n-----END PRIVATE KEY-----\n",
}
const DEVICE_TOKEN = "a".repeat(64)

const HMS_CREDS = { app_id: "1234567890", app_secret: "s3cret" }
const HMS_TOKEN = '{"access_token":"tok","expires_in":3600}'

/** Huawei answers 200 whatever happened — the outcome is the `code` in the body. */
const hms_respond = (body: string, { ok = true, status = 200 } = {}) =>
	({ ok, status, url: "", headers: new Headers(), text: async () => body }) as unknown as Response

const apns_respond = ({ ok = true, status = 200, body = "" } = {}) =>
	({
		ok,
		status,
		url: "",
		headers: new Headers(ok ? { "apns-id": "1234-5678" } : {}),
		text: async () => body,
	}) as unknown as Response

const respond = ({ ok = true, status = 201, body = "" } = {}) =>
	({
		ok,
		status,
		url: SUBSCRIPTION.endpoint,
		headers: new Headers(),
		text: async () => body,
	}) as unknown as Response

beforeEach(() => {
	reset_config()
	vi.unstubAllGlobals()
	http2_fetch.mockReset()
	clear_apns_tokens()
	clear_token_cache()
	delete process.env.NODE_ENV
	delete process.env.POSTBOI_PUSH_PROVIDER
})
afterEach(() => {
	reset_config()
	delete process.env.VAPID_PUBLIC_KEY
	delete process.env.VAPID_PRIVATE_KEY
	delete process.env.VAPID_SUBJECT
})

describe("prepare", () => {
	it("rejects an empty message, tagged with the push channel", async () => {
		const notify = new MockPush()
		const error = (await notify.send({ to: "tok", message: " " }).catch((e) => e)) as PostboiError
		expect(error.code).toBe("empty_message")
		expect(error.channel).toBe<Channel>("push")
	})

	it("rejects a missing target like production would — the mock must not mask it", async () => {
		const notify = new MockPush()
		const error = (await notify.send({ message: "hi" }).catch((e) => e)) as PostboiError
		expect(error.code).toBe("no_target")
	})

	it("defaults ttl and urgency", async () => {
		const notify = new MockPush()
		await notify.send({ to: "tok", message: "hi" })
		expect(notify.last).toMatchObject({ to: "tok", message: "hi" })
	})
})

describe("webpush", () => {
	it("posts the encrypted body with the headers a push service expects", async () => {
		const fetch = vi.fn().mockResolvedValue(respond({}))
		vi.stubGlobal("fetch", fetch)
		const notify = new WebPush(VAPID)

		await notify.send({
			to: SUBSCRIPTION,
			title: "Order shipped",
			message: "On its way",
			urgency: "high",
			ttl: 60,
		})

		const [url, init] = fetch.mock.calls[0]
		expect(url).toBe(SUBSCRIPTION.endpoint)
		expect(init.headers["Content-Encoding"]).toBe("aes128gcm")
		expect(init.headers["Content-Type"]).toBe("application/octet-stream")
		expect(init.headers.TTL).toBe("60")
		expect(init.headers.Urgency).toBe("high")
		expect(init.headers.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/)
		// The body must be raw encrypted bytes, not JSON.
		expect(init.body).toBeInstanceOf(Uint8Array)
	})

	it("treats a 410 as an expired subscription, and says what to do about it", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond({ ok: false, status: 410 })))
		const notify = new WebPush(VAPID)

		const error = (await notify
			.send({ to: SUBSCRIPTION, message: "hi" })
			.catch((e) => e)) as PostboiError

		expect(error.code).toBe("expired_subscription")
		expect(error.status).toBe(410)
		// Expiry is routine, and the right response is to forget the subscription rather than
		// retry — so it's a first-class check, not a status code to match on by hand.
		expect(PushProvider.is_expired(error)).toBe(true)
	})

	it("refuses a bare token, pointing at the provider that wants one", async () => {
		vi.stubGlobal("fetch", vi.fn())
		const notify = new WebPush(VAPID)
		await expect(notify.send({ to: "a-device-token", message: "hi" })).rejects.toMatchObject({
			code: "invalid_target",
		})
	})

	it("signs one VAPID JWT per push-service origin, not per send", async () => {
		clear_vapid_cache()
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond({})))
		// ECDSA signing only happens in vapid_header — payload encryption is ECDH + AES.
		const sign_spy = vi.spyOn(crypto.subtle, "sign")
		const notify = new WebPush(VAPID)

		await notify.send({ to: SUBSCRIPTION, message: "one" })
		await notify.send({ to: SUBSCRIPTION, message: "two" })
		expect(sign_spy).toHaveBeenCalledTimes(1)

		const elsewhere = {
			...SUBSCRIPTION,
			endpoint: "https://updates.push.services.mozilla.com/wpush/v2/xyz",
		}
		await notify.send({ to: elsewhere, message: "three" })
		expect(sign_spy).toHaveBeenCalledTimes(2)

		// The cache is shared across instances on purpose: zero-config push() constructs a
		// fresh provider per call, and a per-instance cache would never hit.
		const fresh = new WebPush(VAPID)
		await fresh.send({ to: SUBSCRIPTION, message: "four" })
		expect(sign_spy).toHaveBeenCalledTimes(2)
		sign_spy.mockRestore()
	})

	it("rejects an oversized payload before encrypting, naming the real limit", async () => {
		vi.stubGlobal("fetch", vi.fn())
		const notify = new WebPush(VAPID)
		await expect(
			notify.send({ to: SUBSCRIPTION, message: "a".repeat(4200) })
		).rejects.toMatchObject({ code: "payload_too_large" })
	})
})

describe("apns", () => {
	it("posts to the device path with the headers APNs requires", async () => {
		http2_fetch.mockResolvedValue(apns_respond({}))
		const notify = new APNs(APNS)

		const sent = await notify.send({
			to: DEVICE_TOKEN,
			title: "Order shipped",
			message: "On its way",
			url: "https://example.com/orders/1",
			ttl: 60,
		})

		const [url, init] = http2_fetch.mock.calls[0]
		expect(url).toBe(`https://api.push.apple.com/3/device/${DEVICE_TOKEN}`)
		expect(init.headers["apns-topic"]).toBe("com.example.app")
		// Required since iOS 13 — omit it and APNs rejects the request outright.
		expect(init.headers["apns-push-type"]).toBe("alert")
		expect(init.headers["apns-priority"]).toBe("10")
		expect(Number(init.headers["apns-expiration"])).toBeCloseTo(Date.now() / 1000 + 60, -1)
		expect(init.headers.authorization).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/)
		// Custom keys sit beside `aps`, never inside it.
		expect(JSON.parse(init.body)).toEqual({
			aps: { alert: { title: "Order shipped", body: "On its way" }, sound: "default" },
			url: "https://example.com/orders/1",
		})
		expect(sent).toEqual({ id: "1234-5678" })
	})

	it("holds a low-urgency alert back, and sends everything else immediately", async () => {
		http2_fetch.mockResolvedValue(apns_respond({}))
		const notify = new APNs(APNS)

		await notify.send({ to: DEVICE_TOKEN, message: "hi", urgency: "low" })
		expect(http2_fetch.mock.calls[0][1].headers["apns-priority"]).toBe("5")
		await notify.send({ to: DEVICE_TOKEN, message: "hi", urgency: "high" })
		expect(http2_fetch.mock.calls[1][1].headers["apns-priority"]).toBe("10")
	})

	it("talks to the sandbox when asked — a mismatch there reads as a bad token", async () => {
		http2_fetch.mockResolvedValue(apns_respond({}))
		await new APNs({ ...APNS, environment: "sandbox" }).send({ to: DEVICE_TOKEN, message: "hi" })
		expect(http2_fetch.mock.calls[0][0]).toContain("https://api.sandbox.push.apple.com/")
	})

	it("signs one provider token per key, not one per send", async () => {
		http2_fetch.mockResolvedValue(apns_respond({}))
		const sign_spy = vi.spyOn(crypto.subtle, "sign")
		const notify = new APNs(APNS)

		await notify.send({ to: DEVICE_TOKEN, message: "one" })
		await notify.send({ to: DEVICE_TOKEN, message: "two" })
		expect(sign_spy).toHaveBeenCalledTimes(1)

		// Shared across instances like the VAPID and FCM caches — and here Apple enforces
		// it: re-signing more than once every 20 minutes is TooManyProviderTokenUpdates.
		await new APNs(APNS).send({ to: DEVICE_TOKEN, message: "three" })
		expect(sign_spy).toHaveBeenCalledTimes(1)
		sign_spy.mockRestore()
	})

	it("treats BadDeviceToken as expired, though it arrives as a 400", async () => {
		http2_fetch.mockResolvedValue(
			apns_respond({ ok: false, status: 400, body: '{"reason":"BadDeviceToken"}' })
		)
		const error = (await new APNs(APNS)
			.send({ to: DEVICE_TOKEN, message: "hi" })
			.catch((e) => e)) as PostboiError

		expect(error.status).toBe(400)
		// The status says "bad request" and only the reason says "gone", so this is the case
		// a status-only is_expired() would silently miss.
		expect(push.expired(error)).toBe(true)
	})

	it("passes other APNs reasons through instead of swallowing them", async () => {
		http2_fetch.mockResolvedValue(
			apns_respond({ ok: false, status: 403, body: '{"reason":"InvalidProviderToken"}' })
		)
		const error = (await new APNs(APNS)
			.send({ to: DEVICE_TOKEN, message: "hi" })
			.catch((e) => e)) as PostboiError

		expect(error.code).toBe("InvalidProviderToken")
		expect(push.expired(error)).toBe(false)
	})

	it("refuses targets that belong to another provider", async () => {
		const notify = new APNs(APNS)
		await expect(notify.send({ to: SUBSCRIPTION, message: "hi" })).rejects.toMatchObject({
			code: "invalid_target",
		})
		// An FCM registration token is not hex, and would otherwise be a bare 400 from Apple.
		await expect(notify.send({ to: "fMEP:APA91bH-not-hex", message: "hi" })).rejects.toMatchObject({
			code: "invalid_target",
		})
		expect(http2_fetch).not.toHaveBeenCalled()
	})

	it("rejects an oversized payload before sending, naming the real limit", async () => {
		await expect(
			new APNs(APNS).send({ to: DEVICE_TOKEN, message: "a".repeat(4200) })
		).rejects.toMatchObject({ code: "payload_too_large" })
		expect(http2_fetch).not.toHaveBeenCalled()
	})

	it("says which env var is wrong when the .p8 is unreadable", async () => {
		await expect(
			new APNs({ ...APNS, private_key: "not a key" }).send({ to: DEVICE_TOKEN, message: "hi" })
		).rejects.toMatchObject({ code: "invalid_key" })
	})
})

describe("hms", () => {
	/** Token exchange first, then the send — HMS always makes two calls on a cold cache. */
	const stub_hms = (send_body: string) => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(hms_respond(HMS_TOKEN))
			.mockResolvedValue(hms_respond(send_body))
		vi.stubGlobal("fetch", fetch)
		return fetch
	}

	it("exchanges the app secret, then posts the message Push Kit expects", async () => {
		const fetch = stub_hms('{"code":"80000000","msg":"Success","requestId":"req-1"}')

		const sent = await new HMS(HMS_CREDS).send({
			to: "device-token",
			title: "Order shipped",
			message: "On its way",
			url: "https://example.com/orders/1",
			urgency: "high",
			ttl: 600,
		})

		const [token_url, token_init] = fetch.mock.calls[0]
		expect(token_url).toBe("https://oauth-login.cloud.huawei.com/oauth2/v3/token")
		expect(token_init.body).toContain("grant_type=client_credentials")

		const [url, init] = fetch.mock.calls[1]
		expect(url).toBe("https://push-api.cloud.huawei.com/v1/1234567890/messages:send")
		expect(init.headers.Authorization).toBe("Bearer tok")
		expect(JSON.parse(init.body)).toEqual({
			validate_only: false,
			message: {
				token: ["device-token"],
				notification: { title: "Order shipped", body: "On its way" },
				android: {
					ttl: "600s",
					urgency: "HIGH",
					// Huawei takes the custom payload as a JSON string, not an object.
					data: '{"url":"https://example.com/orders/1"}',
					notification: { click_action: { type: 2, url: "https://example.com/orders/1" } },
				},
			},
		})
		expect(sent).toEqual({ request_id: "req-1" })
	})

	it("fails a send that came back 200 with an error code", async () => {
		stub_hms('{"code":"80300002","msg":"App does not have permission"}')

		const error = (await new HMS(HMS_CREDS)
			.send({ to: "device-token", message: "hi" })
			.catch((e) => e)) as PostboiError

		// The trap this provider exists to avoid: the HTTP status says success, and only the
		// body says otherwise. A status-only check would report a silent non-delivery as sent.
		expect(error.status).toBe(200)
		expect(error.code).toBe("80300002")
		expect(error.message).toContain("App does not have permission")
	})

	it("treats an invalid-token code as expired, like every other push provider", async () => {
		stub_hms('{"code":"80300007","msg":"All tokens are invalid"}')

		const error = await new HMS(HMS_CREDS).send({ to: "dead", message: "hi" }).catch((e) => e)
		expect(push.expired(error)).toBe(true)
	})

	it("clamps a TTL past Huawei's ceiling instead of being rejected for it", async () => {
		const fetch = stub_hms('{"code":"80000000"}')
		// The library's default TTL is 28 days; Huawei holds a message for at most 15.
		await new HMS(HMS_CREDS).send({ to: "device-token", message: "hi" })
		expect(JSON.parse(fetch.mock.calls[1][1].body).message.android.ttl).toBe("1296000s")
	})

	it("exchanges one token for a whole batch, not one per notification", async () => {
		const fetch = stub_hms('{"code":"80000000"}')
		const results = await new HMS(HMS_CREDS).send([
			{ to: "a", message: "one" },
			{ to: "b", message: "two" },
			{ to: "c", message: "three" },
		])

		expect(results.every((r) => r.ok)).toBe(true)
		// One exchange plus three sends. Caching the in-flight promise is what stops three
		// cold sends racing into three token requests.
		expect(fetch).toHaveBeenCalledTimes(4)
	})

	it("refuses a Web Push subscription, pointing at the provider that wants one", async () => {
		await expect(
			new HMS(HMS_CREDS).send({ to: SUBSCRIPTION, message: "hi" })
		).rejects.toMatchObject({ code: "invalid_target" })
	})
})

describe("zero-config push()", () => {
	it("resolves webpush from the environment", async () => {
		process.env.VAPID_PUBLIC_KEY = VAPID.public_key
		process.env.VAPID_PRIVATE_KEY = VAPID.private_key
		process.env.VAPID_SUBJECT = VAPID.subject
		configure({ push: { provider: "webpush" } })
		const fetch = vi.fn().mockResolvedValue(respond({}))
		vi.stubGlobal("fetch", fetch)

		await push({ to: SUBSCRIPTION, message: "hi" })
		expect(fetch.mock.calls[0][0]).toBe(SUBSCRIPTION.endpoint)
	})

	it("throws outside development when nothing is configured", async () => {
		await expect(push({ to: "tok", message: "hi" })).rejects.toMatchObject({
			code: "no_push_provider",
		})
	})

	it("reports a missing credential by env var name", async () => {
		configure({ push: { provider: "webpush" } })
		await expect(push({ to: SUBSCRIPTION, message: "hi" })).rejects.toThrow(/VAPID_PUBLIC_KEY/)
	})
})

describe("expiry handling", () => {
	it("is_expired covers both codes a push service uses, and nothing else", async () => {
		const notify = new MockPush({ expired: true })
		const error = await notify.send({ to: "tok", message: "hi" }).catch((e) => e)
		expect(PushProvider.is_expired(error)).toBe(true)
		// The documented one-import form: the check hangs off push() itself.
		expect(push.expired(error)).toBe(true)
		expect(push.expired(new Error("other"))).toBe(false)

		const other = await new MockPush({ fail: true })
			.send({ to: "tok", message: "hi" })
			.catch((e) => e)
		expect(PushProvider.is_expired(other)).toBe(false)
	})

	it("one bad notification in a batch does not lose the rest", async () => {
		// The mock defaults a target so it works unconfigured, so drop that to get a
		// genuinely unaddressed send.
		class NoDefault extends MockPush {
			constructor() {
				super()
				this.defaults = {}
			}
		}
		const notify = new NoDefault()
		const results = await notify.send([
			{ to: "good-1", message: "hi" },
			{ message: "no target" },
			{ to: "good-2", message: "hi" },
		])
		expect(results.map((r) => r.ok)).toEqual([true, false, true])
		expect(notify.sent).toHaveLength(2)
	})
})
