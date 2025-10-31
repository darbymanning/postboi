import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Zepto } from "zeptomail"
import Postboi from "$library/zepto.js"
// import actions after mocks are set up

// create a shared mock function
const zepto = {
	send: vi.fn(),
}

vi.mock("zeptomail", async () => {
	const actual = await vi.importActual<typeof import("zeptomail")>("zeptomail")

	return {
		...actual,
		SendMailClient: class {
			sendMail = zepto.send
		},
	}
})

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
			const response = { data: { message: "success" } }
			zepto.send.mockResolvedValue(response)

			const result = await mail.send({
				to: "recipient@test.com",
				from: "sender@test.com",
				subject: "Test Subject",
				body: "Test body",
			})

			expect(zepto.send).toHaveBeenCalledOnce()
			expect(zepto.send).toHaveBeenCalledWith({
				to: [{ email_address: { address: "recipient@test.com" } }],
				from: { address: "sender@test.com" },
				subject: "Test Subject",
				htmlbody: "Test body",
				reply_to: undefined,
				bcc: undefined,
				cc: undefined,
				attachments: undefined,
			})
			expect(result).toEqual(response)
		})

		it("should use defaults when to/from are omitted", async () => {
			zepto.send.mockResolvedValue({ data: {} })

			await mail.send({
				subject: "Test",
				body: "Body",
			})

			expect(zepto.send).toHaveBeenCalledWith(
				expect.objectContaining({
					to: [{ email_address: { address: "default-to@test.com" } }],
					from: { address: "default@test.com" },
				})
			)
		})

		it("should handle FormData body", async () => {
			zepto.send.mockResolvedValue({ data: {} })

			const form_data = new FormData()
			form_data.append("name", "Darbo")
			form_data.append("email", "darbo@test.com")
			form_data.append("_subject", "Test Subject")
			form_data.append("_to", "custom@test.com")

			await mail.send({
				body: form_data,
			})

			expect(zepto.send).toHaveBeenCalled()
			const args = zepto.send.mock.calls[0][0] as Zepto.SendMailParams
			expect(args.to).toEqual([{ email_address: { address: "custom@test.com" } }])
			expect(args.subject).toBe("Test Subject")
			expect(args.htmlbody).toContain("Darbo")
			expect(args.htmlbody).toContain("darbo@test.com")
		})

		it("should handle multiple recipients", async () => {
			zepto.send.mockResolvedValue({ data: {} })

			await mail.send({
				to: ["one@test.com", "two@test.com"],
				from: "sender@test.com",
				subject: "Test",
				body: "Body",
			})

			expect(zepto.send).toHaveBeenCalledWith(
				expect.objectContaining({
					to: [
						{ email_address: { address: "one@test.com" } },
						{ email_address: { address: "two@test.com" } },
					],
				})
			)
		})

		it("should handle cc and bcc", async () => {
			zepto.send.mockResolvedValue({ data: {} })

			await mail.send({
				to: "to@test.com",
				from: "from@test.com",
				cc: ["cc1@test.com", "cc2@test.com"],
				bcc: "bcc@test.com",
				subject: "Test",
				body: "Body",
			})

			expect(zepto.send).toHaveBeenCalledWith(
				expect.objectContaining({
					cc: [
						{ email_address: { address: "cc1@test.com" } },
						{ email_address: { address: "cc2@test.com" } },
					],
					bcc: [{ email_address: { address: "bcc@test.com" } }],
				})
			)
		})

		it("should handle reply_to", async () => {
			zepto.send.mockResolvedValue({ data: {} })

			await mail.send({
				to: "to@test.com",
				from: "from@test.com",
				reply_to: "reply@test.com",
				subject: "Test",
				body: "Body",
			})

			expect(zepto.send).toHaveBeenCalledWith(
				expect.objectContaining({
					reply_to: [{ address: "reply@test.com" }],
				})
			)
		})

		it("should handle attachments", async () => {
			zepto.send.mockResolvedValue({ data: {} })

			const attachments = new File(["content"], "test.txt", { type: "text/plain" })
			await mail.send({
				to: "to@test.com",
				from: "from@test.com",
				subject: "Test",
				body: "Body",
				attachments,
			})

			expect(zepto.send).toHaveBeenCalled()
			const args = zepto.send.mock.calls[0][0] as Zepto.SendMailParams
			expect(args.attachments).toBeDefined()
			expect(args.attachments).toHaveLength(1)
			expect(args.attachments![0]).toHaveProperty("name", "test.txt")
			expect(args.attachments![0]).toHaveProperty("content")
		})

		it("should use default subject when not provided", async () => {
			zepto.send.mockResolvedValue({ data: {} })

			await mail.send({
				to: "to@test.com",
				from: "from@test.com",
				body: "Body",
			})

			expect(zepto.send).toHaveBeenCalledWith(
				expect.objectContaining({
					subject: "Mail sent from website",
				})
			)
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
			zepto.send.mockResolvedValue({ data: { message: "success" } })

			const { actions } = await import("./+page.server.js")

			const form_data = new FormData()
			form_data.append("test", "value")

			const request = new Request("http://localhost", {
				method: "POST",
				body: form_data,
			})

			const result = await actions.default({ request })

			expect(result).toEqual({ success: true })
			expect(zepto.send).toHaveBeenCalledOnce()
		})

		it("should return error when zepto error occurs", async () => {
			zepto.send.mockRejectedValue({
				error: {
					code: "INVALID_EMAIL",
					message: "Invalid email address",
					request_id: "req-123",
					details: [],
				},
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
			zepto.send.mockRejectedValue(new Error("something went wrong"))

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
