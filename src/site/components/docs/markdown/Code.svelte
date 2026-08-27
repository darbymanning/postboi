<script lang="ts">
	import type { Snippet } from "svelte"
	import { cn } from "$site/utils/cn"

	type ComponentProps = {
		class?: string
		children?: Snippet
		[prop: string]: unknown
	}

	const { children, class: className = "", ...restProps }: ComponentProps = $props()

	const isBlock = (classValue: string | undefined, dataTheme: unknown) => {
		if (dataTheme !== undefined) return true
		if (!classValue) return false

		return classValue.split(/\s+/).some((token) => token.startsWith("language-"))
	}
</script>

{#if isBlock(typeof className === "string" ? className : undefined, restProps["data-theme"])}
	<code
		{...restProps}
		class={cn("block font-mono text-sm leading-relaxed whitespace-pre", className)}
	>
		{@render children?.()}
	</code>
{:else}
	<!-- One frame, not two. The old inline code was a card nested inside an
	     inset-shadow well: with soft 0.5px edges that read as a subtle chip, but
	     under the brutalist material it becomes two 2px ink rings around three
	     characters, and a paragraph naming five APIs turns into a fence. What is
	     left is a single ruled box on a yellow ground — a highlighter run over
	     the identifier, which is what an inline code span is for. -->
	<code
		{...restProps}
		class={cn(
			"relative inline-flex w-fit border-[length:var(--bd)] border-border bg-brand-yellow px-1.5 py-0.5 font-mono text-sm font-medium whitespace-nowrap text-brand-ink",
			className
		)}
	>
		{@render children?.()}
	</code>
{/if}
