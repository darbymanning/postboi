import type { RequestHandler } from "./$types"
import { siteConfig } from "$site"
import { contentSections } from "$site/config/navigation"
import { getContentSectionManifest, getContentSectionRawSource } from "$site/content/sections"

export const GET: RequestHandler = async () => {
	const seen = new Set<string>()
	const documents: string[] = []
	for (const section of contentSections) {
		for (const item of getContentSectionManifest(section.id)) {
			const key = `${section.id}:${item.slug}`
			if (seen.has(key)) continue
			seen.add(key)
			const content = await getContentSectionRawSource(section.id, item.slug)
			if (content) documents.push(content.trim())
		}
	}

	const preamble = [
		`# ${siteConfig.name}`,
		"",
		`> ${siteConfig.name} — ${siteConfig.description}`,
		"",
		"This file contains the complete documentation as a single Markdown document.",
		"A per-page index is available at `/llms.txt`, and individual pages at `/raw/<slug>`.",
	].join("\n")

	const body = [preamble, ...documents].join("\n\n---\n\n") + "\n"

	return new Response(body, {
		headers: {
			"content-type": "text/plain; charset=utf-8",
			"cache-control": "public, max-age=3600",
		},
	})
}
