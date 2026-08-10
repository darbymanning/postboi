import { describe, it, expect, vi } from "vitest"
import { fetch_meta_templates, fetch_twilio_templates, placeholders } from "./whatsapp_templates.js"

const json = (body: unknown) =>
	({ ok: true, status: 200, json: async () => body }) as unknown as Response

describe("placeholders", () => {
	it("reads named and positional forms, in order and deduplicated", () => {
		expect(placeholders("Hi {{name}}, your {{item}} shipped. Thanks {{name}}!")).toEqual([
			"name",
			"item",
		])
		expect(placeholders("Code {{1}} expires in {{ 2 }} minutes")).toEqual(["1", "2"])
		expect(placeholders("No variables here")).toEqual([])
	})
})

describe("meta templates", () => {
	it("follows paging, drops rejected ones, and reads each body's placeholders", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				json({
					data: [
						{
							name: "order_shipped",
							status: "APPROVED",
							components: [
								{ type: "HEADER", text: "Order {{1}}" },
								{ type: "BODY", text: "Hi {{name}}, tracking {{tracking}}" },
							],
						},
						// the same template in a second language — one entry, not two
						{
							name: "order_shipped",
							status: "APPROVED",
							components: [{ type: "BODY", text: "Bonjour {{name}}, suivi {{tracking}}" }],
						},
						{ name: "spammy", status: "REJECTED", components: [] },
					],
					paging: { next: "https://graph.facebook.com/next" },
				})
			)
			.mockResolvedValueOnce(
				json({ data: [{ name: "re_engage", status: "PENDING", components: [] }] })
			)

		// pending is kept for the same reason a pending domain is: approval is in flight.
		// Only the BODY is read — the header placeholder is its own send option.
		expect(await fetch_meta_templates("WABA1", "tok", "v23.0", fetch)).toEqual({
			order_shipped: ["name", "tracking"],
			re_engage: [],
		})
		expect(fetch.mock.calls[0][0]).toContain("/WABA1/message_templates")
		expect(fetch.mock.calls[0][0]).toContain("components")
		expect(fetch.mock.calls[1][0]).toBe("https://graph.facebook.com/next")
	})

	it("is empty rather than throwing when the API refuses", async () => {
		const fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response)
		expect(await fetch_meta_templates("WABA1", "bad", "v23.0", fetch)).toEqual({})
	})
})

describe("twilio templates", () => {
	it("maps friendly names to SIDs and variables across pages, skipping unnamed content", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				json({
					contents: [
						{ sid: "HX1", friendly_name: "order_shipped", variables: { 1: "Ada", 2: "AB123" } },
						{ sid: "HX2", variables: {} },
					],
					meta: { next_page_url: "https://content.twilio.com/next" },
				})
			)
			.mockResolvedValueOnce(json({ contents: [{ sid: "HX3", friendly_name: "re_engage" }] }))

		expect(await fetch_twilio_templates("AC1", "tok", fetch)).toEqual({
			order_shipped: { sid: "HX1", variables: ["1", "2"] },
			// no `variables` on the payload at all — an empty list, which the typegen leaves
			// unnarrowed rather than typing as "takes nothing"
			re_engage: { sid: "HX3", variables: [] },
		})
		const init = fetch.mock.calls[0][1] as RequestInit
		expect((init.headers as Record<string, string>).Authorization).toBe(
			`Basic ${Buffer.from("AC1:tok").toString("base64")}`
		)
	})

	it("is empty rather than throwing when the network is down", async () => {
		const fetch = vi.fn().mockRejectedValue(new Error("offline"))
		expect(await fetch_twilio_templates("AC1", "tok", fetch)).toEqual({})
	})
})
