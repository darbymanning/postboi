import { describe, it, expect } from "vitest"
import { capitalize, title, escape_html, html_to_text } from "$library/utils.js"

describe("capitalize", () => {
	it("capitalises the first letter and lower-cases the rest", () => {
		expect(capitalize("hELLO")).toBe("Hello")
		expect(capitalize("world")).toBe("World")
		expect(capitalize("ABC")).toBe("Abc")
	})

	it("handles single characters", () => {
		expect(capitalize("a")).toBe("A")
		expect(capitalize("Z")).toBe("Z")
	})

	it("returns an empty string for empty/nullish input", () => {
		expect(capitalize("")).toBe("")
		expect(capitalize(null)).toBe("")
		expect(capitalize(undefined)).toBe("")
	})
})

describe("title", () => {
	it("title-cases space separated words", () => {
		expect(title("hello world")).toBe("Hello World")
	})

	it("splits snake_case", () => {
		expect(title("first_name")).toBe("First Name")
		expect(title("va_va_boom")).toBe("Va Va Boom")
		expect(title("reply_to")).toBe("Reply To")
	})

	it("splits kebab-case", () => {
		expect(title("root-hook")).toBe("Root Hook")
	})

	it("splits dotted paths", () => {
		expect(title("user.name")).toBe("User Name")
	})

	it("splits camelCase on capital boundaries", () => {
		expect(title("queryItems")).toBe("Query Items")
		expect(title("HelloWorld")).toBe("Hello World")
	})

	it("splits mixed separators and casing", () => {
		expect(title("createControl-Item")).toBe("Create Control Item")
	})

	it("treats each capital as a word boundary", () => {
		expect(title("ABCTest")).toBe("A B C Test")
	})

	it("leaves digits attached to their word", () => {
		expect(title("foo123bar")).toBe("Foo123bar")
	})

	it("collapses surrounding and repeated whitespace", () => {
		expect(title("  spaced  out ")).toBe("Spaced Out")
	})

	it("title-cases a single word", () => {
		expect(title("contact")).toBe("Contact")
		expect(title("a")).toBe("A")
	})

	it("returns an empty string for empty/nullish input", () => {
		expect(title("")).toBe("")
		expect(title(null)).toBe("")
		expect(title(undefined)).toBe("")
	})
})

describe("html_to_text", () => {
	it("turns block-level tags into line breaks", () => {
		expect(html_to_text("<p>Hello</p><p>World</p>")).toBe("Hello\nWorld")
	})

	it("converts <br> to newlines", () => {
		expect(html_to_text("Line one<br>Line two")).toBe("Line one\nLine two")
	})

	it("strips inline tags and keeps the text", () => {
		expect(html_to_text("<strong>Bold</strong> and <em>italic</em>")).toBe("Bold and italic")
	})

	it("drops style and script blocks entirely", () => {
		expect(html_to_text("<style>p{color:red}</style><p>Hi</p>")).toBe("Hi")
		expect(html_to_text("<script>alert(1)</script><p>Hi</p>")).toBe("Hi")
	})

	it("decodes common HTML entities", () => {
		expect(html_to_text("<p>Tom &amp; Jerry &lt;3</p>")).toBe("Tom & Jerry <3")
	})

	it("collapses excess whitespace and blank lines", () => {
		expect(html_to_text("<p>One</p><p></p><p>Two</p>")).toBe("One\n\nTwo")
	})
})

describe("escape_html", () => {
	it("neutralises tags", () => {
		expect(escape_html("<img src=x onerror=alert(1)>")).toBe("&lt;img src=x onerror=alert(1)&gt;")
	})

	it("escapes quotes so values can't break out of an attribute", () => {
		expect(escape_html('" onmouseover="alert(1)')).toBe("&quot; onmouseover=&quot;alert(1)")
		expect(escape_html("it's")).toBe("it&#39;s")
	})

	it("escapes ampersands first so entities aren't double-decodable", () => {
		// naive ordering would turn this into "&lt;" and html_to_text would then
		// decode it back to a live "<"
		expect(escape_html("&lt;script&gt;")).toBe("&amp;lt;script&amp;gt;")
	})

	it("leaves ordinary text untouched", () => {
		expect(escape_html("Darby Manning")).toBe("Darby Manning")
		expect(escape_html("")).toBe("")
	})

	it("round-trips through html_to_text back to what was typed", () => {
		const typed = '<a href="https://evil.example">click</a> & "quoted"'
		expect(html_to_text(escape_html(typed))).toBe(typed)
	})
})
