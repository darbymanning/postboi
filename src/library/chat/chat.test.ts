import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import MockChat from "./mock.js"
import Slack from "./slack.js"
import Discord from "./discord.js"
import Teams from "./teams.js"
import Telegram from "./telegram.js"
import Bluesky from "./bluesky.js"
import { chat, platform_for_webhook, slack, discord, telegram, bluesky } from "./send.js"
import { configure, reset_config } from "../config.js"
import type { Channel, PostboiError } from "../errors.js"

const respond = ({ ok = true, status = 200, body = "" as unknown } = {}) =>
	({
		ok,
		status,
		headers: new Headers(),
		text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
	}) as unknown as Response

const HOOK = "https://hooks.example.test/T000/B000/xxx"

beforeEach(() => {
	reset_config()
	vi.unstubAllGlobals()
	delete process.env.NODE_ENV
	delete process.env.POSTBOI_CHAT_PROVIDER
	delete process.env.POSTBOI_CHAT_TO
})
afterEach(() => {
	reset_config()
	delete process.env.SLACK_WEBHOOK_URL
	delete process.env.BLUESKY_HANDLE
	delete process.env.BLUESKY_APP_PASSWORD
})

describe("prepare", () => {
	it("falls back to the configured destination", async () => {
		const c = new MockChat({ default: { to: HOOK } })
		await c.send({ message: "hi" })
		expect(c.last).toMatchObject({ to: HOOK, message: "hi" })
	})

	it("lets a per-message destination win", async () => {
		const c = new MockChat({ default: { to: HOOK } })
		await c.send({ to: "https://other.test/hook", message: "hi" })
		expect(c.last?.to).toBe("https://other.test/hook")
	})

	it("rejects an empty message, tagged with the chat channel", async () => {
		const c = new MockChat({ default: { to: HOOK } })
		const error = (await c.send({ message: "  " }).catch((e) => e)) as PostboiError
		expect(error.code).toBe("empty_message")
		expect(error.channel).toBe<Channel>("chat")
	})

	it("rejects when there is nowhere to post", async () => {
		class NoDefault extends MockChat {
			constructor() {
				super()
				this.defaults = {}
			}
		}
		await expect(new NoDefault().send({ message: "hi" })).rejects.toMatchObject({
			code: "no_destination",
		})
	})
})

describe("slack", () => {
	it("posts text to the webhook URL", async () => {
		const fetch = vi.fn().mockResolvedValue(respond({ body: "ok" }))
		vi.stubGlobal("fetch", fetch)
		const c = new Slack({ webhook_url: HOOK })
		await c.send({ message: "Deploy finished" })

		const [url, init] = fetch.mock.calls[0]
		expect(url).toBe(HOOK)
		expect(JSON.parse(init.body as string)).toEqual({ text: "Deploy finished" })
	})

	it("renders a title as slack mrkdwn bold", async () => {
		const fetch = vi.fn().mockResolvedValue(respond({ body: "ok" }))
		vi.stubGlobal("fetch", fetch)
		await new Slack({ webhook_url: HOOK }).send({ title: "Deploy", message: "done" })
		expect(JSON.parse(fetch.mock.calls[0][1].body as string).text).toBe("*Deploy*\ndone")
	})

	it("surfaces the plain-text failure reason slack returns", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(respond({ ok: false, status: 404, body: "no_service" }))
		)
		await expect(new Slack({ webhook_url: HOOK }).send({ message: "hi" })).rejects.toMatchObject({
			provider: "slack",
			channel: "chat",
			code: "no_service",
		})
	})
})

describe("discord", () => {
	it("posts content, and tolerates the empty 204 body", async () => {
		const fetch = vi.fn().mockResolvedValue(respond({ status: 204 }))
		vi.stubGlobal("fetch", fetch)
		const result = await new Discord({ webhook_url: HOOK }).send({ message: "hi" })
		expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toEqual({ content: "hi" })
		expect(result).toEqual({ ok: true })
	})

	it("truncates at discord's 2000-character limit rather than being rejected", async () => {
		const fetch = vi.fn().mockResolvedValue(respond({ status: 204 }))
		vi.stubGlobal("fetch", fetch)
		await new Discord({ webhook_url: HOOK }).send({ message: "a".repeat(5000) })
		const content = JSON.parse(fetch.mock.calls[0][1].body as string).content
		expect(content).toHaveLength(2000)
		expect(content.endsWith("…")).toBe(true)
	})
})

describe("teams", () => {
	// The format matters: Office 365 connectors were disabled in May 2026, so this has to
	// be a Workflows-shaped Adaptive Card, not a MessageCard.
	it("posts an adaptive card, not a legacy MessageCard", async () => {
		const fetch = vi.fn().mockResolvedValue(respond({ status: 202 }))
		vi.stubGlobal("fetch", fetch)
		await new Teams({ webhook_url: HOOK }).send({ title: "Deploy", message: "done" })

		const body = JSON.parse(fetch.mock.calls[0][1].body as string)
		expect(body.type).toBe("message")
		expect(body.attachments[0].contentType).toBe("application/vnd.microsoft.card.adaptive")
		expect(body.attachments[0].content.type).toBe("AdaptiveCard")
		expect(body).not.toHaveProperty("@type")
		const blocks = body.attachments[0].content.body
		expect(blocks[0]).toMatchObject({ text: "Deploy", weight: "Bolder" })
		expect(blocks[1]).toMatchObject({ text: "done" })
	})
})

describe("telegram", () => {
	it("posts chat_id and text to the bot endpoint", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValue(respond({ body: { ok: true, result: { message_id: 42 } } }))
		vi.stubGlobal("fetch", fetch)
		const result = await new Telegram({ bot_token: "123:ABC" }).send({
			to: "987654321",
			message: "hi",
		})

		expect(fetch.mock.calls[0][0]).toBe("https://api.telegram.org/bot123:ABC/sendMessage")
		expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toMatchObject({
			chat_id: "987654321",
			text: "hi",
		})
		expect(result).toEqual({ message_id: 42 })
	})

	// Telegram reports failures with ok:false and HTTP 200, so status alone would miss it.
	it("catches ok:false even on a 200", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					respond({ body: { ok: false, error_code: 400, description: "chat not found" } })
				)
		)
		await expect(
			new Telegram({ bot_token: "t" }).send({ to: "1", message: "hi" })
		).rejects.toMatchObject({ provider: "telegram", code: 400, message: "chat not found" })
	})
})

describe("bluesky", () => {
	const session = { did: "did:plc:abc", accessJwt: "jwt-1" }
	const created = { uri: "at://did:plc:abc/app.bsky.feed.post/xyz", cid: "bafy" }

	/** Answer createSession once, then createRecord for every later call. */
	const bsky_fetch = (record: unknown = created) =>
		vi
			.fn()
			.mockResolvedValueOnce(respond({ body: session }))
			.mockResolvedValue(respond({ body: record }))

	it("logs in once, then posts to its own repo", async () => {
		const fetch = bsky_fetch()
		vi.stubGlobal("fetch", fetch)
		const sky = new Bluesky({ identifier: "me.bsky.social", app_password: "pw" })

		expect(await sky.send({ message: "hi" })).toEqual(created)
		await sky.send({ message: "again" })

		expect(fetch.mock.calls[0][0]).toBe("https://bsky.social/xrpc/com.atproto.server.createSession")
		expect(fetch.mock.calls[1][0]).toBe("https://bsky.social/xrpc/com.atproto.repo.createRecord")
		// The session is cached: three calls, not four.
		expect(fetch.mock.calls).toHaveLength(3)
		expect(fetch.mock.calls[1][1].headers.Authorization).toBe("Bearer jwt-1")
		expect(JSON.parse(fetch.mock.calls[1][1].body as string)).toMatchObject({
			repo: "did:plc:abc",
			collection: "app.bsky.feed.post",
			record: { text: "hi" },
		})
	})

	it("puts a title on its own line, and links URLs by byte offset", async () => {
		const fetch = bsky_fetch()
		vi.stubGlobal("fetch", fetch)
		await new Bluesky({ identifier: "me", app_password: "pw" }).send({
			title: "Déployé",
			message: "see https://postboi.email.",
		})

		const record = JSON.parse(fetch.mock.calls[1][1].body as string).record
		expect(record.text).toBe("Déployé\n\nsee https://postboi.email.")
		// "Déployé\n\nsee " is 13 characters but 15 bytes — each é is two.
		expect(record.facets[0].index).toEqual({ byteStart: 15, byteEnd: 36 })
		// The full stop is sentence, not URL.
		expect(record.facets[0].features[0].uri).toBe("https://postboi.email")
	})

	it("rejects a post over 300 graphemes before the server does", async () => {
		vi.stubGlobal("fetch", bsky_fetch())
		await expect(
			new Bluesky({ identifier: "me", app_password: "pw" }).send({ message: "a".repeat(301) })
		).rejects.toMatchObject({ code: "too_long", channel: "chat" as Channel })
	})

	it("re-authenticates once when the cached session has expired", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(respond({ body: session }))
			.mockResolvedValueOnce(
				respond({
					ok: false,
					status: 400,
					body: { error: "ExpiredToken", message: "Token expired" },
				})
			)
			.mockResolvedValueOnce(respond({ body: { ...session, accessJwt: "jwt-2" } }))
			.mockResolvedValue(respond({ body: created }))
		vi.stubGlobal("fetch", fetch)

		expect(
			await new Bluesky({ identifier: "me", app_password: "pw" }).send({ message: "hi" })
		).toEqual(created)
		expect(fetch.mock.calls[3][1].headers.Authorization).toBe("Bearer jwt-2")
	})

	it("does not cache a failed login", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				respond({ ok: false, status: 401, body: { error: "AuthenticationRequired" } })
			)
			.mockResolvedValueOnce(respond({ body: session }))
			.mockResolvedValue(respond({ body: created }))
		vi.stubGlobal("fetch", fetch)
		const sky = new Bluesky({ identifier: "me", app_password: "pw" })

		await expect(sky.send({ message: "hi" })).rejects.toMatchObject({
			provider: "bluesky",
			code: "AuthenticationRequired",
		})
		expect(await sky.send({ message: "hi" })).toEqual(created)
	})
})

describe("zero-config chat()", () => {
	it("resolves the configured provider and posts", async () => {
		process.env.SLACK_WEBHOOK_URL = HOOK
		configure({ chat: { provider: "slack" } })
		const fetch = vi.fn().mockResolvedValue(respond({ body: "ok" }))
		vi.stubGlobal("fetch", fetch)

		await chat({ message: "hi" })
		expect(fetch.mock.calls[0][0]).toBe(HOOK)
	})

	it("throws outside development when nothing is configured", async () => {
		await expect(chat({ message: "hi" })).rejects.toMatchObject({ code: "no_chat_provider" })
	})

	// Deliberately unlike SMS: posting to your own Slack in dev is the point, costs nothing
	// and can be deleted, so there's no interception to step around.
	it("does not intercept in development", async () => {
		process.env.NODE_ENV = "development"
		process.env.SLACK_WEBHOOK_URL = HOOK
		configure({ chat: { provider: "slack" } })
		const fetch = vi.fn().mockResolvedValue(respond({ body: "ok" }))
		vi.stubGlobal("fetch", fetch)

		await chat({ message: "hi" })
		expect(fetch).toHaveBeenCalledOnce()
	})
})

describe("per-platform functions", () => {
	afterEach(() => {
		delete process.env.DISCORD_WEBHOOK_URL
		delete process.env.TELEGRAM_BOT_TOKEN
	})

	it("slack() reads its own env credential, no provider selection involved", async () => {
		process.env.SLACK_WEBHOOK_URL = HOOK
		const fetch = vi.fn().mockResolvedValue(respond({ body: "ok" }))
		vi.stubGlobal("fetch", fetch)

		await slack({ message: "Deploy finished" })
		expect(fetch.mock.calls[0][0]).toBe(HOOK)
	})

	it("two platforms post side by side from one app", async () => {
		process.env.SLACK_WEBHOOK_URL = HOOK
		process.env.DISCORD_WEBHOOK_URL = "https://discord.example.test/api/webhooks/1/x"
		const fetch = vi.fn().mockResolvedValue(respond({ status: 204 }))
		vi.stubGlobal("fetch", fetch)

		await slack({ message: "to slack" })
		await discord({ message: "to discord" })
		expect(fetch.mock.calls[0][0]).toBe(HOOK)
		expect(fetch.mock.calls[1][0]).toContain("discord.example.test")
	})

	it("telegram() takes a chat id per send, with the token from env", async () => {
		process.env.TELEGRAM_BOT_TOKEN = "123:ABC"
		const fetch = vi
			.fn()
			.mockResolvedValue(respond({ body: { ok: true, result: { message_id: 7 } } }))
		vi.stubGlobal("fetch", fetch)

		await telegram({ to: "987654321", message: "Deploy finished" })
		expect(fetch.mock.calls[0][0]).toContain("api.telegram.org/bot123:ABC")
		expect(JSON.parse(fetch.mock.calls[0][1].body as string).chat_id).toBe("987654321")
	})

	it("bluesky() reads the handle and app password from env", async () => {
		process.env.BLUESKY_HANDLE = "me.bsky.social"
		process.env.BLUESKY_APP_PASSWORD = "pw"
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(respond({ body: { did: "did:plc:abc", accessJwt: "jwt" } }))
			.mockResolvedValue(respond({ body: { uri: "at://x", cid: "y" } }))
		vi.stubGlobal("fetch", fetch)

		await bluesky({ message: "Deploy finished" })
		expect(fetch.mock.calls[1][0]).toBe("https://bsky.social/xrpc/com.atproto.repo.createRecord")
		expect(JSON.parse(fetch.mock.calls[1][1].body as string).record.text).toBe("Deploy finished")
	})

	it("names the missing env var outside development", async () => {
		await expect(slack({ message: "hi" })).rejects.toMatchObject({ code: "missing_env" })
		await expect(slack({ message: "hi" })).rejects.toThrow(/SLACK_WEBHOOK_URL/)
	})

	it("falls back to the logging mock in development", async () => {
		process.env.NODE_ENV = "development"
		const fetch = vi.fn()
		vi.stubGlobal("fetch", fetch)
		const log = vi.spyOn(console, "log").mockImplementation(() => {})
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

		await slack({ message: "hi" })
		expect(fetch).not.toHaveBeenCalled()
		log.mockRestore()
		warn.mockRestore()
	})
})

describe("teams legacy connector URLs", () => {
	it("rejects an Office 365 connector URL instead of letting it fail silently", async () => {
		vi.stubGlobal("fetch", vi.fn())
		const legacy = new Teams({ webhook_url: "https://outlook.office.com/webhook/abc/def" })
		await expect(legacy.send({ message: "hi" })).rejects.toMatchObject({
			code: "legacy_webhook",
		})

		const tenant = new Teams({
			webhook_url: "https://contoso.webhook.office.com/webhookb2/xyz",
		})
		await expect(tenant.send({ message: "hi" })).rejects.toMatchObject({
			code: "legacy_webhook",
		})

		// The other common legacy host shape — office365.com path-style URLs.
		const office365 = new Teams({
			webhook_url: "https://outlook.office365.com/webhook/abc/IncomingWebhook/def",
		})
		await expect(office365.send({ message: "hi" })).rejects.toMatchObject({
			code: "legacy_webhook",
		})
	})

	it("accepts a Workflows URL", async () => {
		const fetch = vi.fn().mockResolvedValue(respond({ status: 202 }))
		vi.stubGlobal("fetch", fetch)
		const flow = new Teams({
			webhook_url: "https://prod-01.westeurope.logic.azure.com:443/workflows/x/triggers/y",
		})
		await flow.send({ message: "hi" })
		expect(fetch.mock.calls[0][0]).toContain("logic.azure.com")
	})
})

describe("platform_for_webhook", () => {
	it("recognises the vendor-branded webhook hosts and nothing else", () => {
		expect(platform_for_webhook("https://hooks.slack.com/services/T/B/x")).toBe("slack")
		expect(platform_for_webhook("https://discord.com/api/webhooks/1/t")).toBe("discord")
		expect(platform_for_webhook("https://discordapp.com/api/webhooks/1/t")).toBe("discord")
		expect(platform_for_webhook("https://canary.discord.com/api/webhooks/1/t")).toBe("discord")
		expect(platform_for_webhook("https://hooks.example.test/T/B/x")).toBeUndefined()
		expect(platform_for_webhook("987654321")).toBeUndefined()
	})
})
