<script setup lang="ts">
import { subscribe, unsubscribe } from "postboi/push"

const key = useRuntimeConfig().public.vapidPublicKey

const on = ref(false)
const busy = ref(false)
const status = ref("")

onMounted(async () => {
	// Permission alone can't answer "is this browser subscribed?" — granted-but-
	// unsubscribed is what a browser looks like after someone turned it off again.
	on.value = Boolean(await subscribe.current())
})

// Call subscribe() from a click: browsers auto-deny permission prompts that aren't
// tied to a user gesture, and once denied they never ask again.
async function enable() {
	if (!key) return
	busy.value = true
	status.value = ""
	try {
		const subscription = await subscribe({ key })
		await $fetch("/api/push/subscriptions", { method: "POST", body: subscription })
		on.value = true
	} catch (error) {
		status.value = subscribe.reason(error) ?? "failed"
	}
	busy.value = false
}

async function disable() {
	await unsubscribe()
	on.value = false
}

async function test() {
	const { sent } = await $fetch<{ sent: number }>("/api/push/subscriptions", { method: "PUT" })
	status.value = sent ? "sent — check your notifications" : "nothing subscribed on the server"
}
</script>

<template>
	<main>
		<h1>Web Push</h1>

		<p v-if="!key">
			No VAPID keys yet — run <code>bunx postboi init --push</code> and restart.
		</p>
		<template v-else>
			<p>
				Subscribe this browser, then have the server push to it — close the tab first if
				you want proof it works with the site gone.
			</p>
			<button :disabled="busy" @click="on ? disable() : enable()">
				{{ on ? "Unsubscribe" : "Subscribe" }}
			</button>
			<button :disabled="!on" @click="test">Send me one</button>
			<p v-if="status">{{ status }}</p>
		</template>
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
