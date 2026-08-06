# Postboi — Multi-channel Plan

Turning postboi from an email library into a messaging library: SMS first, then push
notifications, then a single import that fans out across channels.

Status: **planning**. Nothing here is built. This doc is the source of truth for the
channel work — read it before starting a phase, and update it when a decision changes.

---

## Decided

- **This is a pivot, not a side feature.** Postboi becomes a multi-channel messaging
  library that happens to have started with email — not an email library with extras.
  That settles the positioning question and reorders the work: the channel abstraction is
  the product, so `Transport` (Phase 0) is load-bearing rather than tidy-up.
- **Email stays the anchor.** It's the channel we're best at, the one the closest
  comparable doesn't have at all, and the one that needs no approval process to use.

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

## Positioning

The closest comparable is **[sent.dm](https://www.sent.dm/)** — "one API for SMS,
WhatsApp and RCS", with channel-availability detection, automatic fallback and
cost-optimised routing. Worth being precise about where we differ, because it decides
what's worth building.

**Where postboi is genuinely different:**

- **Email is first-class. sent.dm has none.** SMS + WhatsApp + RCS is a messaging product;
  email + SMS + push + chat in one call is a *notifications* product. That's the wedge —
  most apps need "tell this user something" across both worlds, and today that means two
  vendors.
- **Bring-your-own providers.** sent.dm is hosted-only at $0.015/contact/month plus carrier
  fees. Postboi runs in your process against your own Twilio/Resend/SES keys, with no
  per-contact tax and no lock-in. The hosted Postboi provider is an option, not the
  product.
- **It's a library, not a service.** Hooks, the dev inbox, zero-config env resolution,
  and it runs on Workers. None of that is available from a black-box API.

**Where they're ahead, and what it would take to match:**

- **Channel availability detection** ("can this contact receive WhatsApp?") needs a
  hosted backend with per-contact state. Library-side, we can't know.
- **Cost-optimised routing** needs live per-destination rate cards. Same constraint.
- **Delivery profiles / identity resolution** — their contact object stores channel
  preferences, availability, and last-contacted channel.

That last one is closer than it looks: the Postboi provider **already has `contacts`**
(`postboi_provider.ts:550`) — one contact per address, with `data` and list memberships.
Extending a contact to carry `phone`, `whatsapp`, and push tokens turns it into a delivery
profile, and `notify({ to: contact })` resolves channels from it. That's the natural home
for identity resolution, and it's Phase 2-shaped (hosted) work rather than library work.

**The honest read:** availability detection and cost routing are hosted-service features
we should not try to fake in a library. Fan-out and fallback (Phase 4) we can do locally
and well. Email + push is territory sent.dm isn't in at all.

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

5. ~~**Is postboi still "an email library"?**~~ **Decided: no** — see Decided, above.
   What that leaves is mechanical, and worth doing in one pass rather than drifting:
   README opener, the site tagline ("Send email from anywhere with zero configuration",
   `src/lib/config/navigation.ts:34`), the `docs` section description, `package.json`
   `keywords` (currently just `["svelte"]`), the shipped agent skill in `skills/`, and
   `llms.txt`. The domain and package name stay — `postboi` was never literally "mail".

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

Plus at least one **UK-native** provider, since UK traffic is 4–7× US and the UK-native
route is ~1.5× cheaper than Twilio there (see economics). Both candidates are plain REST
with GBP billing and free sender IDs:

| Provider | Endpoint shape | Why |
| --- | --- | --- |
| PureSMS | REST + API key | Cheapest verified UK flat rate (2.8p), no tiers or minimum |
| The SMS Works | REST + API key/JWT | Charges only for **delivered** messages — a genuinely better default, and a nice fit for our `BatchResult` reporting |

_Ship Twilio + one UK-native + AWS SNS in Phase 1._ Twilio because it's the one everyone
has heard of and every example uses; a UK-native because it's materially cheaper in our
home market; SNS because it's nearly free once `aws.ts` exists (Phase 0 step 5). Vonage and
the rest are copy-paste once the shape is proven and can land as follow-ups.

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
      (`src/cli/providers.ts:41`) writes an `sms:` block. For SMS the CLI should also ask
      for a **sender ID** and prompt by destination country — unlike email, the right
      provider depends on where you're sending (see onboarding friction).
- [ ] `registry.ts` entries for SMS want more than credentials: a `regions` hint, an
      indicative price, and a one-line "why you'd pick this", so `init` can recommend
      rather than just list. Prices go stale — carry a verified-on date and don't put
      them in code where they'll rot silently.
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

## SMS economics — can we be cheaper than sent.dm?

Short answer: **Phase 1 already is, by a lot, and a hosted Postboi SMS provider never
will be.** Those are two different findings and both change what's worth building.

### The cost floor

US 10DLC, per outbound segment, all-in (base + carrier surcharge):

| Route | Base | Carrier surcharge | All-in |
| --- | --- | --- | --- |
| Telnyx | $0.004 | $0.0035 (AT&T) – $0.0045 (T-Mo/VZ) | **~$0.0075–0.0085** |
| Plivo | ~$0.0055 | same | ~$0.009–0.010 |
| Twilio | $0.0079–0.0083 | $0.003–0.005 | **~$0.011–0.013** |

Plus non-per-message costs: number rental ~$1.15/mo, 10DLC brand registration $4 (sole
prop) to $48+ (standard), campaign registration ~$15 and ~$1.50–4/mo ongoing. Real cost
lands 1.5–2× the headline rate.

### The UK cost floor — and it's a different market

**UK SMS costs roughly 4–7× US SMS.** This is the single most important number in this
document for a UK-based business, and it inverts several conclusions.

Outbound, per message segment:

| Provider | Price | Notes |
| --- | --- | --- |
| **PureSMS** | **2.8p** + VAT | UK-native. Flat rate, no tiers, no minimum, no monthly, free sender ID |
| **Esendex** | from 2.4p | UK-native, but plans start at £54/mo — effective rate depends on volume |
| **The SMS Works** | from 3.1p + VAT (to ~4.4p) | UK-native. **Only charges for delivered messages** — refunds undelivered UK SMS, they claim ~8.9% average saving. Credits don't expire, no setup or monthly fee |
| **Twilio** | **$0.056** (~4.3p) | Their own GB pricing page. Short code $0.0524, but the short code itself is **$1,667/mo** |
| GoHighLevel (Twilio reseller) | $0.0524 | Corroborating datapoint, effective Aug 2025 |

Number rental (Twilio UK): local $1.15/mo, mobile $2.50/mo, **alphanumeric sender ID free**.
Inbound $0.0075.

Caveats on these figures: UK prices are quoted **ex-VAT** (20%; reclaimable for VAT-registered
businesses, so usually a wash, but it distorts headline comparisons). USD↔GBP conversions
above are approximate and move with FX — which is itself a point, since Twilio, ClickSend
and Plivo price UK traffic **in USD** and hand you the currency risk, where UK-native
providers bill in GBP. I could not get hard UK figures out of ClickSend or Vonage (their
pricing pages render rates client-side); those need a real quote.

**So: US all-in ~$0.008 (~0.6p) versus UK ~2.4–4.4p.** UK-native beats Twilio UK by roughly
1.5×, which is real but not the order-of-magnitude gap the US market has between wholesale
and retail.

#### What that does to the sent.dm comparison

Because UK traffic is so much more expensive, their $0.015/contact/month platform fee is
proportionally *less* punishing here — it's about half the cost of a single UK message,
versus roughly double a US one. Rerunning both scenarios at ~3p/message:

- **Transactional** — 100k users, 5k OTPs/month: sent.dm ~$1,690 (of which **$1,500 is
  platform fee on dormant contacts**) vs BYO ~$190. Still **~9× cheaper**.
- **Marketing** — 5k contacts × 20 messages: sent.dm ~$3,875 vs BYO ~$3,800. **~2%** — the
  fee is basically noise at that frequency.

The dormant-contact problem is what drives the whole gap, and it survives the move to UK
pricing intact.

#### And what it does to hosted SMS

It makes it **worse**, not better. At a 2.8p UK COGS, pricing for a 40% margin means ~4.7p
— when the developer could pay 2.8p going direct. That's ~70% above direct, against ~60%
in the US. A UK-based hosted SMS product is the least attractive version of this business.

### sent.dm's model, converted to a per-message fee

They charge **$0.015 per contact per month, plus carrier fees**. The platform fee is a
per-contact subscription, so its effective per-message cost depends entirely on how often
you message a contact — and **dormant contacts cost the same as active ones**:

| Messages per contact per month | Effective platform fee per message |
| --- | --- |
| 1 | $0.015 — roughly 2× the entire wholesale cost of the message |
| 5 | $0.003 |
| 20 | $0.00075 |
| 0 (dormant) | $0.015, for nothing |

Worked both ways:

- **Transactional / OTP** — 100,000 registered users, 5,000 OTPs a month.
  sent.dm: 100,000 × $0.015 = **$1,500/mo** platform fee, plus ~$40 of traffic.
  BYO Telnyx through postboi: **~$40/mo total, $0 to us.** ~38× cheaper.
- **Marketing** — 5,000 engaged contacts, 20 messages each (100,000 messages).
  sent.dm: $75 platform + ~$800 traffic = ~$875. BYO: ~$800. Only ~9% cheaper.

Their pricing is built for high-frequency sending to a small engaged list. It is
punishing for transactional sending against a large mostly-dormant user base — which is
exactly postboi's audience.

### What that means

1. **Phase 1 is the whole competitive answer, and it needs no backend.** Bring-your-own
   provider means our platform fee is **$0** — not "cheaper", but *not charged at all*.
   For any transactional use case that beats sent.dm by an order of magnitude, and it
   ships in a week.
2. **Hosted SMS cannot win on price.** Our COGS is roughly what a developer pays going
   direct to Telnyx. Pricing for even a 40% margin lands ~$0.013–0.015/message — *above*
   what they'd pay themselves. So hosted SMS would sell on **setup time** (skipping 10DLC
   registration, which is weeks of genuine pain), unified billing alongside email, and
   delivery profiles. Never on being cheap. If we can't tell that story, don't build it.
3. **SMS cannot ride the email tier model.** SES costs $0.0001/email; SMS costs ~$0.008 —
   **~80× higher COGS**. The Starter tier in the app's PLAN.md is £9/mo for 20,000 emails
   (~$2 COGS, ~72% margin). Twenty thousand *SMS* would be ~$160 of COGS: that tier would
   lose ~$150/month per customer. Hosted SMS must be metered separately.
4. **Prepaid credits, not post-paid metering.** SMS pumping / AIT is the reason: OTPs are
   ~89% of international A2P traffic and the primary attack surface, AIT is estimated at
   5–40% of international A2P volume and cost businesses ~$1.6bn in 2023 (X reportedly
   lost $60M/yr). A leaked token on a post-paid account means **we** eat the bill.
   Prepaid caps the blast radius structurally rather than relying on detection. Pair it
   with country allowlisting by default, since IRSF targets expensive destinations.

### If we became the SMS provider ourselves, what could we get per message?

**UK answer: ~2.0–2.2p at absolute best, ~2.4–2.6p realistically — against 2.8p a
developer pays PureSMS today with no commitment.** There is a hard regulated-ish floor and
it is most of the retail price.

#### The floor is the MNO termination fee, and it's now fixed until 2028

UK mobile networks charge a **termination fee** to deliver each A2P message. That is paid
to the terminating operator, so no amount of scale competes it away — it is not aggregator
margin.

- Wholesale A2P termination rose **15–75% since 2021** (some cases ~70%), which triggered
  an Ofcom market review.
- Ofcom's **March 2025 consultation proposed a cap of 1.96p per SMS** — their own
  cost-based view of a fair rate.
- Ofcom then **accepted voluntary commitments instead of formal regulation** (statement
  Oct/Nov 2025), from **BT/EE, Sky, Virgin Media O2 and VodafoneThree** — over **90% of
  A2P SMS sold to aggregators**. They run **1 Jan 2026 → 31 Dec 2028** and cap the maximum
  standard price, limit rises to once per 12 months, and require 60 days' notice (up from
  30) plus pre-notification to Ofcom.
- **The agreed maximum prices are redacted.** Market evidence puts the range at roughly
  **2.00p–2.80p** across operators.

So the floor is ~2.0–2.8p, and **PureSMS at 2.8p and Esendex from 2.4p are already selling
at or very near termination cost.** There is almost nothing between their retail price and
what the networks charge them.

#### The three routes down, and where each lands

| Route | Realistic cost/msg | What it costs to get there |
| --- | --- | --- |
| Resell a CPaaS (what Phase 1 users already do) | 2.8p–4.3p | Nothing. And no better than our own customers get |
| Wholesale aggregator with volume commitment | ~2.2–2.6p | Minimum monthly commitments — infrastructure platforms quote **2M SMS/month**, or ~**800k/month** for "micro aggregator" status |
| Direct MNO SMPP connections | ~2.0–2.8p (the termination rate itself) | Four separate commercial relationships (BT/EE, VMO2, VodafoneThree, Sky), SMPP infrastructure, credit-worthy counterparty status, and enough volume for them to take the meeting |

#### Why that doesn't make a business

Best case is **~0.6–0.8p of gross margin per message** (2.0–2.2p cost against 2.8p that a
developer can already get themselves), so **~25% gross at the very best** — before
compliance, fraud, and 24/7 operations.

The volume commitment is the killer. At the ~800k/month micro-aggregator floor we'd be
committing to roughly **£22k/month of traffic before having a single customer**, to earn
~£5.6k/month of gross profit if we filled it completely.

Set against email, where SES costs $0.0001 and the app's tiers sell at ~$0.0004–0.0005 for
**60–75% margins, with no minimum commitment and no carrier infrastructure**, this is a
categorically worse business.

#### Two things that could change the answer

- **The US is a much better market for this than the UK.** US wholesale is ~$0.008 all-in
  against ~$0.012 Twilio retail — a genuine ~1.5× spread to capture, because US termination
  surcharges ($0.0035–0.0045) are a far smaller share of the retail price than UK
  termination is. If hosted SMS is ever worth doing, it's a US play. We are, ironically,
  based in the wrong country for it.
- **The commitments expire 31 December 2028.** Rates could move after that, in either
  direction. Worth a diary note rather than a plan.

**Bottom line: UK SMS is commodity pass-through with a regulated floor. The margin lives in
the platform above the transport, not in the transport.** If we ever ship hosted SMS, price
it as convenience bundled alongside email — never as a margin business — and be honest in
the docs that BYO is cheaper.

### Can we use a cheap US provider to message UK/EU numbers?

**No. SMS is priced by destination, not origin** — "the price of sending an SMS message is
based on the country in which the message recipient is located". Twilio's GB page
($0.056) *is* what a US Twilio account pays to message a UK number. The fee being paid is
the UK network's termination charge, so account location, company HQ and sending number
country are all irrelevant to it. There is no arbitrage here.

The three things that look like they'd get around it are each worse:

1. **Sending from a US long code to UK/EU numbers.** Cross-border long code sending is
   restricted by providers (Twilio documents e.g. Australian numbers being unable to
   long-code to the US), short codes are domestic-only, deliverability suffers, and the
   recipient sees a `+1` number that reads as spam and can't usefully be replied to.
2. **Alphanumeric sender IDs — this one is decisive, and it runs backwards.**
   Alphanumeric senders are **not supported in the US or Canada at all**; those markets
   require 10DLC, toll-free or short codes. Alphanumeric is exactly the free, no-number
   option that makes UK/EU sending good. So a US-centric provider setup is **worse
   equipped for UK sending, not cheaper**.
3. **Grey routes** — the actual "cheap international route" on offer in this market. They
   bypass commercial A2P agreements by disguising A2P traffic as P2P to dodge termination
   fees, and they cost MNOs ~$7.7bn a year (~$37bn cumulative 2020–24). Operators now run
   SMS firewalls doing real-time traffic classification and spoofed-sender detection, so
   the practical result is unreliable delivery, missing or fabricated DLRs, rewritten
   sender IDs, and eventual cut-off. **Not viable for anything that sells reliability.**

#### EU is worse than the UK, not better

Western Europe is the most expensive SMS region in the world. Netherlands, Belgium and
Germany can exceed **$0.09 per single-segment message**; Switzerland, France, Germany and
the Netherlands top the table. The drivers are the same as the UK's — high carrier
termination, fragmented markets, two or three dominant carriers per country. For contrast,
the US, Canada, India and Brazil often sit under $0.02.

Note the EU's intra-EU price cap (6c + VAT per SMS) is **consumer-only** — business/A2P
traffic is explicitly excluded, so it doesn't help us.

EU also adds per-country sender ID **pre-registration**: France requires it, Spain and
Australia were added in 2026, and the list is longer. Unregistered traffic into those
markets gets content-filtered rather than cleanly rejected, which is worse — it fails
quietly.

⚠️ **Unresolved:** sources disagree on whether the **UK** belongs on that mandatory
pre-registration list. Ofcom declined to mandate registration and the MEF registry is
voluntary (see onboarding friction below), but at least one provider's compliance guide
lists the UK as pre-registration required. These are probably describing different layers
— regulator versus individual carrier/aggregator practice — but **get a definitive answer
from whichever provider we ship before writing it into the docs.**

#### What this actually changes

The cost problem is structural and geographic, and no routing trick touches it. That
pushes in two directions:

- **It makes BYO more right, not less.** Route quality and price to a given destination is
  exactly the thing a customer should be able to choose, and exactly the thing we'd be
  guessing at on their behalf.
- **It gives `notify()` a genuinely useful job.** For expensive destinations, prefer push,
  WhatsApp or email and fall back to SMS only when nothing else can reach the user. That
  is real cost optimisation, and unlike sent.dm's live rate-card routing **we can do it in
  a library**, because the channel ordering is a per-send policy decision rather than
  something requiring live wholesale pricing. Worth designing into Phase 4's fallback
  chain: order by cost-class, not just availability.

### Onboarding friction — is BYO actually "get a token and go"?

The fair worry about bring-your-own-provider is that a developer doesn't know which
providers exist, and that SMS setup is heavier than email's paste-an-API-key. **In the UK
it very nearly is that easy. In the US it genuinely isn't** — and that distinction is
geographic, not intrinsic.

**UK — close to email-grade:**

- **Alphanumeric sender IDs are free.** Twilio's own GB page lists them at no cost against
  $2.50/mo for a mobile number. No number to buy.
- **No mandatory registration.** Ofcom considered mandating A2P sender ID registration and
  explicitly declined (Nov 2025 U-turn), on the grounds it would impose set-up and ongoing
  costs on brands. The MEF **SMS SenderID Protection Registry is voluntary** and paid.
- So the flow is: sign up → API key → choose an 11-character sender ID → send. **One extra
  decision versus email**, and it's a string.

Real UK caveats, all small:

- 11 characters max, GSM charset, no spaces.
- **One-way only.** Recipients cannot reply to an alphanumeric sender — most handsets show
  "can't reply to this shortcode". Fine for OTPs and alerts; two-way needs a virtual mobile
  number (~$2.50/mo).
- Sender IDs must be **brand-recognisable**; generic ones get blocked.
- Some networks and providers still ask you to pre-register the sender ID. Where they do
  it's **1–14 days**, not weeks.
- There's a confidential restricted-sender-ID list; hitting it means silent non-delivery.

**US — this is where the friction lives:** 10DLC brand registration ($4 sole proprietor,
$48+ standard), campaign registration (~$15 plus $1.50–4/mo), number rental ~$1.15/mo, and
weeks of lead time before the first message sends.

**The "I wouldn't know what providers exist" problem is ours to solve, and we already have
the machinery.** `registry.ts` drives `bunx postboi init` with each provider's name, its
credentials URL, and its required fields — that's exactly the discovery problem, already
solved for email. For SMS we can go further and be *opinionated*, because unlike email the
right answer depends on where you're sending:

```
$ bunx postboi init --sms
? Where are you sending?  › United Kingdom
? Provider:
  ❯ PureSMS        2.8p/msg   UK-native · flat rate · no minimum
    The SMS Works  3.1p/msg   UK-native · only charges for delivered
    Twilio        ~4.3p/msg   global · the most examples and docs
? Sender ID (11 chars, what recipients see)  › POSTBOI
```

That is better UX than either a bare library or a hosted black box: it names the tradeoff
instead of hiding it. It also means **the registry should carry per-country guidance**, not
just credentials — a `regions` hint and a one-line "why you'd pick this".

Worth noting the market moves: **Textlocal was fully decommissioned in November 2025** and
is no longer taking signups. Whatever we recommend needs a freshness check before shipping,
and the docs page should carry a "verified as of" date rather than pretending prices are
stable.

**Recommendation: ship Phase 1, do not build Phase 2 until there is demand pull for it.**
The pricing analysis says the hosted provider is a convenience product with thin margins
and a fraud tail, competing against a free option we ship ourselves. That is a much worse
business than hosted email, and the plan should stop assuming it follows automatically.

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

_Recommendation: ship Phase 1 standalone, decide Phase 2 on demand._ See the economics
section above — the pricing case for this phase is weak, and it should not be treated as
an automatic follow-on from Phase 1 the way hosted email was.

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
- **fallback chain** (`channels: [...]`): first success wins, for OTPs and alerts.
  **Order by cost-class, not just availability** — SMS to Western Europe can be 100×
  the cost of a push notification carrying the same words, so "push, then WhatsApp, then
  SMS" is a real optimisation rather than a preference. This is the one piece of
  cost-aware routing a library can honestly do (see the destination-pricing section).

Shares `subject` / `message` / `body` across channels, with per-channel overrides for the
cases where the copy genuinely differs (SMS is 160 chars; email isn't).

**Design for template-only channels up front**, even though WhatsApp lands in Phase 6.
Some channels cannot accept free-form text at arbitrary times (see the 24-hour window
there), so `notify()` needs either a per-channel template mapping or a rule that a
channel refusing free-form content triggers the fallback rather than an error. Retrofitting
that into a shipped `notify()` is far worse than allowing for it now.

**Effort: ~2 days.**

---

## Phase 5 — chat channels (no approval needed)

Cheap, high value-per-line, all straight `Transport` subclasses with no new concepts:

- **Slack / Discord / Teams incoming webhooks** — one POST each, no auth beyond the URL.
  A couple of hours apiece and arguably the best return in this whole document.
- **Telegram** — `POST https://api.telegram.org/bot{token}/sendMessage` with
  `{ chat_id, text }`. No approval, no registration, genuinely trivial.
  **But:** the recipient must have started a chat with your bot first, and you address
  them by `chat_id`, not by anything you can know in advance. Same registered-identity
  problem as push tokens — plan it alongside the subscription store, not alongside SMS.

**Effort: hours each.** These are the ones to ship first after Phase 1, because they cost
almost nothing and make `notify()` immediately worth having.

---

## Phase 6 — WhatsApp and RCS (the approval-gated tier)

These are the channels sent.dm leads with, and they are **not** the cheap tier. Both need
brand approval before a single message sends, and WhatsApp imposes a constraint that
reshapes the API rather than sitting behind it.

### WhatsApp

Two routes: Meta's Cloud API directly
(`POST https://graph.facebook.com/v{version}/{phone_number_id}/messages`, Bearer token),
or via Twilio using `whatsapp:+44…` prefixed `To`/`From` — which reuses the Phase 1 Twilio
provider almost entirely and is the cheaper way in.

**The constraint that matters:** WhatsApp has a **24-hour customer service window**, opened
when the user last messaged or called you and reset by each new inbound message. Inside it
you may send free-form text. **Outside it you may only send pre-approved templates** —
free-form sends are rejected. Most transactional sends (order shipped, OTP, appointment
reminder) happen outside any window, so *template-only is the normal case, not the edge*.

This breaks the `message: string` shape that SMS, push and chat all share:

```ts
await whatsapp({
	to: "+447788223344",
	template: "order_shipped",           // pre-approved with Meta, by name
	variables: { name: "Ada", tracking: "AB123" },
})
```

So `PreparedWhatsApp` is template-shaped, and **`notify()` must handle "this channel can
only send a template right now"** — either by requiring a template mapping per channel, or
by treating a window-closed WhatsApp send as a fallback trigger rather than an error. Worth
settling in Phase 4's design even though WhatsApp lands later.

Pricing is per delivered template since July 2025, by category (marketing / utility /
authentication) and recipient country. Utility templates and service messages inside the
window are free today, but **that ends 1 October 2026** — relevant if we ever meter it.

### RCS

Now genuinely viable: Android throughout, plus iOS 18.1+ (2024), and Twilio took it
generally available in August 2025 across all accounts via Programmable Messaging. Brand
and sender verification is configured in the Twilio console rather than in code, so the
provider itself is thin — it's the same Twilio messaging endpoint with an RCS-capable
sender.

The genuinely useful property is **automatic upgrade**: send to a number, get RCS where
the handset supports it and SMS where it doesn't, with branding and read receipts on the
RCS path. That's channel fallback the carrier does for us, and it's the cheapest possible
version of what sent.dm sells.

_Recommendation: RCS before WhatsApp._ It's a thinner provider, has no window semantics to
model, and rides Phase 1's Twilio work.

**Effort: ~3 days RCS, ~1 week WhatsApp**, both gated behind brand approval lead time.

### Deliberately not doing

- **iMessage** — Apple Messages for Business is approval-gated, enterprise-shaped, and has
  no general send API. Revisit only if Apple opens it up.
- **Voice / TTS** — a small extension of the Twilio and Vonage providers if ever wanted.
  Not a notification channel in the sense the rest of this doc means.
- **Fax** — genuinely still exists (Twilio killed theirs in 2021; Documo and Phaxio are
  plain REST, ~80 lines). Worth it for the README line and nothing else. Not scheduled.

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
| `notify()` ships assuming free-form text, then WhatsApp needs templates | Design the template path into Phase 4, build it in Phase 6 |
| Chasing sent.dm's routing/availability features into a library that can't have them | Those need hosted per-contact state. Extend the existing `contacts` namespace if we want them, don't fake them client-side |

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
| UK A2P SMS termination rates | [Ofcom A2P SMS termination market](https://www.ofcom.org.uk/phones-and-broadband/mobile-phones/a2p-sms-termination-market) | The MNO commitments expire **31 Dec 2028**. They set the floor under every UK SMS price, ours included |

Watching the two workerd issues on GitHub is enough — neither has CF engagement yet, so a
notification on either is real signal.

## Effort summary

| Phase | Scope | Estimate | Blocked by |
| --- | --- | --- | --- |
| 0 | `Transport` split, generic hooks, `aws.ts` | 1–2 days | decision 2 |
| 1 | SMS, BYO providers | ~1 week | Phase 0, decisions 3 & 4 |
| 2 | SMS on the Postboi provider | ~1 week code | carrier + 10DLC + STOP handling — **and a business case; see economics** |
| 3 | Push (Web Push, FCM, APNs) | 1–2 weeks | — |
| 4 | `notify()` | ~2 days | Phases 1 & 3 |
| 5 | Slack / Discord / Teams / Telegram | hours each | Phase 0 |
| 6 | RCS, then WhatsApp | ~3 days + ~1 week | brand approval lead time |

Phases 0, 1, 4 and 5 are ~2.5 weeks and need no external dependency. **That's the
ship-it-first slice** — and with email already in place it's a more complete notifications
story than the SMS-only comparables on day one.

Phase 5 is deliberately ordered before the flashier Phase 6: Slack and Telegram cost hours
and make `notify()` immediately useful, while WhatsApp and RCS can't send anything until
someone else approves a brand.
