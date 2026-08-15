import type { LoaderFunctionArgs } from "@remix-run/node"
import { useLoaderData } from "@remix-run/react"
import { useEffect, useState } from "react"
import { subscribe, unsubscribe } from "postboi/push"

// The loader hands the page the public half of the VAPID pair — public by definition;
// the private half stays on the server and signs every send. `bunx postboi init --push`
// mints the pair.
export function loader(_args: LoaderFunctionArgs) {
	return { vapidKey: process.env.VAPID_PUBLIC_KEY ?? null }
}

export default function Push() {
	const { vapidKey } = useLoaderData<typeof loader>()
	const [on, setOn] = useState(false)
	const [busy, setBusy] = useState(false)
	const [status, setStatus] = useState("")

	useEffect(() => {
		// Permission alone can't answer "is this browser subscribed?" — granted-but-
		// unsubscribed is what a browser looks like after someone turned it off again.
		subscribe.current().then((current) => setOn(Boolean(current)))
	}, [])

	// Call subscribe() from a click: browsers auto-deny permission prompts that aren't
	// tied to a user gesture, and once denied they never ask again.
	async function enable() {
		if (!vapidKey) return
		setBusy(true)
		setStatus("")
		try {
			const subscription = await subscribe({ key: vapidKey })
			await fetch("/push/subscriptions", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(subscription),
			})
			setOn(true)
		} catch (error) {
			setStatus(subscribe.reason(error) ?? "failed")
		}
		setBusy(false)
	}

	async function disable() {
		await unsubscribe()
		setOn(false)
	}

	async function test() {
		const response = await fetch("/push/subscriptions", { method: "PUT" })
		const { sent } = await response.json()
		setStatus(sent ? "sent — check your notifications" : "nothing subscribed on the server")
	}

	if (!vapidKey) {
		return (
			<p>
				No VAPID keys yet — run <code>bunx postboi init --push</code> and restart.
			</p>
		)
	}

	return (
		<main style={{ maxWidth: "32rem", margin: "4rem auto", fontFamily: "system-ui, sans-serif" }}>
			<h1>Web Push</h1>
			<p>
				Subscribe this browser, then have the server push to it — close the tab first if
				you want proof it works with the site gone.
			</p>
			<button onClick={on ? disable : enable} disabled={busy}>
				{on ? "Unsubscribe" : "Subscribe"}
			</button>{" "}
			<button onClick={test} disabled={!on}>
				Send me one
			</button>
			{status ? <p>{status}</p> : null}
		</main>
	)
}
