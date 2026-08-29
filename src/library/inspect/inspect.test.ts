import { describe, it, expect } from "vitest"
import { analyze, check_links, GMAIL_CLIP_BYTES } from "./index.js"

const finding = (report: ReturnType<typeof analyze>, id: string, feature?: string) =>
	report.findings.find((f) => f.id === id && (feature === undefined || f.feature === feature))

const CLEAN = `<!doctype html>
<html lang="en">
<body>
	<table width="600"><tr><td>
		<img src="https://example.com/logo.png" alt="Example" width="120" height="40">
		<p>Hello.</p>
		<a href="https://example.com/">Read more</a>
	</td></tr></table>
</body>
</html>`

describe("analyze", () => {
	it("passes a clean, boring email", () => {
		const report = analyze({
			html: CLEAN,
			text: "Hello.\nRead more: https://example.com/",
			subject: "Hello",
		})
		expect(report.findings).toEqual([])
		expect(report.status).toBe("pass")
		expect(report.size.gmail_clip).toBe(false)
	})

	it("collects the link and image inventory", () => {
		const report = analyze({ html: CLEAN })
		expect(report.links).toEqual([
			{ url: "https://example.com/", text: "Read more", scheme: "https" },
		])
		expect(report.images).toEqual([
			{ src: "https://example.com/logo.png", alt: "Example", width: "120", height: "40" },
		])
	})

	it("warns when Gmail will clip", () => {
		const padding = `<p>${"a".repeat(1000)}</p>`
		const html = `<html lang="en"><body>${padding.repeat(110)}</body></html>`
		const report = analyze({ html, text: "hi", subject: "hi" })
		expect(report.size.html_bytes).toBeGreaterThan(GMAIL_CLIP_BYTES)
		expect(report.size.gmail_clip).toBe(true)
		expect(finding(report, "gmail_clip")?.severity).toBe("warning")
	})

	it("warns about a missing plain-text alternative", () => {
		expect(finding(analyze({ html: CLEAN }), "missing_plain_text")?.severity).toBe("warning")
		expect(finding(analyze({ html: CLEAN, text: "Hello." }), "missing_plain_text")).toBeUndefined()
	})

	it("only nags about headers when headers were provided", () => {
		expect(finding(analyze({ html: CLEAN }), "missing_list_unsubscribe")).toBeUndefined()
		const bare = analyze({ html: CLEAN, headers: { from: "a@example.com" } })
		expect(finding(bare, "missing_list_unsubscribe")?.severity).toBe("info")
		const one_click = analyze({
			html: CLEAN,
			headers: { "list-unsubscribe": "<https://example.com/u>" },
		})
		expect(finding(one_click, "missing_list_unsubscribe")).toBeUndefined()
		expect(finding(one_click, "missing_one_click_unsubscribe")?.severity).toBe("info")
		const both = analyze({
			html: CLEAN,
			headers: {
				"list-unsubscribe": "<https://example.com/u>",
				"list-unsubscribe-post": "List-Unsubscribe=One-Click",
			},
		})
		expect(finding(both, "missing_one_click_unsubscribe")).toBeUndefined()
	})

	it("counts images without alt text, letting alt='' opt out", () => {
		const report = analyze({
			html: `<html lang="en"><body><img src="a.png" width=1 height=1><img src="b.png" alt="" width=1 height=1><img src="c.png" width=1 height=1></body></html>`,
		})
		expect(finding(report, "images_missing_alt")?.occurrences).toBe(2)
	})

	it("flags http links and dead links", () => {
		const report = analyze({
			html: `<html lang="en"><body><a href="http://example.com/">a</a><a href="#">b</a><a>c</a></body></html>`,
		})
		expect(finding(report, "insecure_links")?.occurrences).toBe(1)
		expect(finding(report, "empty_links")?.occurrences).toBe(2)
		expect(report.links.map(({ scheme }) => scheme)).toEqual(["http", "other"])
	})

	it("reads subject presence and length", () => {
		expect(
			finding(analyze({ html: CLEAN, text: "x", subject: "" }), "subject_missing")
		).toBeDefined()
		expect(
			finding(analyze({ html: CLEAN, text: "x", subject: "y".repeat(90) }), "subject_length")
		).toBeDefined()
		expect(finding(analyze({ html: CLEAN, text: "x" }), "subject_missing")).toBeUndefined()
	})

	it("maps flexbox in a style block onto the client matrix", () => {
		const report = analyze({
			html: `<html lang="en"><head><style>.row { display: flex }</style></head><body></body></html>`,
			text: "x",
			subject: "x",
		})
		const flex = finding(report, "compat", "css-display-flex")
		expect(flex?.severity).toBe("warning")
		expect(
			flex?.clients?.some(
				({ client, support }) => client === "outlook-windows" && support === "none"
			)
		).toBe(true)
		expect(flex?.url).toContain("caniemail.com")
	})

	it("finds features in inline styles and attributes too", () => {
		const report = analyze({
			html: `<html lang="en"><body><div style="max-width: 600px">x</div><img src="a.webp" alt="" width=1 height=1></body></html>`,
			text: "x",
			subject: "x",
		})
		expect(finding(report, "compat", "css-max-width")).toBeDefined()
		expect(finding(report, "compat", "image-webp")).toBeDefined()
	})

	it("does not hallucinate features that are not there", () => {
		const report = analyze({ html: CLEAN, text: "x", subject: "x" })
		expect(report.findings.filter(({ id }) => id === "compat")).toEqual([])
	})

	it("sorts findings worst-first and rolls the status up", () => {
		const report = analyze({
			html: `<html lang="en"><body><img src="a.png" width=1 height=1><style>@media (prefers-color-scheme: dark) { body { background: #000 } }</style></body></html>`,
		})
		expect(report.status).toBe("warning")
		const ranks = report.findings.map(
			({ severity }) => ({ error: 0, warning: 1, info: 2 })[severity]
		)
		expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
	})

	it("matches header names case-insensitively", () => {
		const report = analyze({
			html: CLEAN,
			headers: {
				"List-Unsubscribe": "<https://example.com/u>",
				"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
			},
		})
		expect(finding(report, "missing_list_unsubscribe")).toBeUndefined()
		expect(finding(report, "missing_one_click_unsubscribe")).toBeUndefined()
	})

	it("does not call an anchor target a dead link", () => {
		const report = analyze({
			html: `<html lang="en"><body><a name="top"></a><a id="features"></a><a>really dead</a></body></html>`,
		})
		expect(finding(report, "empty_links")?.occurrences).toBe(1)
	})

	it("wants both dimensions, from attributes or styles, before an image counts as sized", () => {
		const html = (img: string) => `<html lang="en"><body>${img}</body></html>`
		const undimensioned = (img: string) =>
			finding(analyze({ html: html(img) }), "image_no_dimensions")?.occurrences
		expect(undimensioned(`<img src="a.png" alt="" style="width:100px">`)).toBe(1)
		expect(undimensioned(`<img src="a.png" alt="" width="100">`)).toBe(1)
		expect(
			undimensioned(`<img src="a.png" alt="" width="100" style="height:40px">`)
		).toBeUndefined()
		expect(
			undimensioned(`<img src="a.png" alt="" style="width:100px;height:40px">`)
		).toBeUndefined()
	})

	it("warns when the whole message is heavier than servers accept", () => {
		const report = analyze({ html: CLEAN, text: "x", subject: "x", size_bytes: 30 * 1024 * 1024 })
		expect(finding(report, "message_size")?.severity).toBe("warning")
		expect(report.size.message_bytes).toBe(30 * 1024 * 1024)
		expect(
			finding(analyze({ html: CLEAN, text: "x", subject: "x", size_bytes: 1024 }), "message_size")
		).toBeUndefined()
	})

	it("handles an empty input without complaint", () => {
		const report = analyze({})
		expect(report.status).toBe("pass") // nothing provided, nothing to judge
		expect(report.links).toEqual([])
		expect(report.size.html_bytes).toBe(0)
	})
})

describe("check_links", () => {
	it("fetches http(s) links only, deduplicated, and reports outcomes", async () => {
		const seen: Array<string> = []
		const stub = (async (url: string | URL | Request) => {
			seen.push(String(url))
			if (String(url).includes("missing")) return new Response("", { status: 404 })
			return new Response("ok")
		}) as typeof fetch

		const results = await check_links(
			[
				"https://example.com/",
				"https://example.com/",
				"https://example.com/missing",
				"mailto:a@b.c",
			],
			{ fetch: stub }
		)
		expect(seen).toHaveLength(2)
		expect(results).toEqual([
			{ url: "https://example.com/", ok: true, status: 200 },
			{ url: "https://example.com/missing", ok: false, status: 404 },
		])
	})

	it("turns a network failure into an error entry", async () => {
		const stub = (async () => {
			throw new Error("boom")
		}) as unknown as typeof fetch
		const results = await check_links(["https://example.com/"], { fetch: stub })
		expect(results[0]).toEqual({ url: "https://example.com/", ok: false, error: "boom" })
	})
})
