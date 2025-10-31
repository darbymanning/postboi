<script lang="ts">
	import "../app.css"
	import { Toaster } from "../components/ui/sonner/index.js"
	import { ModeWatcher } from "mode-watcher"

	let { children } = $props()
</script>

<ModeWatcher />

<main>{@render children()}</main>

<Toaster richColors />
