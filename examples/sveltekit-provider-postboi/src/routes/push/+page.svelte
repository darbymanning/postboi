<script lang="ts">
	import { push_controller } from "postboi/push"

	let { data } = $props()

	// The whole toggle state machine — current() on mount, busy and error state,
	// subscribe-then-register with rollback when the server never learns the address —
	// is the controller's. It implements the store contract, so $push just works.
	const push = push_controller({ key: data.vapid_public_key ?? "", register: "/push" })

	let status = $state("")

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
	{:else}
		<p>
			Subscribe this browser, then have the server push to it — close the tab first if you
			want proof it works with the site gone.
		</p>
		<button onclick={() => ($push.on ? push.disable() : push.enable())} disabled={$push.busy}>
			{$push.on ? "Unsubscribe" : "Subscribe"}
		</button>
		<button onclick={test} disabled={!$push.on}>Send me one</button>
		{#if $push.reason}<p>{$push.reason}</p>{:else if status}<p>{status}</p>{/if}
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
