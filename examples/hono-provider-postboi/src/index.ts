import { Hono } from "hono"
import { mail, sms, whatsapp, slack } from "postboi"
import { receive, WebhookVerificationError } from "postboi/webhooks"

const app = new Hono()

app.get("/", function (c) {
	const sent = new URL(c.req.url).searchParams.get("sent") === "1"

	return c.html(`<!doctype html>
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
</html>`)
})

app.post("/contact", async function (c) {
	// The form carries `_subject` and `_reply_to` (mirrored from the email) as hidden fields,
	// so the whole submission is handed straight to postboi — `body` accepts the promise.
	await mail({ body: c.req.formData() })
	return c.redirect("/?sent=1", 303)
})

// Provider delivery events. `receive()` wants the web Request — Hono keeps the raw one
// at c.req.raw, untouched, which matters: signatures verify over the exact bytes.
// Point your provider's webhook at POST /webhooks and set <PROVIDER>_WEBHOOK_SECRET.
app.post("/webhooks", async function (c) {
	try {
		const events = await receive(c.req.raw)
		for (const event of events) console.log(`${event.type} — ${event.email ?? ""}`)
		return c.json({ received: events.length })
	} catch (error) {
		if (error instanceof WebhookVerificationError) {
			return c.json({ error: "bad signature" }, 401)
		}
		return c.json({ error: "unparseable payload" }, 400)
	}
})

// The other channels — identical calls in every framework, Hono only decides where
// they sit. In development SMS/WhatsApp are logged, not sent (POSTBOI_SMS_DEV=send
// etc. for real delivery); chat needs SLACK_WEBHOOK_URL. For several channels in one
// call — or a cheapest-first fallback chain — see send(): https://docs.postboi.app/send
//
//   curl -X POST localhost:3000/notify -H 'content-type: application/json' \
//     -d '{"channel":"sms","to":"+447700900123","message":"Your code is 428 916"}'
app.post("/notify", async function (c) {
	const { channel, to, message } = await c.req.json()

	switch (channel) {
		case "sms":
			return c.json(await sms({ to, message }))

		case "whatsapp":
			// Free-form only lands within 24h of their last reply — templates any time.
			return c.json(await whatsapp({ to, message }))

		case "chat":
			return c.json(await slack({ message }))

		default:
			return c.json({ error: `unknown channel "${channel}"` }, 400)
	}
})

export default app
