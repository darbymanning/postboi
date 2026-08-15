# Postboi scripts

Plain Bun/Node scripts — no framework, no form. Just call `mail()` from your backend.

- [`transactional.ts`](./transactional.ts) — the simplest send: one `mail({ to, subject, body })`
  (a welcome email, a receipt, a reset link).
- [`bulk.ts`](./bulk.ts) — send an array of messages with bounded concurrency
  ([Bulk sending](https://docs.postboi.app/bulk)).
- [`scheduling.ts`](./scheduling.ts) — send later with `scheduled_at`
  ([Scheduling](https://docs.postboi.app/scheduling)).

Postboi went multi-channel, and so do the scripts — same shape, different import:

- [`sms.ts`](./sms.ts) — one text with `sms()` ([SMS](https://docs.postboi.app/sms)).
  In development texts are logged, not sent.
- [`whatsapp.ts`](./whatsapp.ts) — a template send with `whatsapp()`
  ([WhatsApp](https://docs.postboi.app/whatsapp)) — templates deliver outside the
  24-hour reply window; free-form text doesn't.
- [`chat.ts`](./chat.ts) — `slack()` and `discord()` with a webhook URL as the only
  credential ([Chat](https://docs.postboi.app/slack)).
- [`notify.ts`](./notify.ts) — `send()` in both modes: fan-out to every channel in
  `to`, and the cheapest-first fallback chain
  ([send()](https://docs.postboi.app/send)).

## Run

```bash
bunx postboi init   # or: cp .env.example .env and fill in POSTBOI_TOKEN
bun install
bun run transactional
bun run bulk
bun run schedule
```

Both use the top-level `mail()`, which picks up the provider from
[`postboi.config.ts`](./postboi.config.ts) — the Postboi provider by default. Swap `provider`
there for any of the [supported providers](https://docs.postboi.app/providers) and set that
provider's API key in `.env` instead.

> Scheduling only takes effect on providers that support it (the Postboi provider, Resend, Brevo,
> Mailgun, SendGrid). On the others, `scheduled_at` is ignored and the message sends
> immediately.
