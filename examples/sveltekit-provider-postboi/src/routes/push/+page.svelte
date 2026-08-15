<script lang="ts">
	import { subscribe, unsubscribe } from "postboi/push"

	let { data } = $props()

	let on = $state(false)
	let busy = $state(false)
	let status = $state("")

	$effect(() => {
		// Permission alone can't answer "is this browser subscribed?" — granted-but-
		// unsubscribed is what a browser looks like after someone turned it off again.
		subscribe.current().then((current) => (on = Boolean(current)))
	})

	// Call subscribe() from a click: browsers auto-deny permission prompts that aren't
	// tied to a user gesture, and once denied they never ask again.
	async function enable() {
		if (!data.vapid_public_key) return
		busy = true
		status = ""
		try {
			const subscription = await subscribe({ key: data.vapid_public_key })
			await fetch("/push", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(subscription),
			})
			on = true
		} catch (error) {
			status = subscribe.reason(error) ?? "failed"
		}
		busy = false
	}

	async function disable() {
		await unsubscribe()
		on = false
	}

	async function test() {
		const response = await fetch("/push", { method: "PUT" })
		const { sent } = await response.json()
		status = sent ? "sent — check your notifications" : "nothing subscribed on the server"
	}
</script>

<main>
	<h1>Web Push</h1>

	{#if !data.vapid_public_key}
		<p>No VAPID keys yet — run <code>bunx postboi init --push</code> and restart.</p>
	{:else if !subscribe.supported()}
		<p>This browser doesn't support Web Push.</p>
	{:else}
		<p>
			Subscribe this browser, then have the server push to it — close the tab first if you
			want proof it works with the site gone.
		</p>
		<button onclick={on ? disable : enable} disabled={busy}>
			{on ? "Unsubscribe" : "Subscribe"}
		</button>
		<button onclick={test} disabled={!on}>Send me one</button>
		{#if status}<p>{status}</p>{/if}
	{/if}
</main>

<style>
	main {
		font-family: system-ui, sans-serif;
		max-width: 32rem;
		margin: 4rem auto;
		padding: 0 1rem;
	}
	button {
		font: inherit;
		padding: 0.5rem 1rem;
		margin-right: 0.5rem;
	}
</style>
