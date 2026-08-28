<script lang="ts">
	import type { Snippet } from "svelte"
	import { cn } from "$site/utils/cn"

	type ComponentProps = {
		class?: string
		children?: Snippet
		[prop: string]: unknown
	}

	const { children, class: className = "", ...restProps }: ComponentProps = $props()
</script>

<tr {...restProps} class={cn("text-base leading-relaxed font-normal", className)}>
	{@render children?.()}
</tr>
