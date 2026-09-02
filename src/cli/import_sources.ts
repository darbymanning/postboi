/**
 * The ESPs `postboi import` can read, and how each one's records map onto ours.
 *
 * Every adapter is **pure**: it says which requests to make and turns a page of the
 * source's JSON into our shape. The command drives it. That split is what makes this
 * testable against recorded payloads rather than against somebody's live account, and
 * it is why the mapping decisions — which field is the name, what a tag is called, what
 * counts as unsubscribed — are readable in one file instead of buried in a fetch loop.
 *
 * The source key never leaves the machine this runs on. It is used to call the source's
 * own API directly and is never sent to Postboi, which is the whole reason this is a
 * local CLI command and not a hosted importer.
 */

/** One contact, as we will send it to `/v1/lists/<name>/recipients`. */
export interface ImportedContact {
	email: string
	name?: string
	data?: Record<string, string>
	tags?: Array<string>
	/** Only ever `subscribed` or `pending`; everything else becomes a suppression. */
	status: "subscribed" | "pending"
}

/** An address the source says not to mail, and why as near as it can be mapped. */
export interface ImportedSuppression {
	email: string
	reason: "unsubscribe" | "bounce" | "complaint"
}

/** What one page of a source's contacts yielded, and how to ask for the next. */
export interface ImportPage {
	contacts: Array<ImportedContact>
	suppressions: Array<ImportedSuppression>
	/** Opaque, passed back to `page()`; absent when the walk is done. */
	cursor?: string
}

export interface ImportRequest {
	url: string
	headers: Record<string, string>
}

export interface ImportSource {
	/** What the `--from` flag names it, and what the help calls it. */
	label: string
	/** The environment variable checked when `--key` isn't given. */
	env: string
	/** What a key for this source looks like, for the "that isn't one" message. */
	key_hint: string
	/** Anything else the source needs from the user — Mailchimp's data centre, say. */
	needs?: { flag: string; hint: string }
	/** The request for one page. `cursor` is whatever the last page returned. */
	page(key: string, cursor: string | undefined, extra: string | undefined): ImportRequest
	/** That page's body, mapped. `cursor` is the one the page was fetched with, so an
	 * offset-paged source can work out the next one without the driver knowing how. */
	read(body: unknown, cursor: string | undefined): ImportPage
}

/** Every string value of an object, flattened for `data` — arrays joined, the rest dropped. */
function fields(source: unknown, skip: Array<string> = []): Record<string, string> {
	const out: Record<string, string> = {}
	if (!source || typeof source !== "object" || Array.isArray(source)) return out
	for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
		if (skip.includes(key)) continue
		if (typeof value === "string" && value.trim()) out[key.toLowerCase()] = value.trim()
		else if (typeof value === "number" || typeof value === "boolean")
			out[key.toLowerCase()] = String(value)
		else if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
			if (value.length > 0) out[key.toLowerCase()] = value.join(", ")
		}
	}
	return out
}

/** A name out of whatever the source calls the halves of one. */
function full_name(first: unknown, last: unknown, whole?: unknown): string | undefined {
	if (typeof whole === "string" && whole.trim()) return whole.trim()
	const parts = [first, last].filter(
		(part): part is string => typeof part === "string" && !!part.trim()
	)
	return parts.length > 0 ? parts.join(" ").trim() : undefined
}

/** Mailchimp: `https://<dc>.api.mailchimp.com/3.0/lists/<id>/members`, key `…-us14`. */
const mailchimp: ImportSource = {
	label: "Mailchimp",
	env: "MAILCHIMP_API_KEY",
	key_hint: "a Mailchimp key ends in its data centre, like abc123…-us14",
	needs: { flag: "list", hint: "the Mailchimp audience id (Audience → Settings → Audience ID)" },
	page(key, cursor, extra) {
		// The data centre is the suffix of the key itself, so nobody has to be asked for it.
		const dc = key.split("-").pop() ?? "us1"
		const offset = Number(cursor ?? 0)
		return {
			url: `https://${dc}.api.mailchimp.com/3.0/lists/${encodeURIComponent(extra ?? "")}/members?count=1000&offset=${offset}`,
			// Mailchimp's documented scheme: any username, the key as the password.
			headers: { authorization: `Basic ${btoa(`postboi:${key}`)}` },
		}
	},
	read(body, cursor) {
		const page = body as {
			members?: Array<{
				email_address?: string
				status?: string
				merge_fields?: Record<string, unknown>
				tags?: Array<{ name?: string }>
			}>
			total_items?: number
		}
		const members = page.members ?? []
		const contacts: Array<ImportedContact> = []
		const suppressions: Array<ImportedSuppression> = []
		for (const member of members) {
			const email = typeof member.email_address === "string" ? member.email_address : ""
			if (!email) continue
			// cleaned = hard-bounced. Mailchimp's own words, mapped to ours.
			if (member.status === "unsubscribed") {
				suppressions.push({ email, reason: "unsubscribe" })
				continue
			}
			if (member.status === "cleaned") {
				suppressions.push({ email, reason: "bounce" })
				continue
			}
			const merge = member.merge_fields ?? {}
			contacts.push({
				email,
				name: full_name(merge.FNAME, merge.LNAME),
				data: fields(merge, ["FNAME", "LNAME", "EMAIL"]),
				tags: (member.tags ?? [])
					.map((tag) => tag.name)
					.filter((name): name is string => typeof name === "string"),
				status: member.status === "pending" ? "pending" : "subscribed",
			})
		}
		// Offset paging: a short page is the last one, and the next offset is this one
		// plus everything this page held — including the rows that became suppressions,
		// which is why it counts `members` and not `contacts`.
		return {
			contacts,
			suppressions,
			cursor: members.length === 1000 ? String(Number(cursor ?? 0) + members.length) : undefined,
		}
	},
}

/** Kit (formerly ConvertKit): `https://api.kit.com/v4/subscribers`, cursor-paged. */
const kit: ImportSource = {
	label: "Kit",
	env: "KIT_API_KEY",
	key_hint: "a Kit v4 API key, from Settings → Developer",
	page(key, cursor) {
		const after = cursor ? `&after=${encodeURIComponent(cursor)}` : ""
		return {
			url: `https://api.kit.com/v4/subscribers?per_page=500${after}`,
			headers: { "X-Kit-Api-Key": key },
		}
	},
	read(body) {
		const page = body as {
			subscribers?: Array<{
				email_address?: string
				first_name?: string
				state?: string
				fields?: Record<string, unknown>
			}>
			pagination?: { has_next_page?: boolean; end_cursor?: string }
		}
		const contacts: Array<ImportedContact> = []
		const suppressions: Array<ImportedSuppression> = []
		for (const subscriber of page.subscribers ?? []) {
			const email = typeof subscriber.email_address === "string" ? subscriber.email_address : ""
			if (!email) continue
			// Kit's `cancelled` is an unsubscribe; `bounced` and `complained` are its own words.
			if (subscriber.state === "cancelled" || subscriber.state === "unsubscribed") {
				suppressions.push({ email, reason: "unsubscribe" })
				continue
			}
			if (subscriber.state === "bounced") {
				suppressions.push({ email, reason: "bounce" })
				continue
			}
			if (subscriber.state === "complained") {
				suppressions.push({ email, reason: "complaint" })
				continue
			}
			contacts.push({
				email,
				name: full_name(subscriber.first_name, undefined),
				data: fields(subscriber.fields),
				status: subscriber.state === "inactive" ? "pending" : "subscribed",
			})
		}
		return {
			contacts,
			suppressions,
			cursor: page.pagination?.has_next_page ? page.pagination.end_cursor : undefined,
		}
	},
}

/** Loops: `https://app.loops.so/api/v1/contacts/…`, bearer key. */
const loops: ImportSource = {
	label: "Loops",
	env: "LOOPS_API_KEY",
	key_hint: "a Loops API key, from Settings → API",
	page(key, cursor) {
		return {
			url: `https://app.loops.so/api/trpc/lists.export?cursor=${encodeURIComponent(cursor ?? "")}`,
			headers: { authorization: `Bearer ${key}` },
		}
	},
	read(body) {
		const page = body as {
			contacts?: Array<{
				email?: string
				firstName?: string
				lastName?: string
				subscribed?: boolean
				userGroup?: string
				[key: string]: unknown
			}>
			cursor?: string
		}
		const contacts: Array<ImportedContact> = []
		const suppressions: Array<ImportedSuppression> = []
		for (const contact of page.contacts ?? []) {
			const email = typeof contact.email === "string" ? contact.email : ""
			if (!email) continue
			// Loops has one flag rather than a state machine: not subscribed means don't mail.
			if (contact.subscribed === false) {
				suppressions.push({ email, reason: "unsubscribe" })
				continue
			}
			contacts.push({
				email,
				name: full_name(contact.firstName, contact.lastName),
				data: fields(contact, ["email", "firstName", "lastName", "subscribed", "id", "userGroup"]),
				// Loops' user group is the closest thing it has to a tag.
				tags: typeof contact.userGroup === "string" && contact.userGroup ? [contact.userGroup] : [],
				status: "subscribed",
			})
		}
		return { contacts, suppressions, cursor: page.cursor || undefined }
	},
}

/** Brevo (formerly Sendinblue): `https://api.brevo.com/v3/contacts`, offset-paged. */
const brevo: ImportSource = {
	label: "Brevo",
	env: "BREVO_API_KEY",
	key_hint: "a Brevo v3 key, from SMTP & API → API keys",
	page(key, cursor) {
		const offset = Number(cursor ?? 0)
		return {
			url: `https://api.brevo.com/v3/contacts?limit=1000&offset=${offset}`,
			headers: { "api-key": key, accept: "application/json" },
		}
	},
	read(body, cursor) {
		const page = body as {
			contacts?: Array<{
				email?: string
				emailBlacklisted?: boolean
				attributes?: Record<string, unknown>
				listIds?: Array<number>
			}>
			count?: number
		}
		const rows = page.contacts ?? []
		const contacts: Array<ImportedContact> = []
		const suppressions: Array<ImportedSuppression> = []
		for (const row of rows) {
			const email = typeof row.email === "string" ? row.email : ""
			if (!email) continue
			// Brevo's one boolean covers unsubscribes and hard bounces alike; unsubscribe is
			// the safer of the two to record, since it never expires and never retries.
			if (row.emailBlacklisted) {
				suppressions.push({ email, reason: "unsubscribe" })
				continue
			}
			const attributes = row.attributes ?? {}
			contacts.push({
				email,
				name: full_name(attributes.FIRSTNAME, attributes.LASTNAME, attributes.NAME),
				data: fields(attributes, ["FIRSTNAME", "LASTNAME", "NAME", "EMAIL"]),
				status: "subscribed",
			})
		}
		return {
			contacts,
			suppressions,
			cursor: rows.length === 1000 ? String(Number(cursor ?? 0) + rows.length) : undefined,
		}
	},
}

export const IMPORT_SOURCES: Record<string, ImportSource> = {
	mailchimp,
	kit,
	loops,
	brevo,
}

export const IMPORT_SOURCE_NAMES = Object.keys(IMPORT_SOURCES)

/** Is this string one of the sources we can read? */
export function is_import_source(value: string): value is keyof typeof IMPORT_SOURCES {
	return Object.hasOwn(IMPORT_SOURCES, value)
}

/**
 * Split what a page yielded into what to send, in the order it must be sent in.
 *
 * Suppressions go first, always. A migration that added everybody and then suppressed
 * the unsubscribed would have a window — however short — in which a send could reach an
 * address the old ESP had already been told not to mail. That is the one mistake in an
 * ESP migration nobody can take back, so the order is the rule and not an optimisation.
 */
export function batches<T>(rows: Array<T>, size: number): Array<Array<T>> {
	const out: Array<Array<T>> = []
	for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
	return out
}
