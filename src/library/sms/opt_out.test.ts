import { describe, it, expect } from "vitest"
import { is_opt_out, OPT_OUT_KEYWORDS } from "./opt_out.js"

describe("is_opt_out", () => {
	it("matches every keyword, in any case, with trailing punctuation", () => {
		for (const keyword of OPT_OUT_KEYWORDS) {
			expect(is_opt_out(keyword), keyword).toBe(true)
			expect(is_opt_out(keyword.toLowerCase()), keyword).toBe(true)
			expect(is_opt_out(`  ${keyword}. `), keyword).toBe(true)
		}
		expect(is_opt_out("Stop!")).toBe(true)
		expect(is_opt_out("ARRÊT")).toBe(true)
	})

	it("is a whole-message test — a sentence containing the word is not an opt-out", () => {
		expect(is_opt_out("Please stop texting me")).toBe(false)
		expect(is_opt_out("STOP STOP")).toBe(false)
		expect(is_opt_out("unsubscribed")).toBe(false)
		expect(is_opt_out("")).toBe(false)
		expect(is_opt_out(undefined)).toBe(false)
	})
})
