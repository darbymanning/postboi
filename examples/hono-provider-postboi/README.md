# Hono × Postboi

A framework-agnostic HTTP example. Hono exposes the Web-standard `Request` and
`FormData`, so the same `mail({ body })` pattern works with no framework
magic. A contact form posts to the server, postboi turns the submission into a
tidy HTML email, and a hidden `_reply_to` field (mirrored from the submitted
email) means replies reach the sender.

## Set up

```sh
bunx postboi init   # writes .env, prompts for your Postboi token
bun install
bun run dev
```

Then open http://localhost:3000.

## How it works

- **`src/index.ts`** — a Hono app. `GET /` renders the contact form (with hidden
  `_subject` and `_reply_to` fields; a one-line `oninput` mirrors the email into
  `_reply_to`); `POST /contact` reads `await c.req.formData()` and calls
  `mail({ body })`. Field names use the `group→field` convention (e.g. `contact→name`)
  which postboi renders as grouped sections in the email.
- **`postboi.config.ts`** — picks the provider (the Postboi provider) and the default
  recipient for notifications. Swap `provider` for any of
  https://docs.postboi.app/providers to use a different one.

Learn more at the [postboi docs](https://docs.postboi.app) and
[the Postboi provider](https://postboi.app).

## Beyond the form

The contact form is the classic; the rest of postboi wires in the same way:

- **`POST /webhooks`** — provider delivery events (delivered, opened, bounced, …),
  signature-verified and normalized. Set `<PROVIDER>_WEBHOOK_SECRET` and point your
  provider's webhook here.
- **`POST /notify`** — the other channels: `sms()`, `whatsapp()` and `slack()` from one
  endpoint. `{ "channel": "sms", "to": "+447700900123", "message": "…" }` — in
  development SMS and WhatsApp are logged, not sent.

Web Push's browser half needs a client bundle, which this server-only example doesn't
have — see the SvelteKit or Next.js example for push end to end.
