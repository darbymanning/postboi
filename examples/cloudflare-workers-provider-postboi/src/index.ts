import { mail, sms, whatsapp, slack } from "postboi"
import { receive, WebhookVerificationError } from "postboi/webhooks"

function page(sent: boolean): Response {
	return new Response(
		`<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>Contact us</title>
	</head>
	<body>
		<h1>Contact us</h1>
		${sent ? `<p>Thanks — we'll be in touch.</p>` : ""}
		<form method="post" action="/contact" enctype="multipart/form-data">
			<input type="hidden" name="_subject" value="Contact Form" />
			<input type="hidden" name="_reply_to" />
			<input name="contact→name" placeholder="Name" required />
			<input
				name="contact→email"
				type="email"
				placeholder="Email"
				required
				oninput="this.form._reply_to.value = this.value"
			/>
			<textarea name="details→message" placeholder="Message"></textarea>
			<button type="submit">Send</button>
		</form>
	</body>
</html>`,
		{ headers: { "content-type": "text/html; charset=utf-8" } }
	)
}

export default {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)

		if (request.method === "POST" && url.pathname === "/contact") {
			// The POSTBOI_TOKEN binding is read for us — Workers have no filesystem, so only
			// a postboi.config.ts would need wiring up by hand.
			await mail({ body: request.formData(), to: "team@acme.example" })
			return Response.redirect(new URL("/?sent=1", url).toString(), 303)
		}

		// Provider delivery events. The Worker's Request goes straight into receive() —
		// signatures verify over the exact bytes. Set <PROVIDER>_WEBHOOK_SECRET as a
		// binding and point the provider's webhook at POST /webhooks.
		if (request.method === "POST" && url.pathname === "/webhooks") {
			try {
				const events = await receive(request)
				for (const event of events) console.log(`${event.type} — ${event.email ?? ""}`)
				return Response.json({ received: events.length })
			} catch (error) {
				if (error instanceof WebhookVerificationError) {
					return Response.json({ error: "bad signature" }, { status: 401 })
				}
				return Response.json({ error: "unparseable payload" }, { status: 400 })
			}
		}

		// The other channels — identical calls in every framework. In development
		// SMS/WhatsApp are logged, not sent; chat needs a SLACK_WEBHOOK_URL binding.
		// For several channels in one call, see send(): https://docs.postboi.app/send
		//
		//   curl -X POST localhost:8787/notify -H 'content-type: application/json' \
		//     -d '{"channel":"sms","to":"+447700900123","message":"Your code is 428 916"}'
		if (request.method === "POST" && url.pathname === "/notify") {
			const { channel, to, message } = await request.json<{
				channel: string
				to: string
				message: string
			}>()

			switch (channel) {
				case "sms":
					return Response.json(await sms({ to, message }))

				case "whatsapp":
					// Free-form only lands within 24h of their last reply — templates any time.
					return Response.json(await whatsapp({ to, message }))

				case "chat":
					return Response.json(await slack({ message }))

				default:
					return Response.json({ error: `unknown channel "${channel}"` }, { status: 400 })
			}
		}

		return page(url.searchParams.get("sent") === "1")
	},
}
