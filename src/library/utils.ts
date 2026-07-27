/**
 * Small, dependency-free string helpers used when rendering FormData into the
 * email body. Kept internal to the library so Postboi ships with zero runtime
 * dependencies.
 */

/**
 * Capitalise the first character of a string and lower-case the rest.
 *
 * @example
 * capitalize("hELLO") // => "Hello"
 * capitalize("world") // => "World"
 */
export function capitalize(str: string | null | undefined): string {
	if (!str) return ""
	const lower = str.toLowerCase()
	return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/**
 * Convert a string to Title Case.
 *
 * Words are split on camelCase boundaries as well as on spaces, dots, hyphens
 * and underscores, then each word is capitalised and joined with single spaces.
 *
 * @example
 * title("first_name")         // => "First Name"
 * title("queryItems")         // => "Query Items"
 * title("createControl-Item") // => "Create Control Item"
 * title("va_va_boom")         // => "Va Va Boom"
 */
export function title(str: string | null | undefined): string {
	if (!str) return ""
	return str
		.split(/(?=[A-Z])|[\s._-]/)
		.map((word) => word.trim())
		.filter(Boolean)
		.map(capitalize)
		.join(" ")
}

/**
 * Run an async mapper over items with a bounded concurrency pool, preserving input order.
 *
 * @example
 * await pooled_map([1, 2, 3], 2, async (n) => n * 2) // => [2, 4, 6], at most 2 in flight
 */
export async function pooled_map<T, R>(
	items: ReadonlyArray<T>,
	concurrency: number,
	mapper: (item: T, index: number) => Promise<R>
): Promise<Array<R>> {
	const limit = Math.max(1, Math.min(concurrency, items.length))
	const results = new Array<R>(items.length)
	let cursor = 0

	async function worker() {
		while (cursor < items.length) {
			const index = cursor++
			results[index] = await mapper(items[index], index)
		}
	}

	await Promise.all(Array.from({ length: limit }, worker))
	return results
}

/**
 * Escape a string for interpolation into HTML text or a quoted attribute.
 *
 * Every value rendered into the FormData table goes through this. Submissions come
 * from public forms, so both the values *and* the field names are attacker-controlled
 * — without escaping, anyone could plant a link or a tracking pixel in the
 * notification email the site owner reads.
 *
 * The entities chosen are exactly the ones {@link html_to_text} decodes, so the
 * derived plain-text body still shows what the sender actually typed.
 *
 * @example
 * escape_html('<a href="x">hi</a>') // => "&lt;a href=&quot;x&quot;&gt;hi&lt;/a&gt;"
 */
export function escape_html(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;")
}

/**
 * {@link escape_html}, then turn line breaks into `<br>`.
 *
 * For multi-line values (a textarea, an address). HTML collapses raw newlines, so
 * without this a three-line message arrives as one run-on paragraph. Browsers submit
 * textareas with CRLF, so `\r\n`, lone `\r` and lone `\n` are all handled.
 *
 * Escaping happens first, so the `<br>` tags this adds survive.
 *
 * @example
 * escape_lines("line one\r\nline two") // => "line one<br>line two"
 */
export function escape_lines(value: string): string {
	return escape_html(value).replace(/\r\n?|\n/g, "<br>")
}

/**
 * Derive a readable plain-text body from an HTML string. Drops `<style>`/`<script>`
 * blocks, turns block-level tags and `<br>` into line breaks, strips remaining tags,
 * decodes the common HTML entities and collapses excess whitespace.
 *
 * Table cells end a line too. Without that, the FormData table's `<td>Label</td>
 * <td>Value</td>` collapsed to `LabelValue` in every plain-text alternative. A `": "`
 * separator would read better for label/value pairs specifically, but this runs over
 * *any* HTML body — it would turn an invoice's row into `Item: Qty: Price:`.
 *
 * @example
 * html_to_text("<p>Hello</p><p>World</p>") // => "Hello\nWorld"
 * html_to_text("<tr><td>Name</td><td>Ada</td></tr>") // => "Name\nAda"
 */
export function html_to_text(html: string): string {
	return html
		.replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
		.replace(/<\/(p|div|tr|td|th|h[1-6]|li|ul|ol|table)>/gi, "\n")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/[ \t]+/g, " ")
		.split("\n")
		.map((line) => line.trim())
		.filter((line, i, lines) => line !== "" || lines[i - 1] !== "")
		.join("\n")
		.trim()
}
