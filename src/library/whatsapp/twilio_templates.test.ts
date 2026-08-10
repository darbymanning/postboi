/**
 * The generated name→SID map, in its own file because mocking `register.js` is a
 * module-level swap — everywhere else it's the shipped empty placeholder.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("../register.js", () => ({
	captcha_key: undefined,
	whatsapp_templates: { order_shipped: "HX9" },
}))

const { default: TwilioWhatsapp } = await import("./twilio.js")

const respond = () =>
	({
		ok: true,
		status: 200,
		url: "",
		headers: new Headers(),
		text: async () => JSON.stringify({ sid: "SM1", status: "queued" }),
	}) as unknown as Response

describe("twilio template names", () => {
	it("resolves a synced name to its Content SID, and passes anything else through", async () => {
		const fetch = vi.fn().mockResolvedValue(respond())
		vi.stubGlobal("fetch", fetch)
		const wa = new TwilioWhatsapp({
			account_sid: "AC1",
			auth_token: "t",
			default: { from: "+14155238886" },
		})

		await wa.send({ to: "+447788223344", template: "order_shipped" })
		expect(new URLSearchParams(fetch.mock.calls[0][1].body as string).get("ContentSid")).toBe("HX9")

		// A raw SID, or a template approved since the last sync, still reaches Twilio as-is.
		await wa.send({ to: "+447788223344", template: "HXraw" })
		expect(new URLSearchParams(fetch.mock.calls[1][1].body as string).get("ContentSid")).toBe(
			"HXraw"
		)

		// Own keys only — an inherited one would stringify a function into the request.
		await wa.send({ to: "+447788223344", template: "constructor" })
		expect(new URLSearchParams(fetch.mock.calls[2][1].body as string).get("ContentSid")).toBe(
			"constructor"
		)
	})
})
