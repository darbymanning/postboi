<script lang="ts">
	import { resolve } from "$app/paths"
	import { Button } from "../components/ui/button/index.js"
	import * as Breadcrumb from "../components/ui/breadcrumb/index.js"
	import * as Card from "../components/ui/card/index.js"

	const providers = [{ name: "ZeptoMail", url: "/zepto" }] as const
</script>

<Breadcrumb.Root class="sticky top-0 z-10 mb-8 border-b bg-background/50 p-4 backdrop-blur-2xl">
	<Breadcrumb.List>
		<Breadcrumb.Item>
			<Breadcrumb.Page>Home</Breadcrumb.Page>
		</Breadcrumb.Item>
	</Breadcrumb.List>
</Breadcrumb.Root>

<div class="mx-auto mt-8 max-w-2xl">
	<Card.Root>
		<Card.Header class="flex flex-col items-center justify-center">
			<img src="/logo.svg" alt="Postboi" class="w-52" />
			<Card.Title>Providers</Card.Title>
		</Card.Header>
		<Card.Content>
			{#each providers as provider (provider.name)}
				<Button href={resolve(provider.url)}>{provider.name}</Button>
			{/each}
		</Card.Content>
	</Card.Root>
</div>
