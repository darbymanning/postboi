/**
 * A dependency-free HTML tokenizer, sized for linting email markup.
 *
 * Email HTML is table soup — nested past any sane depth, closed in the wrong
 * order, sprinkled with Outlook conditional comments. Building a DOM from it
 * means choosing how to repair it, and every repair is a chance to disagree
 * with the client that will actually render it. So this does not build a tree:
 * it walks the string once and reports what tags appear with what attributes,
 * plus the bodies of any `<style>` blocks. Every check the inspect module runs
 * is answerable from that flat view.
 */

/** One tag as it appeared in the source. */
export interface TagToken {
	/** Lowercased tag name. */
	name: string
	/** Lowercased attribute names → values ("" for bare attributes). */
	attrs: Record<string, string>
	/** True for `</closing>` tags, which carry no attributes worth reading. */
	closing: boolean
	/** Character offset of the `<` in the source. */
	position: number
}

/** What one pass over the document found. */
export interface Tokenized {
	tags: Array<TagToken>
	/** The text inside each `<style>` block, in document order. */
	styles: Array<string>
}

/**
 * Matches, in one alternation: comments (Outlook conditionals included),
 * CDATA, doctype/processing declarations, and tags. Attribute text is matched
 * quote-aware so a `>` inside a quoted value doesn't end the tag early.
 */
const MARKUP =
	/<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<[!?][^>]*>|<(\/?)([a-zA-Z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>/g

const ATTRIBUTE = /([^\s=/]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]*))?/g

/** Tags whose content is raw text, not markup — captured or skipped whole. */
const RAW_TEXT = new Set(["style", "script", "title", "textarea"])

function parse_attrs(source: string): Record<string, string> {
	const attrs: Record<string, string> = {}
	for (const match of source.matchAll(ATTRIBUTE)) {
		const name = match[1].toLowerCase()
		if (name === "/" || name in attrs) continue
		attrs[name] = match[3] ?? match[4] ?? (match[2] === undefined ? "" : match[2])
	}
	return attrs
}

/**
 * Where a raw-text element's content ends: at `</name` followed by `>`, `/` or
 * whitespace — the same rule clients apply, so `</styles>` inside a style block
 * doesn't end it early — or at end of input when the tag is never closed.
 */
function raw_text_end(lower: string, name: string, start: number): number {
	for (
		let at = lower.indexOf(`</${name}`, start);
		at !== -1;
		at = lower.indexOf(`</${name}`, at + 1)
	) {
		const next = lower[at + name.length + 2]
		if (next === undefined || next === ">" || next === "/" || /\s/.test(next)) return at
	}
	return lower.length
}

/** Walk the document once and collect every tag plus every `<style>` body. */
export function tokenize(html: string): Tokenized {
	const tags: Array<TagToken> = []
	const styles: Array<string> = []
	const lower = html.toLowerCase()

	for (let match = MARKUP.exec(html); match; match = MARKUP.exec(html)) {
		const name = match[2]?.toLowerCase()
		if (!name) continue // a comment, CDATA section or declaration

		const closing = match[1] === "/"
		tags.push({ name, closing, attrs: closing ? {} : parse_attrs(match[3]), position: match.index })

		// Raw-text elements swallow everything to their closing tag — without
		// this, `content: "</div>"` inside a style block would read as markup.
		if (!closing && RAW_TEXT.has(name)) {
			const start = match.index + match[0].length
			const end = raw_text_end(lower, name, start)
			if (name === "style") styles.push(html.slice(start, end))
			MARKUP.lastIndex = end
		}
	}

	MARKUP.lastIndex = 0
	return { tags, styles }
}
