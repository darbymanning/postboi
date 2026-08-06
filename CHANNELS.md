# Postboi — Multi-channel Plan

Turning postboi from an email library into a messaging library: SMS first, then push
notifications, then a single import that fans out across channels.

Status: **planning**. Nothing here is built. This doc is the source of truth for the
channel work — read it before starting a phase, and update it when a decision changes.

---

## The target API

```ts
import { sms } from "postboi"

await sms({ to: "+447788223344", message: "a text message, what thats mental bro" })
```

```ts
import { push } from "postboi"

await push({ to: subscription, title: "Order shipped", message: "On its way" })
```

```ts
import { notify } from "postboi"

// fan-out: every channel gets it, per-channel results, no channel can fail the others
await notify({
	to: { email: "ada@example.com", sms: "+447788223344", push: token },
	subject: "Your order shipped",
	message: "Your order shipped",
	body: "<p>Your order shipped</p>",
})

// fallback chain: first success wins — what people actually want for OTPs
await notify({ to: { push: token, sms: "+447788223344" }, channels: ["push", "sms"], message: "…" })
```

Every one of these keeps the properties `mail()` already has: zero-config resolution from
the environment, dev-inbox interception, lifecycle hooks, opt-in retries, normalized
errors.

---

## What already exists, and what has to change

`ProviderBase` (`src/library/index.ts:472`) is one class doing two jobs. The split is the
whole enabling move for this plan, so it's worth being precise about where the seam is.

### Channel-agnostic today — reusable as-is (~400 lines)

| Member                                       | Where                  |
| -------------------------------------------- | ---------------------- |
| `request()` — timeout, retry, backoff, `on.retry` | `index.ts:841`     |
| `#should_retry` / `#backoff` / `#sleep`      | `index.ts:893`         |
| `read_json`                                  | `index.ts:984`         |
| `error_for`                                  | `index.ts:586`         |
| `with_hooks` / `before_send` / `#emit_error` / `#observe` | `index.ts:612` |
| `normalize_error` / `is_error`               | `index.ts:693`         |
| `send_batch` (+ `pooled_map` in `utils.ts`)  | `index.ts:709`         |
| `fill_template` / `translate_placeholders`   | `index.ts:727`         |
| `resolve_scheduled_at`                       | `index.ts:1007`        |
| `file_to_base64`                             | `index.ts:908`         |
| `PostboiError` / `SkipSendError`             | `index.ts:339`         |

### Email-specific — stays behind (~400 lines)

| Member                                              | Where           |
| --------------------------------------------------- | --------------- |
| `prepare_send` — to/from/cc/bcc/subject/html/text/unsubscribe | `index.ts:1184` |
| `parse_form_data` — the HTML table renderer         | `index.ts:1042` |
| `to_form_data`                                      | `index.ts:1026` |
| `enforce_captcha`                                   | `index.ts:1162` |
| `parse_email_address` / `parse_addresses` / `stringify_address(es)` / `email_name(_list)` | `index.ts:930` |
| `parse_attachment(s)`                               | `index.ts:914`  |
| `send_data_batch` — `{key}` personalisation per recipient | `index.ts:774` |
| `cancel`                                            | `index.ts:562`  |

`send_data_batch` is listed as email-specific only because its plumbing (`parse_addresses`,
`prepare_send`) is; the *idea* generalises fine and can be lifted later if an SMS provider
turns out to have a native batch endpoint worth using.

### Coupling audit — what does *not* need touching

- `kit.ts`, `form.ts`, `vite.ts`, `mail.remote.ts` never reference `ProviderBase` or
  `PreparedMessage`. They're form/HTTP-layer code and are unaffected by the split.
- Every existing provider file (`resend.ts`, `ses.ts`, …) extends `ProviderBase` and
  implements three hooks. If `ProviderBase` stays exported as an alias of the new
  `EmailProvider`, **zero provider files change**.
- `webhooks/` is entirely separate and unaffected.

---

## Architecture after the split

```
                       ┌───────────────────────────────────────┐
                       │  Transport (channel-agnostic base)    │
                       │  request/retry/timeout · hooks ·      │
                       │  error normalisation · batch fan-out  │
                       └───────────────┬───────────────────────┘
              ┌────────────────────────┼────────────────────────┐
              ▼                        ▼                        ▼
    ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
    │  EmailProvider   │    │   SmsProvider    │    │  PushProvider    │
    │  (= ProviderBase)│    │                  │    │                  │
    │  prepare_send    │    │  prepare_sms     │    │  prepare_push    │
    │  FormData·captcha│    │  E.164 normalise │    │  token targeting │
    └────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘
             │                       │                       │
   resend·ses·postmark·…    twilio·vonage·sns·…     webpush·fcm·apns
             │                       │                       │
             ▼                       ▼                       ▼
         mail()                   sms()                   push()
             └───────────────────────┼───────────────────────┘
                                     ▼
                                 notify()
```

Each channel gets its own resolver mirroring `resolve_provider` (`mail.ts:89`): its own
`LOADERS` map, its own env var (`POSTBOI_SMS_PROVIDER`, `POSTBOI_PUSH_PROVIDER`), its own
defaults, and the same dev-inbox interception.

---

## Decisions to make before Phase 1

These are the ones that change the shape of the work. They need answering, not assuming.

1. **BYO-provider first, or the Postboi API first?**
   _Recommendation: BYO first._ It ships in a week with no compliance surface. Putting SMS
   on the Postboi provider means carrier contracts and 10DLC registration (see Phase 2) —
   weeks of not-code. Doing BYO first also proves the abstraction before we build a
   backend against it.

2. **Does `hooks.before.send` become channel-generic?**
   It's typed `{ provider: string; message: PreparedMessage }` today (`index.ts:413`) and
   is documented public API. Options:
   - (a) Widen to `{ channel: "email" | "sms" | "push"; message: PreparedMessage | PreparedSms | PreparedPush }`.
     Breaking — every existing hook that reads `message.subject` needs a narrow.
   - (b) Keep `before.send` email-only, add `before.sms` / `before.push` alongside.
     Non-breaking, but three near-identical hook trees and `notify()` has no single
     interception point.
   - _Recommendation: (a), with `channel` as the discriminant._ Pre-1.0 breaking changes
     are minor bumps per CLAUDE.md, and (b)'s duplication gets worse with every channel.
     Do it in Phase 0, before there's a second channel to migrate.

3. **Does `to: 447788223344` (a bare number) stay in the type?**
   It reads beautifully and it's what prompted this work, but a JS number silently loses
   the leading `+` and any leading `0` — `07788 223344` arrives as `7788223344`, and
   nothing downstream can tell a UK number from a US one.
   _Recommendation: accept it, normalise it, and fail loudly when we can't._ Strings pass
   through untouched. Bare numbers resolve against a default country
   (`POSTBOI_SMS_COUNTRY` / `default.country` in `postboi.config.ts`), and throw
   `PostboiError { code: "ambiguous_number" }` with a message naming both fixes when no
   default is set. Never guess a country.

4. **Package layout: flat `src/library/` or per-channel subdirectories?**
   Phase 1 alone adds 4–6 files to a directory that's already 50+. `exports.test.ts:32`
   asserts every non-internal `.ts` there has a `package.json` exports entry, so this is a
   real invariant, not just tidiness.
   _Recommendation: `src/library/sms/*` and `src/library/push/*`_, and update `to_source`
   (`exports.test.ts:11`) to handle the nesting. Email files stay put — moving them churns
   every import for no benefit.

5. **Is postboi still "an email library"?**
   README, docs, the site's tagline ("Send email from anywhere with zero configuration",
   `src/lib/config/navigation.ts:34`) and the domain all say email. `sms()` is the point
   where that stops being true. Positioning work, not engineering, but it blocks the
   release announcement rather than the code.

---

## Phase 0 — the `Transport` split

**No user-visible change. Everything below is cheaper once this lands.**

1. Extract the channel-agnostic members listed above into `abstract class Transport` in a
   new `src/library/transport.ts`.
2. `EmailProvider extends Transport` keeps the email-specific half.
3. `export { EmailProvider as ProviderBase }` from `index.ts` — existing providers and any
   third-party subclass keep working untouched.
4. Generalise `Hooks` per decision 2, adding `channel` to every hook context.
5. Move the SigV4 signer out of `ses.ts:146` into `src/library/aws.ts`, parameterised by
   service name — SES hardcodes `"ses"` at `ses.ts:181`, and AWS SNS (Phase 1) needs the
   same signer with `"sns"`.

**Tests:** the existing suite is the regression net — `provider.test.ts`, `providers.test.ts`,
`batch.test.ts`, `hooks.test.ts` all exercise the base class through real providers. If
they pass unchanged (bar the hook-context shape), the split is clean.

**Effort: 1–2 days.**

---

## Phase 1 — SMS, bring-your-own provider

### Types

```ts
/** A phone number: E.164 string, a bare number (normalised against the default country),
 *  or an object with a label for the dev inbox. */
export type Phone = string | number | { number: string; name?: string }

export interface SmsOptions {
	to?: Array<Phone> | Phone
	from?: string          // purchased number or alphanumeric sender ID
	message: string
	scheduled_at?: Date | string | Duration
	tags?: Array<string>
	idempotency_key?: string
}

export interface PreparedSms {
	to: Array<string>      // E.164, normalised
	from?: string
	message: string
	scheduled_at?: Date
	tags?: Array<string>
	idempotency_key?: string
}
```

`SmsProvider extends Transport` with the same three-hook contract as email
(`build_request` / `parse_response` / `parse_error`), plus `prepare_sms` doing E.164
normalisation, default merging and length/segment validation.

### Providers (each ~80 lines, same shape as `resend.ts`)

| Provider | Endpoint | Auth | Notes |
| --- | --- | --- | --- |
| Twilio | `POST https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json` | Basic (SID:token) | form-encoded, not JSON. `To`/`From`/`Body`. Scheduling via `ScheduleType=fixed` + `SendAt` (ISO 8601), requires `MessagingServiceSid`. |
| Vonage | `POST https://api.nexmo.com/v1/messages` | Bearer JWT (RS256) | JSON: `{ to, from, channel: "sms", message_type: "text", text }`. The JWT signer is new work — the legacy `POST https://rest.nexmo.com/sms/json` takes `api_key`/`api_secret` in the body and needs no signer. **Start with the legacy endpoint**; Messages API is a later upgrade. |
| AWS SNS | `POST https://sns.{region}.amazonaws.com/` (`Action=Publish`) | SigV4 | Free once `aws.ts` exists (Phase 0 step 5). No per-message sender ID in most regions. |
| MessageBird / Bird | `POST https://rest.messagebird.com/messages` | `Authorization: AccessKey {key}` | JSON, simplest of the lot. |
| Plivo | `POST https://api.plivo.com/v1/Account/{auth_id}/Message/` | Basic | JSON. |
| Telnyx | `POST https://api.telnyx.com/v2/messages` | Bearer | JSON. Cheapest per-segment of the group. |

_Ship Twilio + Vonage + SNS in Phase 1._ The rest are copy-paste once the shape is proven
and can land as follow-ups.

### Zero-config `sms()`

Mirrors `send_mail` (`mail.ts:182`):

- Its own `LOADERS` map keyed off `POSTBOI_SMS_PROVIDER`, falling back to
  `config.sms?.provider`.
- `sms_env_defaults()` alongside `env_defaults` (`env.ts:99`), reading `POSTBOI_SMS_FROM`
  and `POSTBOI_SMS_COUNTRY`.
- **Dev-inbox interception preserved.** `resolve_dev_inbox` (`mail.ts:70`) outranking a
  credentialled provider matters *more* for SMS than email — a stray dev send costs real
  money and reaches a real handset with no undo. Same rule: intercept in development
  unless `dev: { inbox: false }` or `POSTBOI_INBOX=off`.
- Same missing-credential behaviour: log-and-continue in development, throw in production.

### Cross-cutting checklist (every phase, every new module)

Adding a channel touches more than the provider file. This list is the actual cost:

- [ ] `package.json` `exports` entry per new module — enforced by `exports.test.ts:32`
- [ ] `registry.ts:33` — `PROVIDERS` gains a `channel: "email" | "sms" | "push"` field.
      It's `as const satisfies ReadonlyArray<ProviderMeta>` and drives both the CLI prompts
      *and* `resolve_provider`, so it can't drift. `find_provider` needs a channel argument
      or per-channel lookups.
- [ ] CLI: `bunx postboi init` gains a channel step; `DEFAULT_FIELDS`
      (`src/cli/providers.ts:19`) is email-shaped and needs an SMS set; `render_config`
      (`src/cli/providers.ts:41`) writes an `sms:` block.
- [ ] `config.ts:27` — `PostboiConfig` gains `sms?: { provider, default, … }` and
      `push?: { … }`. `merge()` (`config.ts:84`) needs the new keys deep-merged.
- [ ] Dev inbox: `SentMessage` (`mock.ts:16`) and `InboxMessage` (`inbox.ts:25`) are
      email-shaped. Add a `kind` discriminant, extend `Inbox.deliver` (`inbox.ts:55`), and
      give the inbox UI a second tab. This is the single biggest non-provider chunk of
      Phase 1 — budget for it properly.
- [ ] Mock provider: an SMS equivalent so tests and the log-in-dev fallback work.
- [ ] Docs: new `.svx` page in `src/lib/content/docs/`, entry in `contentSections`
      (`src/lib/config/navigation.ts:34`), and the section description updated.
- [ ] `llms.txt` / `llms-full.txt` regeneration.
- [ ] `skills/` — the shipped agent skill describes email only.

**Effort: ~1 week** (3 providers, resolver, mock, dev-inbox tab, CLI, docs).

---

## Phase 2 — SMS on the Postboi provider

The long pole, and **almost none of it is code**.

Code (~1 week in `postboi-app`):

- `/v1/sms` and `/v1/sms/batch` routes alongside `src/routes/v1/send`
- D1 migration: an `sms_messages` table, or a `channel` column on the existing messages
  table (the latter reuses the dashboard's message views and the LiveFeed DO for free)
- Delivery-receipt webhook ingestion, mirroring the SNS bounce/complaint path
- Dashboard UI, quota metering, per-destination pricing
- `postboi_provider.ts` gains an `sms` namespace, and `mail.ts`'s `lazy_namespace`
  (`mail.ts:249`) extends to it

Not code, and strictly blocking:

- An upstream carrier account and contract
- **10DLC / toll-free registration** (US) or per-country sender ID registration. Weeks of
  lead time, not days. Some countries require pre-registered sender IDs; some ban
  alphanumeric senders outright.
- **STOP / HELP keyword handling — legally mandatory**, not a feature. Needs an inbound
  webhook, a per-account suppression store, and enforcement on every send.
- Per-destination cost and billing (SMS pricing varies ~50× by country; flat-rate tiers
  don't survive contact with international traffic)
- **Fraud limits.** A leaked API token that can send SMS is a direct route to spending
  someone else's money in a way a leaked email token is not. Rate limits and anomaly
  detection are launch-blocking here, unlike for email.

_Recommendation: ship Phase 1 standalone, decide Phase 2 on demand._

**Effort: 1 week of code, gated behind weeks of compliance.**

---

## Phase 3 — Push

Structurally harder than SMS for one reason: **email addresses and phone numbers arrive
with the send; push tokens have to be registered and stored first.** That means a
subscription store and an API around it — surface area neither other channel needs.

### Web Push

- VAPID (RFC 8292) for auth, RFC 8291 `aes128gcm` payload encryption.
- Doable with WebCrypto only, no dependency: ECDH P-256 shared secret, HKDF, AES-128-GCM.
  Runs in Workers. `pushforge` is a good reference implementation for the exact byte
  layout. Payload cap is 3993 octets of plaintext.
- Needs a client-side helper wrapping `serviceWorker.pushManager.subscribe()`, which fits
  the existing `postboi/svelte` + `postboi/react` + `postboi/vue` + `postboi/astro` pattern.
- Endpoint is per-subscription (whatever the browser handed back) — no fixed base URL.

### FCM (Android)

- `POST https://fcm.googleapis.com/v1/projects/{project_id}/messages:send`
- Auth is an OAuth2 access token, minted by signing a service-account JWT (RS256) and
  exchanging it at `https://oauth2.googleapis.com/token`. Needs a token cache — the
  exchange is far too slow to do per-send.

### APNs (iOS)

- `POST https://api.push.apple.com/3/device/{token}`. APNs is HTTP/2-only and drops the
  connection outright on HTTP/1.1.
- **This is not the blocker it first looks like.** APNs needs plain unary
  request/response over HTTP/2, not bidirectional streaming, and both target runtimes
  negotiate that via ALPN already:
  - **Workers:** outbound `fetch()` speaks HTTP/2 to origins that require it, and APNs
    works in deployed Workers today. `@fivesheepco/cloudflare-apns2` is a zero-dependency
    Workers-native client and a good reference for the request shape.
  - **Node:** undici's `allowH2` now defaults to `true` ("Enables HTTP/2 support when the
    server assigns it a higher priority through ALPN negotiation"), so global `fetch`
    should negotiate h2 with APNs. **Verify empirically on the target Node version
    before relying on it** — the default flipped from `false` at some point and the
    global dispatcher's inheritance of it is worth one throwaway script. Fallback if it
    doesn't hold: `node:http2` behind a runtime check, or proxy through FCM.
- **Known gap: local development.** `wrangler dev` / workerd on macOS fails APNs requests
  while production succeeds — [workerd#4841](https://github.com/cloudflare/workerd/issues/4841),
  open since Aug 2025, no Cloudflare response. Doesn't block shipping, but it means the
  dev-inbox interception has to cover push properly, because a developer can't smoke-test
  APNs locally on a Mac.
- Token auth: ES256 JWT signed with the `.p8` key, refreshed hourly. WebCrypto does ES256,
  so no dependency on either runtime.

**Not our issue:** [workerd#6455](https://github.com/cloudflare/workerd/issues/6455) asks
for HTTP/2 *bidirectional streaming* (gRPC) in Workers. That's a different capability —
unary HTTP/2 already works, which is all APNs needs. Only relevant if postboi ever wants
a gRPC transport.

### The subscription store

`push()` needs somewhere to resolve "user 123" → tokens. Options: caller passes raw tokens
(simplest, punts the problem), or the Postboi provider grows a `push.subscriptions`
namespace next to `contacts`. Start with raw tokens; the namespace is Phase 2-shaped work.

**Effort: 1–2 weeks**, most of it Web Push encryption and the subscription store.

---

## Phase 4 — `notify()`

Thin once the channels exist. A fan-out over the per-channel resolvers reusing
`pooled_map`, returning per-channel results rather than rejecting wholesale — an SMS
failure must not lose the email. Two modes:

- **fan-out** (default): every channel in `to` gets it, results keyed by channel
- **fallback chain** (`channels: [...]`): first success wins, for OTPs and alerts

Shares `subject` / `message` / `body` across channels, with per-channel overrides for the
cases where the copy genuinely differs (SMS is 160 chars; email isn't).

**Effort: ~2 days.**

---

## Phase 5 — the other channels

Cheap, high value-per-line, all straight `Transport` subclasses with no new concepts:

- **Slack / Discord / Teams incoming webhooks** — one POST each, no auth beyond the URL.
  A couple of hours apiece and arguably the best return in this whole document.
- **Telegram** — bot API, one POST.
- **WhatsApp Business** — via Twilio (reuses the Twilio provider) or Meta directly.
  Template pre-approval is the real cost, same shape as 10DLC.
- **Voice / TTS** — a small extension of the Twilio and Vonage providers.
- **Fax** — genuinely still exists. Twilio killed theirs in 2021, but Documo and Phaxio
  are plain REST. ~80 lines, and mostly worth it for the README line.

---

## Risks

| Risk | Mitigation |
| --- | --- |
| The `Transport` split churns every provider file | Keep `ProviderBase` as an alias; the existing test suite is the regression net |
| `hooks.before.send` break lands badly | Do it in Phase 0 with one channel to migrate, not three. Pre-1.0 minor bump, documented in the changelog |
| Bare-number `to` guesses the wrong country | Never guess — throw `ambiguous_number` unless a default country is configured |
| A dev send reaches a real handset | Dev-inbox interception is not optional for SMS. Same precedence as email: inbox outranks a credentialled provider |
| Leaked token → real money | Phase 2 only. Rate limits are launch-blocking, unlike for email |
| The library sprawls | Per-channel subdirectories from the start (decision 4) |
| APNs can't be smoke-tested locally on macOS | workerd#4841 — production is fine. Make the dev inbox cover push properly |

---

## Upstream things to track

None of these block shipping — they're the "has this got better yet?" list to re-check
when a phase starts.

| What | Where | Why we care |
| --- | --- | --- |
| APNs over `fetch()` fails in local workerd on macOS (works in production) | [cloudflare/workerd#4841](https://github.com/cloudflare/workerd/issues/4841) — open, Aug 2025, no CF response | Closing it means push can be smoke-tested locally. Until then the dev inbox is the only local path |
| HTTP/2 bidirectional streaming (gRPC) in Workers | [cloudflare/workerd#6455](https://github.com/cloudflare/workerd/issues/6455) — open, Mar 2026, unlabelled | **Not needed for APNs.** Only if postboi ever wants a gRPC transport |
| undici `allowH2` default | [nodejs/undici](https://github.com/nodejs/undici) `docs/docs/api/Client.md` | Currently `true`. If it ever flips back, Node-side APNs needs a `node:http2` fallback |
| Workers runtime changes generally | [Workers changelog](https://developers.cloudflare.com/workers/platform/changelog/) | Protocol and API support moves without issue-tracker noise |

Watching the two workerd issues on GitHub is enough — neither has CF engagement yet, so a
notification on either is real signal.

## Effort summary

| Phase | Scope | Estimate | Blocked by |
| --- | --- | --- | --- |
| 0 | `Transport` split, generic hooks, `aws.ts` | 1–2 days | decision 2 |
| 1 | SMS, BYO providers | ~1 week | Phase 0, decisions 3 & 4 |
| 2 | SMS on the Postboi provider | ~1 week code | carrier + 10DLC + STOP handling |
| 3 | Push (Web Push, FCM, APNs) | 1–2 weeks | — |
| 4 | `notify()` | ~2 days | Phases 1 & 3 |
| 5 | Chat webhooks, WhatsApp, voice, fax | hours each | Phase 0 |

Phases 0, 1, 4 and 5 are ~2.5 weeks and need no external dependency. That's the
ship-it-first slice.
