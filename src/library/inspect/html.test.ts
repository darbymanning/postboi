import { describe, it, expect } from "vitest"
import { tokenize } from "./html.js"

describe("tokenize", () => {
	it("reports tags with lowercased names and attributes", () => {
		const { tags } = tokenize(
			`<TABLE Width="600" ALIGN=center><tr><td bgcolor='#fff'>hi</td></tr></TABLE>`
		)
		expect(tags[0]).toMatchObject({
			name: "table",
			closing: false,
			attrs: { width: "600", align: "center" },
		})
		expect(tags[2].attrs).toEqual({ bgcolor: "#fff" })
		expect(tags.at(-1)).toMatchObject({ name: "table", closing: true })
	})

	it("keeps bare attributes and survives self-closing slashes", () => {
		const { tags } = tokenize(`<img src="a.png" hidden /><br/>`)
		expect(tags[0].attrs).toEqual({ src: "a.png", hidden: "" })
		expect(tags[1].name).toBe("br")
	})

	it("does not end a tag at a > inside a quoted attribute", () => {
		const { tags } = tokenize(`<a href="https://example.com/?q=1>2" title='a>b'>x</a>`)
		expect(tags[0].attrs.href).toBe("https://example.com/?q=1>2")
		expect(tags[0].attrs.title).toBe("a>b")
	})

	it("captures style bodies instead of tokenizing them", () => {
		const { tags, styles } = tokenize(`<style>td::after { content: "</td>" }</style><p>hi</p>`)
		expect(styles).toEqual([`td::after { content: "</td>" }`])
		expect(tags.map(({ name }) => name)).toEqual(["style", "style", "p", "p"])
	})

	it("skips comments, conditional comments and doctypes", () => {
		const { tags } = tokenize(
			`<!doctype html><!--[if mso]><table><tr><td><![endif]--><div><!-- plain --></div>`
		)
		expect(tags.map(({ name }) => name)).toEqual(["div", "div"])
	})

	it("tokenizes downlevel-revealed conditional content", () => {
		const { tags } = tokenize(`<!--[if !mso]><!--><video src="a.mp4"></video><!--<![endif]-->`)
		expect(tags[0]).toMatchObject({ name: "video", attrs: { src: "a.mp4" } })
	})

	it("survives an unterminated style block", () => {
		const { styles } = tokenize(`<style>p { color: red }`)
		expect(styles).toEqual(["p { color: red }"])
	})
})
