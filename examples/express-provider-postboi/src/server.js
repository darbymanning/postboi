import express from "express"
import { mail, sms, whatsapp, slack } from "postboi"
import { receive, WebhookVerificationError } from "postboi/webhooks"

const app = express()
app.use(express.urlencoded({ extended: true })) // parses form fields onto req.body — no multer needed

app.get("/", function (req, res) {
	const sent = req.query.sent === "1"
	res.type("html").send(`<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>Contact us</title>
	</head>
	<body>
		<h1>Contact us</h1>
		${sent ? `<p>Thanks — we'll be in touch.</p>` : ""}
		<form method="post" action="/contact">
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

app.post("/contact", async ({ body }, res) => {
	await mail({ body })
	res.redirect(303, "/?sent=1")
})

// Provider delivery events — and the one place Express differs from every web-standard
// framework: signatures verify over the EXACT raw bytes, so this route must take
// `express.raw()` and rebuild a web Request. Let a body parser touch the payload first
// and verification fails forever with nothing to say why. Set <PROVIDER>_WEBHOOK_SECRET
// in .env and point the provider's webhook at POST /webhooks.
app.post("/webhooks", express.raw({ type: "*/*" }), async (req, res) => {
	const headers = new Headers()
	for (const [name, value] of Object.entries(req.headers)) {
		headers.set(name, Array.isArray(value) ? value.join(", ") : (value ?? ""))
	}
	try {
		const events = await receive(
			new Request(`http://localhost:3000${req.originalUrl}`, {
				method: "POST",
				headers,
				body: req.body,
			})
		)
		for (const event of events) console.log(`${event.type} — ${event.email ?? ""}`)
		res.json({ received: events.length })
	} catch (error) {
		if (error instanceof WebhookVerificationError) {
			res.status(401).json({ error: "bad signature" })
		} else {
			res.status(400).json({ error: "unparseable payload" })
		}
	}
})

// The other channels — identical calls in every framework, Express only decides where
// they sit. In development SMS/WhatsApp are logged, not sent (POSTBOI_SMS_DEV=send etc.
// for real delivery); chat needs SLACK_WEBHOOK_URL. For several channels in one call —
// or a cheapest-first fallback chain — see send(): https://docs.postboi.app/send
//
//   curl -X POST localhost:3000/notify -H 'content-type: application/json' \
//     -d '{"channel":"sms","to":"+447700900123","message":"Your code is 428 916"}'
app.post("/notify", express.json(), async ({ body: { channel, to, message } }, res) => {
	switch (channel) {
		case "sms":
			return res.json(await sms({ to, message }))
		case "whatsapp":
			// Free-form only lands within 24h of their last reply — templates any time.
			return res.json(await whatsapp({ to, message }))
		case "chat":
			return res.json(await slack({ message }))
		default:
			return res.status(400).json({ error: `unknown channel "${channel}"` })
	}
})

app.listen(3000, () => console.log("→ http://localhost:3000"))
