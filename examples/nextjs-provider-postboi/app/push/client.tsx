"use client"

import { useState } from "react"
import { usePush } from "postboi/react"

export function PushClient({ vapidKey }: { vapidKey?: string }) {
	// The whole toggle state machine — current() on mount, busy and error state,
	// subscribe-then-register with rollback when the server never learns the address —
	// lives in the hook.
	const push = usePush({ key: vapidKey ?? "", register: "/push/subscriptions" })
	const [status, setStatus] = useState("")

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
		<main style={{ maxWidth: 480, margin: "4rem auto", fontFamily: "system-ui" }}>
			<h1>Web Push</h1>
			<p>
				Subscribe this browser, then have the server push to it — close the tab first if
				you want proof it works with the site gone.
			</p>
			<button onClick={push.on ? push.disable : push.enable} disabled={push.busy}>
				{push.on ? "Unsubscribe" : "Subscribe"}
			</button>{" "}
			<button onClick={test} disabled={!push.on}>
				Send me one
			</button>
			{push.reason ? <p>{push.reason}</p> : status ? <p>{status}</p> : null}
		</main>
	)
}
