import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { configure, reset_config } from "../config.js"
import { sms } from "./send.js"

const ok = (json: unknown) => ({
	ok: true,
	status: 200,
	headers: new Headers(),
	text: async () => JSON.stringify(json),
})

beforeEach(() => {
	reset_config()
	vi.unstubAllGlobals()
	delete process.env.NODE_ENV
	delete process.env.POSTBOI_SMS_PROVIDER
	delete process.env.POSTBOI_SMS_DEV
	delete process.env.POSTBOI_SMS_COUNTRY
	delete process.env.POSTBOI_SMS_FROM
})
afterEach(() => {
	reset_config()
	delete process.env.SMSWORKS_API_KEY
	delete process.env.AWS_ACCESS_KEY_ID
	delete process.env.AWS_SECRET_ACCESS_KEY
	delete process.env.TWILIO_ACCOUNT_SID
	delete process.env.TWILIO_AUTH_TOKEN
})

describe("zero-config sms()", () => {
	// Guards the whole chain the CLI sets up: postboi.config → resolver → provider → request.
	it("drives a real send from exactly what `postboi init --sms` writes", async () => {
		process.env.SMSWORKS_API_KEY = "jwt-secret-token"
		configure({ sms: { provider: "smsworks", default: { country: "GB", from: "POSTBOI" } } })
		const fetch = vi.fn().mockResolvedValue(ok({ messageid: "m1", status: "sent" }))
		vi.stubGlobal("fetch", fetch)

		await sms({ to: "07788 223344", message: "Your code is 4291" })

		const [url, init] = fetch.mock.calls[0]
		expect(url).toBe("https://api.thesmsworks.co.uk/v1/message/send")
		expect(init.headers.Authorization).toBe("jwt-secret-token")
		expect(JSON.parse(init.body as string)).toMatchObject({
			sender: "POSTBOI",
			destination: "447788223344",
			content: "Your code is 4291",
		})
	})

	it("reads defaults from the environment, which beats the config file", async () => {
		process.env.SMSWORKS_API_KEY = "k"
		process.env.POSTBOI_SMS_FROM = "FROMENV"
		process.env.POSTBOI_SMS_COUNTRY = "GB"
		configure({ sms: { provider: "smsworks", default: { from: "FROMCONFIG" } } })
		const fetch = vi.fn().mockResolvedValue(ok({ messageid: "m1" }))
		vi.stubGlobal("fetch", fetch)

		await sms({ to: "07788223344", message: "hi" })
		expect(JSON.parse(fetch.mock.calls[0][1].body as string).sender).toBe("FROMENV")
	})

	it("throws outside development when nothing is configured", async () => {
		await expect(sms({ to: "+447788223344", message: "hi" })).rejects.toMatchObject({
			code: "no_sms_provider",
			channel: "sms",
		})
	})

	it("still throws when the environment happens to carry AWS credentials", async () => {
		// The 0.33.0 regression, end to end. SNS needs only these two (its region is
		// defaulted), so inference read someone else's S3 credentials as "SNS, then" and
		// left the process with them. fetch is stubbed to throw rather than left alone: a
		// regression here should fail this test, not quietly reach AWS from CI.
		process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE"
		process.env.AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
		vi.stubGlobal(
			"fetch",
			vi.fn(() => {
				throw new Error("a resolution failure must not send anything")
			})
		)

		await expect(sms({ to: "+447788223344", message: "hi" })).rejects.toMatchObject({
			code: "no_sms_provider",
			channel: "sms",
		})
	})

	it("won't send on Twilio credentials that were never meant for postboi", async () => {
		// TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are the Twilio SDK's zero-argument
		// defaults, so a project using Voice or Verify has them set already. Inferring
		// from them put a billable text on someone else's account — the same shape as the
		// SNS bug, on a vendor whose credentials span several products.
		process.env.TWILIO_ACCOUNT_SID = "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
		process.env.TWILIO_AUTH_TOKEN = "unrelated-to-postboi-sms"
		vi.stubGlobal(
			"fetch",
			vi.fn(() => {
				throw new Error("a resolution failure must not send anything")
			})
		)

		await expect(sms({ to: "+447788223344", message: "hi" })).rejects.toMatchObject({
			code: "no_sms_provider",
			channel: "sms",
		})
	})

	it("names an unknown provider rather than failing obscurely", async () => {
		process.env.POSTBOI_SMS_PROVIDER = "carrier-pigeon"
		await expect(sms({ to: "+447788223344", message: "hi" })).rejects.toMatchObject({
			code: "unknown_sms_provider",
		})
	})

	it("reports the missing credential by env var name", async () => {
		configure({ sms: { provider: "smsworks" } })
		await expect(sms({ to: "+447788223344", message: "hi" })).rejects.toMatchObject({
			code: "missing_env",
		})
		await expect(sms({ to: "+447788223344", message: "hi" })).rejects.toThrow(/SMSWORKS_API_KEY/)
	})
})

describe("development interception", () => {
	// The safety property: a configured, fully-credentialled provider must still not be
	// reached in development, because a stray text costs money and can't be recalled.
	it("outranks a credentialled provider and makes no request", async () => {
		process.env.NODE_ENV = "development"
		process.env.SMSWORKS_API_KEY = "k"
		configure({ sms: { provider: "smsworks", default: { from: "P", country: "GB" } } })
		const fetch = vi.fn()
		vi.stubGlobal("fetch", fetch)
		vi.spyOn(console, "log").mockImplementation(() => {})
		vi.spyOn(console, "warn").mockImplementation(() => {})

		await sms({ to: "07788223344", message: "hi" })
		expect(fetch).not.toHaveBeenCalled()
	})

	it("steps aside when POSTBOI_SMS_DEV=send is set", async () => {
		process.env.NODE_ENV = "development"
		process.env.POSTBOI_SMS_DEV = "send"
		process.env.SMSWORKS_API_KEY = "k"
		configure({ sms: { provider: "smsworks", default: { from: "P", country: "GB" } } })
		const fetch = vi.fn().mockResolvedValue(ok({ messageid: "m1" }))
		vi.stubGlobal("fetch", fetch)

		await sms({ to: "07788223344", message: "hi" })
		expect(fetch).toHaveBeenCalledOnce()
	})

	it("steps aside when dev.sms is false in config", async () => {
		process.env.NODE_ENV = "development"
		process.env.SMSWORKS_API_KEY = "k"
		configure({
			dev: { sms: false },
			sms: { provider: "smsworks", default: { from: "P", country: "GB" } },
		})
		const fetch = vi.fn().mockResolvedValue(ok({ messageid: "m1" }))
		vi.stubGlobal("fetch", fetch)

		await sms({ to: "07788223344", message: "hi" })
		expect(fetch).toHaveBeenCalledOnce()
	})
})
