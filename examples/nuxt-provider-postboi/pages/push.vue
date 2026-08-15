<script setup lang="ts">
import { use_push } from "postboi/vue"

// No key, no runtimeConfig: `bunx postboi init --push` (or sync) bakes the VAPID
// public key into the package. Destructured so the refs unwrap in the template; a
// missing bake surfaces as reason === "missing_key".
const { on, busy, reason, enable, disable } = use_push({
	register: "/api/push/subscriptions",
})

const status = ref("")

async function test() {
	const { sent } = await $fetch<{ sent: number }>("/api/push/subscriptions", { method: "PUT" })
	status.value = sent ? "sent — check your notifications" : "nothing subscribed on the server"
}
</script>

<template>
	<main>
		<h1>Web Push</h1>

		<p>
			Subscribe this browser, then have the server push to it — close the tab first if
			you want proof it works with the site gone.
		</p>
		<button :disabled="busy" @click="on ? disable() : enable()">
			{{ on ? "Unsubscribe" : "Subscribe" }}
		</button>
		<button :disabled="!on" @click="test">Send me one</button>
		<p v-if="reason">{{ reason }}</p>
		<p v-else-if="status">{{ status }}</p>
	</main>
</template>

<style>
main {
	max-width: 32rem;
	margin: 4rem auto;
	padding: 0 1rem;
	font-family: system-ui, sans-serif;
}
button {
	font: inherit;
	padding: 0.5rem 1rem;
	margin-right: 0.5rem;
}
</style>
