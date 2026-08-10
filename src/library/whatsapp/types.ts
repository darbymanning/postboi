/**
 * The WhatsApp channel's public types.
 *
 * Free of runtime imports so the package root can widen `Hooks` to include
 * {@link PreparedWhatsapp} without pulling a WhatsApp provider into the email module graph.
 *
 * The shape that makes WhatsApp unlike SMS: the **24-hour customer service window**. A
 * business may send free-form text only within 24 hours of the user's last inbound
 * message; outside it, only pre-approved **templates**. Most transactional sends happen
 * outside any window, so the template path is the normal case, not the fallback — which
 * is why `template` sits beside `message` rather than buried in provider options.
 */
import type { TransportOptions } from "../transport.js"
import type { Phone } from "../sms/types.js"
import type { TemplateVariables, WhatsappTemplate } from "../index.js"

export type { Phone } from "../sms/types.js"

/** Default values applied to every WhatsApp send when the option is omitted. */
export type WhatsappDefaults = {
	to?: Phone
	/**
	 * Your WhatsApp sender number in E.164 (Twilio; the `whatsapp:` prefix is added for
	 * you). The Meta Cloud API ignores this — there the sender is the `phone_number_id`
	 * the provider is constructed with.
	 */
	from?: string
	/**
	 * Country used to resolve national-format numbers — an ISO 3166-1 alpha-2 code (`"GB"`)
	 * or a dialling code (`"+44"`). Without it, anything that isn't already international
	 * is rejected rather than guessed at.
	 */
	country?: string
	/**
	 * Template language code (`"en"`, `"en_GB"`, …) — must match a language the template
	 * was approved in. Meta only; defaults to `"en"`.
	 */
	language?: string
}

/**
 * Options accepted by `whatsapp(...)` and every WhatsApp provider's `send`.
 *
 * The type parameter is the template being sent, inferred from `template` — it's what
 * lets `variables` know which placeholders that particular template takes, and whether it
 * needs any at all. Left alone it behaves exactly as an ungenericised version would, so
 * `Partial<WhatsappOptions>` and friends need no ceremony.
 *
 * Named keys for templates approved with named parameters (`{ name: "Ada" }`), numeric
 * keys for positional ones (`{ 1: "Ada" }`) — the same shape either way.
 */
export type WhatsappOptions<T extends WhatsappTemplate = WhatsappTemplate> = WhatsappFields<T> &
	VariablesField<T>

/**
 * `variables`, required exactly when the template is known to declare placeholders.
 * Forgetting them altogether is the commonest way a template send fails, so a synced
 * template asks for them up front — while an unsynced one (`keyof` is the open `string`)
 * and a placeholder-free one both stay optional.
 */
type VariablesField<T extends WhatsappTemplate> = string extends keyof TemplateVariables<T>
	? { variables?: TemplateVariables<T> }
	: keyof TemplateVariables<T> extends never
		? { variables?: TemplateVariables<T> }
		: { variables: TemplateVariables<T> }

/**
 * The values for one template component. Whether a template's placeholders are numbered
 * (`{{1}}`) or named (`{{name}}`) is fixed when it's approved and applies to the whole
 * template, so the key shape you use is really you declaring which kind it is.
 *
 * A component with a single slot — a text header, a URL button — takes the value on its
 * own, since on a numbered template there's no name to key it by. Named templates still
 * need the map: the header's placeholder has its own name, and nowhere else to put it.
 */
export type TemplateValues = string | Record<string, string>

/** Every WhatsApp send field except `variables` — see {@link WhatsappOptions}. */
export interface WhatsappFields<T extends WhatsappTemplate = WhatsappTemplate> {
	to?: Phone
	/** Sender override (Twilio). See {@link WhatsappDefaults.from}. */
	from?: string
	/**
	 * Free-form text. **Only deliverable inside the 24-hour customer service window** —
	 * outside it the provider rejects with `code: "outside_window"`, which a `send()`
	 * fallback chain treats as "try the next channel".
	 */
	message?: string
	/**
	 * A pre-approved template, by the name it was approved under (Meta) or its Content
	 * SID, `HX…` (Twilio). The deliverable-anytime path. Exactly one of `message` or
	 * `template` per send.
	 *
	 * `bunx postboi sync` narrows this to your approved templates — see
	 * {@link WhatsappTemplate}.
	 */
	template?: T
	/**
	 * The variable in the template's header, when it has one (Meta only — Twilio numbers
	 * every placeholder in one namespace, so on Twilio they all go in `variables`). A text
	 * header takes at most one, hence the bare `header: "#1234"`.
	 *
	 * Templates approved with *named* parameters need the placeholder's own name, which the
	 * header has independently of the body — pass `{ membershiptype: "Gold" }` for those.
	 */
	header?: TemplateValues
	/**
	 * Variables for the template's dynamic buttons, one entry per button in the order they
	 * were approved (Meta only). A URL button's variable fills the tail of its link, and
	 * takes exactly one value — `buttons: ["orders/1234"]`, or the named form as with
	 * {@link WhatsappFields.header}.
	 */
	buttons?: Array<TemplateValues>
	/** Template language code for this send (Meta). */
	language?: string
	/** Override the default country for a national-format number in this send. */
	country?: string
}

/** A fully-resolved WhatsApp message handed to a provider's `build_request`. */
export interface PreparedWhatsapp {
	/** The recipient in E.164 form (`+447788223344`) — provider prefixes are added later. */
	to: string
	from?: string
	message?: string
	template?: string
	variables?: Record<string, string>
	header?: TemplateValues
	buttons?: Array<TemplateValues>
	language: string
}

/** Constructor options shared by every WhatsApp provider. */
export type WhatsappProviderOptions = TransportOptions<PreparedWhatsapp> & {
	/** Default field values applied when a send omits them. */
	default?: WhatsappDefaults
}
