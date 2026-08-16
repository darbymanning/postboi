import type { LayoutLoad } from "./$types"
import {
	getContentSectionAdjacentItems,
	getContentSectionMetadata,
	getContentSectionTocHeadings,
	getContentSectionUiConfig,
	resolveSection,
} from "$site/content/sections"
import { resolveTocSelector } from "$site/config/content-ui"

export const prerender = true

export const load: LayoutLoad = async ({ url }) => {
	const { sectionId, slug } = resolveSection(url.pathname)
	const { previous, next } = getContentSectionAdjacentItems(sectionId, slug)
	const metadata = await getContentSectionMetadata(sectionId, url.pathname)
	const sectionUi = getContentSectionUiConfig(sectionId)
	const tocSelector = resolveTocSelector(sectionUi.toc, slug)
	const tocHeadings = await getContentSectionTocHeadings(sectionId, slug, tocSelector)

	return {
		sectionId,
		slug,
		metadata,
		tocHeadings,
		previousDoc: previous,
		nextDoc: next,
		docOrigin: url.origin,
	}
}
