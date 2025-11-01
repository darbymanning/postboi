import { describe, it, expect, vi, beforeEach } from "vitest"
import Postboi, { type SendParams } from "$library/zepto.js"

// mock fetch globally
const fetch = vi.fn()
global.fetch = fetch

// mock env vars
vi.mock("$env/static/private", () => ({
	ZEPTO_TOKEN: "test-token",
	EMAIL_FROM_ADDRESS: "from@test.com",
	EMAIL_TO_ADDRESS: "to@test.com",
}))

describe("zepto", () => {
	describe("Postboi class", () => {
		let mail: InstanceType<typeof Postboi>

		beforeEach(async () => {
			vi.clearAllMocks()
			fetch.mockClear()

			mail = new Postboi({
				token: "test-token",
				default_from: "default@test.com",
				default_to: "default-to@test.com",
			})
		})

		it("should create a Postboi instance with defaults", () => {
			expect(mail).toBeInstanceOf(Postboi)
		})

		it("should send email with string body", async () => {
			const response = { data: [{ message: "success" }] }
			fetch.mockResolvedValue({
				json: async () => response,
			})

			const result = await mail.send({
				to: "recipient@test.com",
				from: "sender@test.com",
				subject: "Test Subject",
				body: "Test body",
			})

			expect(fetch).toHaveBeenCalledOnce()
			expect(fetch).toHaveBeenCalledWith(
				"https://api.zeptomail.com/v1.1/email",
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						Authorization: "test-token",
						"Content-Type": "application/json",
					}),
					body: JSON.stringify({
						to: [{ email_address: { address: "recipient@test.com" } }],
						from: { address: "sender@test.com" },
						subject: "Test Subject",
						htmlbody: "Test body",
						reply_to: undefined,
						bcc: undefined,
						cc: undefined,
						attachments: undefined,
					}),
				})
			)
			expect(result).toEqual(response)
		})

		it("should use defaults when to/from are omitted", async () => {
			fetch.mockResolvedValue({
				json: async () => ({ data: [] }),
			})

			await mail.send({
				subject: "Test",
				body: "Body",
			})

			expect(fetch).toHaveBeenCalledOnce()
			const calls = fetch.mock.calls
			const body = JSON.parse(calls[0][1].body as string) as SendParams
			expect(body.to).toEqual([{ email_address: { address: "default-to@test.com" } }])
			expect(body.from).toEqual({ address: "default@test.com" })
		})

		it("should handle FormData body", async () => {
			fetch.mockResolvedValue({
				json: async () => ({ data: [] }),
			})

			const form_data = new FormData()
			form_data.append("name", "Darbo")
			form_data.append("email", "darbo@test.com")
			form_data.append("_subject", "Test Subject")
			form_data.append("_to", "custom@test.com")

			await mail.send({
				body: form_data,
			})

			expect(fetch).toHaveBeenCalled()
			const calls = fetch.mock.calls
			const args = JSON.parse(calls[0][1].body as string) as SendParams
			expect(args.to).toEqual([{ email_address: { address: "custom@test.com" } }])
			expect(args.subject).toBe("Test Subject")
			expect(args.htmlbody).toContain("Darbo")
			expect(args.htmlbody).toContain("darbo@test.com")
		})

		it("should handle multiple recipients", async () => {
			fetch.mockResolvedValue({
				json: async () => ({ data: [] }),
			})

			await mail.send({
				to: ["one@test.com", "two@test.com"],
				from: "sender@test.com",
				subject: "Test",
				body: "Body",
			})

			expect(fetch).toHaveBeenCalledOnce()
			const calls = fetch.mock.calls
			const args = JSON.parse(calls[0][1].body as string) as SendParams
			expect(args.to).toEqual([
				{ email_address: { address: "one@test.com" } },
				{ email_address: { address: "two@test.com" } },
			])
		})

		it("should handle cc and bcc", async () => {
			fetch.mockResolvedValue({
				json: async () => ({ data: [] }),
			})

			await mail.send({
				to: "to@test.com",
				from: "from@test.com",
				cc: ["cc1@test.com", "cc2@test.com"],
				bcc: "bcc@test.com",
				subject: "Test",
				body: "Body",
			})

			expect(fetch).toHaveBeenCalledOnce()
			const calls = fetch.mock.calls
			const args = JSON.parse(calls[0][1].body as string) as SendParams
			expect(args.cc).toEqual([
				{ email_address: { address: "cc1@test.com" } },
				{ email_address: { address: "cc2@test.com" } },
			])
			expect(args.bcc).toEqual([{ email_address: { address: "bcc@test.com" } }])
		})

		it("should handle reply_to", async () => {
			fetch.mockResolvedValue({
				json: async () => ({ data: [] }),
			})

			await mail.send({
				to: "to@test.com",
				from: "from@test.com",
				reply_to: "reply@test.com",
				subject: "Test",
				body: "Body",
			})

			expect(fetch).toHaveBeenCalledOnce()
			const calls = fetch.mock.calls
			const args = JSON.parse(calls[0][1].body as string) as SendParams
			expect(args.reply_to).toEqual([{ address: "reply@test.com" }])
		})

		it("should handle attachments", async () => {
			fetch.mockResolvedValue({
				json: async () => ({ data: [] }),
			})

			const attachments = new File(["content"], "test.txt", { type: "text/plain" })
			await mail.send({
				to: "to@test.com",
				from: "from@test.com",
				subject: "Test",
				body: "Body",
				attachments,
			})

			expect(fetch).toHaveBeenCalled()
			const calls = fetch.mock.calls
			const args = JSON.parse(calls[0][1].body as string) as SendParams
			expect(args.attachments).toBeDefined()
			expect(args.attachments).toHaveLength(1)
			expect(args.attachments![0]).toHaveProperty("name", "test.txt")
			expect(args.attachments![0]).toHaveProperty("content")
		})

		it("should use default subject when not provided", async () => {
			fetch.mockResolvedValue({
				json: async () => ({ data: [] }),
			})

			await mail.send({
				to: "to@test.com",
				from: "from@test.com",
				body: "Body",
			})

			expect(fetch).toHaveBeenCalledOnce()
			const calls = fetch.mock.calls
			const args = JSON.parse(calls[0][1].body as string) as SendParams
			expect(args.subject).toBe("Mail sent from website")
		})

		describe("is_error", () => {
			it("should identify zepto errors correctly", () => {
				const zepto_error = {
					error: {
						code: "INVALID_EMAIL",
						message: "Invalid email address",
						request_id: "req-123",
						details: [],
					},
				}

				expect(mail.is_error(zepto_error)).toBe(true)
			})

			it("should return false for non-zepto errors", () => {
				expect(mail.is_error(new Error("not a zepto error"))).toBe(false)
				expect(mail.is_error({ message: "just a regular error" })).toBe(false)
				expect(mail.is_error(null)).toBe(false)
				expect(mail.is_error("string error")).toBe(false)
			})

			it("should return false for incomplete error shape", () => {
				expect(mail.is_error({ error: { code: "TEST" } })).toBe(false)
				expect(mail.is_error({ error: { message: "test" } })).toBe(false)
			})
		})
	})

	describe("server action", () => {
		beforeEach(async () => {
			vi.clearAllMocks()
			vi.resetModules()
		})

		it("should return success when email is sent", async () => {
			fetch.mockResolvedValue({
				json: async () => ({ data: [{ message: "success" }] }),
			})

			const { actions } = await import("./+page.server.js")

			const form_data = new FormData()
			form_data.append("test", "value")

			const request = new Request("http://localhost", {
				method: "POST",
				body: form_data,
			})

			const result = await actions.default({ request })

			expect(result).toEqual({ success: true })
			expect(fetch).toHaveBeenCalledOnce()
		})

		it("should return error when zepto error occurs", async () => {
			fetch.mockResolvedValue({
				json: async () => ({
					error: {
						code: "INVALID_EMAIL",
						message: "Invalid email address",
						request_id: "req-123",
						details: [],
					},
				}),
			})

			const { actions } = await import("./+page.server.js")

			const form_data = new FormData()
			const request = new Request("http://localhost", {
				method: "POST",
				body: form_data,
			})

			const result = await actions.default({ request })

			expect(result).toHaveProperty("status", 400)

			if ("status" in result) expect(result.data).toEqual({ error: "Invalid email address" })
		})

		it("should return generic error for non-zepto errors", async () => {
			fetch.mockRejectedValue(new Error("something went wrong"))

			const { actions } = await import("./+page.server.js")

			const form_data = new FormData()
			const request = new Request("http://localhost", {
				method: "POST",
				body: form_data,
			})

			const result = await actions.default({ request })

			expect(result).toHaveProperty("status", 400)

			if ("status" in result) expect(result.data).toEqual({ error: "Error: something went wrong" })
		})
	})
})
