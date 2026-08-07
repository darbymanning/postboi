import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import MockChat from "./mock.js"
import Slack from "./slack.js"
import Discord from "./discord.js"
import Teams from "./teams.js"
import Telegram from "./telegram.js"
import { chat } from "./send.js"
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
