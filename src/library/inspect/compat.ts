/**
 * Match a document against the caniemail-derived support matrix.
 *
 * Each entry in {@link COMPAT_FEATURES} names a detection strategy (`kind`)
 * and a parameter — "this CSS property", "this at-rule", "this tag". A
 * feature that is found in the document and degrades somewhere in the client
 * matrix becomes one finding, listing exactly which clients lose it.
 *
 * Detection is deliberately coarse: it answers "does this email use flexbox?",
 * not "is this flexbox declaration reachable?". False positives are cheap
 * here (a finding links to the evidence), false negatives are not.
 */

import type { Tokenized } from "./html.js"
import type { Finding, ClientImpact, ImageInfo } from "./types.js"
import { COMPAT_CLIENTS, COMPAT_FEATURES } from "./caniemail_data.js"

const escape_regex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const client_names = new Map(COMPAT_CLIENTS.map(({ id, name }) => [id, name]))

interface Document {
	tokens: Tokenized
	images: Array<ImageInfo>
	/** Style blocks and inline style attributes, joined — declarations live here. */
	css: string
	/** Style blocks only — selectors and at-rules can only appear here. */
	sheet: string
}

function detected(document: Document, kind: string, param: string): boolean {
	const { tokens, images, css, sheet } = document
	const options = param.split("|")

	switch (kind) {
		case "css_property":
			return new RegExp(`(?:^|[;{\\s])(?:${options.map(escape_regex).join("|")})\\s*:`, "i").test(
				css
			)
		case "css_declaration": {
			const [property, values] = param.split(":")
			return new RegExp(
				`(?:^|[;{\\s])${escape_regex(property)}\\s*:\\s*(?:${values.split("|").map(escape_regex).join("|")})\\b`,
				"i"
			).test(css)
		}
		case "css_function":
			return new RegExp(`(?<![-\\w])(?:${options.map(escape_regex).join("|")})\\(`, "i").test(css)
		case "css_variables":
			return /(?:^|[;{\s])--[\w-]/.test(css) || /(?<![-\w])var\(/i.test(css)
		case "css_at_rule":
			return new RegExp(`@${escape_regex(param)}\\b`, "i").test(sheet)
		case "css_media_feature":
			return new RegExp(`\\(\\s*${escape_regex(param)}\\b`, "i").test(sheet)
		case "css_selector":
			if (param === "[") return /\[[a-zA-Z-]+(?:[~^$*|]?=[^\]]*)?\]/.test(sheet)
			// "::before" also matches the legacy single-colon spelling.
			return new RegExp(
				param.startsWith("::") ? `::?${param.slice(2)}\\b` : `${escape_regex(param)}\\b`,
				"i"
			).test(sheet)
		case "html_tag":
			return tokens.tags.some((tag) => !tag.closing && options.includes(tag.name))
		case "html_attr":
			return tokens.tags.some((tag) => !tag.closing && param in tag.attrs)
		case "html_input":
			return tokens.tags.some(
				(tag) => !tag.closing && tag.name === "input" && tag.attrs.type?.toLowerCase() === param
			)
		case "html_meta":
			return tokens.tags.some(
				(tag) => !tag.closing && tag.name === "meta" && tag.attrs.name?.toLowerCase() === param
			)
		case "img_src":
			return images.some(({ src }) => {
				const path = src.split(/[?#]/)[0].toLowerCase()
				return param === "data:" ? path.startsWith("data:") : path.endsWith(param)
			})
		default:
			return false
	}
}

const list = (names: Array<string>) =>
	names.length <= 2
		? names.join(" and ")
		: `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`

/** Every compatibility finding for one document. */
export function compat_findings(tokens: Tokenized, images: Array<ImageInfo>): Array<Finding> {
	const inline = tokens.tags
		.filter((tag) => !tag.closing && tag.attrs.style)
		.map((tag) => tag.attrs.style)
	const sheet = tokens.styles.join("\n")
	const document: Document = { tokens, images, sheet, css: `${sheet}\n{${inline.join(";")}}` }

	const findings: Array<Finding> = []
	for (const feature of COMPAT_FEATURES) {
		if (!detected(document, feature.kind, feature.param)) continue

		const clients: Array<ClientImpact> = Object.entries(feature.support)
			.filter(([, verdict]) => verdict !== "y")
			.map(([id, verdict]) => ({
				client: id,
				name: client_names.get(id) ?? id,
				support: verdict === "n" ? "none" : "partial",
			}))
		if (!clients.length) continue

		const none = clients.filter(({ support }) => support === "none").map(({ name }) => name)
		const partial = clients.filter(({ support }) => support === "partial").map(({ name }) => name)
		const message = [
			`${feature.title} is used`,
			none.length ? `but not supported in ${list(none)}` : "",
			partial.length
				? `${none.length ? "and " : "but "}only partially supported in ${list(partial)}`
				: "",
		]
			.filter(Boolean)
			.join(" ")

		findings.push({
			id: "compat",
			severity: none.length ? "warning" : "info",
			message,
			feature: feature.slug,
			clients,
			url: feature.url,
		})
	}
	return findings
}
