#!/usr/bin/env bun
/**
 * Regenerate src/library/inspect/caniemail_data.ts from caniemail.com.
 *
 * The inspect module lints an email against a support matrix — which CSS and
 * HTML features break in which clients. That knowledge lives in the
 * Can I email project (https://www.caniemail.com), and this script compiles a
 * curated subset of it into a checked-in TypeScript data file so the shipped
 * library stays zero-dependency and does nothing at runtime but read an array.
 *
 * Curated on purpose, twice over:
 *
 * - **Features**: caniemail tracks 300+ features down to `css-unit-pc`. A lint
 *   that flags every one of them is noise nobody reads. The list below is the
 *   features that email developers actually get bitten by — layout that
 *   silently collapses in Outlook, images that never load in Gmail — each
 *   paired with how to *detect* it in a document, which caniemail doesn't know.
 * - **Clients**: the matrix keeps to the clients that decide whether an email
 *   is broken for a meaningful share of real recipients.
 *
 * The support data is CC BY-SA 4.0, and the generated file carries the
 * attribution. Run by hand when the matrix feels stale; the diff is the review.
 *
 * Usage: bun scripts/generate-caniemail.ts [path/to/data.json]
 *
 * With no argument the live API is fetched; passing a path regenerates from a
 * saved snapshot (curl -o data.json https://www.caniemail.com/api/data.json).
 */

const SOURCE = process.argv[2] ?? "https://www.caniemail.com/api/data.json"
const OUT = "src/library/inspect/caniemail_data.ts"

/** family key + client key in caniemail's stats → our stable id and display name. */
const CLIENTS = [
	{ family: "gmail", client: "desktop-webmail", id: "gmail-web", name: "Gmail (web)" },
	{ family: "gmail", client: "ios", id: "gmail-ios", name: "Gmail (iOS)" },
	{ family: "gmail", client: "android", id: "gmail-android", name: "Gmail (Android)" },
	{ family: "outlook", client: "windows", id: "outlook-windows", name: "Outlook (Windows)" },
	{ family: "outlook", client: "outlook-com", id: "outlook-com", name: "Outlook.com" },
	{ family: "apple-mail", client: "macos", id: "apple-mail", name: "Apple Mail (macOS)" },
	{ family: "apple-mail", client: "ios", id: "ios-mail", name: "Mail (iOS)" },
	{ family: "yahoo", client: "desktop-webmail", id: "yahoo", name: "Yahoo Mail (web)" },
]

/**
 * What to look for in a document, per feature. The `kind` names a detection
 * strategy implemented in compat.ts; `param` parameterises it. Pipes mean any.
 */
const FEATURES: Array<{ slug: string; kind: string; param: string }> = [
	// Layout that Outlook's Word engine never learned
	{ slug: "css-display-flex", kind: "css_declaration", param: "display:flex|inline-flex" },
	{ slug: "css-display-grid", kind: "css_declaration", param: "display:grid|inline-grid" },
	{ slug: "css-position", kind: "css_property", param: "position" },
	{ slug: "css-z-index", kind: "css_property", param: "z-index" },
	{ slug: "css-float", kind: "css_property", param: "float" },
	{ slug: "css-max-width", kind: "css_property", param: "max-width" },
	{ slug: "css-min-height", kind: "css_property", param: "min-height" },
	{ slug: "css-gap", kind: "css_property", param: "gap" },
	{ slug: "css-aspect-ratio", kind: "css_property", param: "aspect-ratio" },
	{ slug: "css-box-sizing", kind: "css_property", param: "box-sizing" },

	// Paint and decoration
	{ slug: "css-background-image", kind: "css_property", param: "background-image" },
	{ slug: "css-background-size", kind: "css_property", param: "background-size" },
	{ slug: "css-border-radius", kind: "css_property", param: "border-radius" },
	{ slug: "css-box-shadow", kind: "css_property", param: "box-shadow" },
	{ slug: "css-text-shadow", kind: "css_property", param: "text-shadow" },
	{ slug: "css-opacity", kind: "css_property", param: "opacity" },
	{ slug: "css-filter", kind: "css_property", param: "filter" },
	{ slug: "css-clip-path", kind: "css_property", param: "clip-path" },
	{ slug: "css-object-fit", kind: "css_property", param: "object-fit" },
	{ slug: "css-transform", kind: "css_property", param: "transform" },
	{ slug: "css-transition", kind: "css_property", param: "transition" },
	{ slug: "css-animation", kind: "css_property", param: "animation" },
	{ slug: "css-linear-gradient", kind: "css_function", param: "linear-gradient" },
	{ slug: "css-radial-gradient", kind: "css_function", param: "radial-gradient" },

	// Modern CSS machinery
	{ slug: "css-variables", kind: "css_variables", param: "" },
	{ slug: "css-unit-calc", kind: "css_function", param: "calc" },
	{ slug: "css-function-clamp", kind: "css_function", param: "clamp" },
	{ slug: "css-function-light-dark", kind: "css_function", param: "light-dark" },
	{ slug: "css-modern-color", kind: "css_function", param: "oklch|oklab|lab|lch|color-mix" },

	// At-rules and dark mode
	{ slug: "css-at-media", kind: "css_at_rule", param: "media" },
	{
		slug: "css-at-media-prefers-color-scheme",
		kind: "css_media_feature",
		param: "prefers-color-scheme",
	},
	{
		slug: "css-at-media-prefers-reduced-motion",
		kind: "css_media_feature",
		param: "prefers-reduced-motion",
	},
	{ slug: "css-at-font-face", kind: "css_at_rule", param: "font-face" },
	{ slug: "css-at-keyframes", kind: "css_at_rule", param: "keyframes" },
	{ slug: "css-at-supports", kind: "css_at_rule", param: "supports" },
	{ slug: "css-at-import", kind: "css_at_rule", param: "import" },
	{ slug: "html-meta-color-scheme", kind: "html_meta", param: "color-scheme" },

	// Selectors that interactive emails lean on
	{ slug: "css-pseudo-class-hover", kind: "css_selector", param: ":hover" },
	{ slug: "css-pseudo-class-checked", kind: "css_selector", param: ":checked" },
	{ slug: "css-pseudo-element-before", kind: "css_selector", param: "::before" },
	{ slug: "css-pseudo-element-after", kind: "css_selector", param: "::after" },
	{ slug: "css-selector-attribute", kind: "css_selector", param: "[" },

	// HTML that isn't table soup
	{ slug: "html-picture", kind: "html_tag", param: "picture" },
	{ slug: "html-srcset", kind: "html_attr", param: "srcset" },
	{ slug: "html-video", kind: "html_tag", param: "video" },
	{ slug: "html-audio", kind: "html_tag", param: "audio" },
	{ slug: "html-svg", kind: "html_tag", param: "svg" },
	{ slug: "html-form", kind: "html_tag", param: "form" },
	{ slug: "html-input-checkbox", kind: "html_input", param: "checkbox" },
	{
		slug: "html-semantics",
		kind: "html_tag",
		param: "article|aside|figure|footer|header|main|nav|section",
	},
	{ slug: "html-background", kind: "html_attr", param: "background" },

	// Image formats
	{ slug: "image-base64", kind: "img_src", param: "data:" },
	{ slug: "image-webp", kind: "img_src", param: ".webp" },
	{ slug: "image-svg", kind: "img_src", param: ".svg" },
	{ slug: "image-avif", kind: "img_src", param: ".avif" },
]

interface Caniemail {
	last_update_date: string
	data: Array<{
		slug: string
		title: string
		url: string
		stats: Record<string, Record<string, Record<string, string>>>
	}>
}

let source: Caniemail
if (SOURCE.startsWith("http")) {
	const response = await fetch(SOURCE)
	if (!response.ok) {
		console.error(`✗ ${SOURCE} answered ${response.status}`)
		process.exit(1)
	}
	source = (await response.json()) as Caniemail
} else {
	source = (await Bun.file(SOURCE).json()) as Caniemail
}
const by_slug = new Map(source.data.map((feature) => [feature.slug, feature]))

const missing = FEATURES.filter(({ slug }) => !by_slug.has(slug))
if (missing.length) {
	console.error(`✗ caniemail no longer has: ${missing.map(({ slug }) => slug).join(", ")}`)
	process.exit(1)
}

/** Latest verdict for one client: entries are oldest→newest, values like "y", "a #1", "n", "u". */
function latest(versions: Record<string, string> | undefined): "y" | "p" | "n" | undefined {
	if (!versions) return undefined
	const values = Object.values(versions)
	const grade = values[values.length - 1]?.trim()[0]
	if (grade === "y") return "y"
	if (grade === "a") return "p"
	if (grade === "n") return "n"
	return undefined // "u" — untested, or the client vanished from the matrix
}

const features = FEATURES.map(({ slug, kind, param }) => {
	const feature = by_slug.get(slug)!
	const support: Record<string, string> = {}
	for (const { family, client, id } of CLIENTS) {
		const verdict = latest(feature.stats[family]?.[client])
		if (verdict) support[id] = verdict
	}
	return { slug, title: feature.title, url: feature.url, kind, param, support }
})

const clients = CLIENTS.map(({ id, name }) => ({ id, name }))

const banner = `/**
 * GENERATED FILE — do not edit by hand. Regenerate with:
 *
 *     bun scripts/generate-caniemail.ts
 *
 * Client support data is derived from the Can I email project
 * (https://www.caniemail.com), © the Can I email contributors, and is used
 * under the Creative Commons Attribution-ShareAlike 4.0 licence
 * (https://creativecommons.org/licenses/by-sa/4.0/). Feature curation and
 * detection parameters are Postboi's; support verdicts are caniemail's,
 * snapshotted ${source.last_update_date.slice(0, 10)}.
 */

/** How well a client renders a feature: supported, partially, or not at all. */
export type Support = "y" | "p" | "n"

export interface CompatClient {
	id: string
	name: string
}

export interface CompatFeature {
	slug: string
	title: string
	url: string
	/** Detection strategy, implemented in compat.ts. */
	kind: string
	/** Parameter for the detection strategy; pipes separate alternatives. */
	param: string
	/** Client id → verdict. A client missing here is untested — assume nothing. */
	support: Record<string, Support>
}
`

const body = `
export const COMPAT_CLIENTS: Array<CompatClient> = ${JSON.stringify(clients, null, "\t")}

export const COMPAT_FEATURES: Array<CompatFeature> = ${JSON.stringify(features, null, "\t")}
`

await Bun.write(OUT, banner + body)
console.log(`✓ wrote ${OUT}: ${features.length} features × ${clients.length} clients`)
