import { ensure_env_loaded, read_env } from "../library/env.js"
import { cloud_base } from "./postboi.js"
import { bold, cyan, dim, green, yellow } from "./prompts.js"
import {
	batches,
	IMPORT_SOURCES,
	IMPORT_SOURCE_NAMES,
	is_import_source,
	type ImportedContact,
	type ImportedSuppression,
} from "./import_sources.js"

/**
 * `postboi import --from mailchimp|kit|loops|brevo` — move an audience across without
 * handing anybody your old ESP's key.
 *
 * It runs **here**, on the machine you type it on. The source key is read from a flag or
 * your environment, used to call the source's own API directly, and never sent to
 * Postboi — which is the whole reason this is a CLI command rather than a hosted
 * importer with a "paste your Mailchimp key" box. Postboi only ever sees the contacts
 * you are moving to it.
 *
 * **Suppressions go first, always.** A migration that added everybody and then suppressed
 * the unsubscribed would have a window — however short — in which a send could reach
 * somebody the old ESP had already been told not to mail. That is the one mistake in an
 * ESP migration nobody can take back, so it is the order of the whole command rather
 * than a detail of one loop.
 */

/** A failure with a message safe to print as-is. */
export class ImportError extends Error {}

/** How many recipients go in one POST. The API's ceiling is 10,000; this is well under
 * it so a slow link can't time out a page mid-import. */
const BATCH = 500

/** Pages walked before we stop and say so, in case a source's cursor never settles. */
const MAX_PAGES = 500

interface Flags {
	from?: string
	key?: string
	list?: string
	source_list?: string
	dry_run?: boolean
	limit?: number
}

/** `--from kit --key abc --list "Newsletter" --dry-run` → the flags, loosely. */
export function parse_import_flags(args: Array<string>): Flags {
	const flags: Flags = {}
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]
		const [name, inline] = arg.startsWith("--") ? arg.slice(2).split("=", 2) : ["", undefined]
		const value = () => inline ?? args[++i] ?? ""
		if (name === "from") flags.from = value().toLowerCase()
		else if (name === "key") flags.key = value()
		else if (name === "list") flags.list = value()
		else if (name === "source-list") flags.source_list = value()
		else if (name === "limit") flags.limit = Number(value()) || undefined
		else if (name === "dry-run") flags.dry_run = true
	}
	return flags
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** One call to our own API, with the project's token. */
async function post(path: string, body: unknown, fetch_fn: FetchLike): Promise<void> {
	const token = read_env("POSTBOI_TOKEN")
	const response = await fetch_fn(`${cloud_base()}${path}`, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
		body: JSON.stringify(body),
	})
	if (!response.ok) {
		const detail = (await response.json().catch(() => undefined)) as
			| { message?: string }
			| undefined
		throw new ImportError(detail?.message ?? `Postboi responded with ${response.status}.`)
	}
}

export async function import_command(
	args: Array<string> = [],
	fetch_fn: FetchLike = fetch
): Promise<void> {
	const flags = parse_import_flags(args)
	if (!flags.from || !is_import_source(flags.from)) {
		throw new ImportError(
			`Usage: postboi import --from <${IMPORT_SOURCE_NAMES.join("|")}> [--key <key>] [--list <name>] [--dry-run]`
		)
	}
	const source = IMPORT_SOURCES[flags.from]

	await ensure_env_loaded()
	if (!read_env("POSTBOI_TOKEN")) {
		throw new ImportError("No POSTBOI_TOKEN found — run `postboi init` to sign in first.")
	}

	const key = flags.key || read_env(source.env)
	if (!key) {
		throw new ImportError(
			`No ${source.label} key. Pass --key, or set ${source.env}. ${dim(source.key_hint)}`
		)
	}
	const extra = flags.source_list
	if (source.needs && !extra) {
		throw new ImportError(`${source.label} needs --${source.needs.flag}: ${source.needs.hint}`)
	}

	const list = flags.list || `${source.label} import`
	console.log(
		`${cyan("postboi import")} ${dim("·")} ${bold(source.label)} → ${bold(list)}` +
			(flags.dry_run ? ` ${yellow("(dry run — nothing is written)")}` : "")
	)
	// Said plainly, once, because it is the reason to use this rather than a hosted
	// importer and nobody should have to read the source to find it out.
	console.log(dim(`Your ${source.label} key stays on this machine — Postboi never sees it.`))

	let cursor: string | undefined
	let pages = 0
	let imported = 0
	let suppressed = 0
	const seen = new Set<string>()

	while (pages < MAX_PAGES) {
		const request = source.page(key, cursor, extra)
		const response = await fetch_fn(request.url, { headers: request.headers }).catch(
			(error: unknown) => {
				throw new ImportError(
					`Could not reach ${source.label} (${error instanceof Error ? error.message : String(error)}).`
				)
			}
		)
		if (!response.ok) {
			// The source's own status, said as itself: a 401 here means their key, not ours,
			// and conflating the two sends people to the wrong dashboard.
			throw new ImportError(
				response.status === 401 || response.status === 403
					? `${source.label} refused that key (${response.status}). ${source.key_hint}.`
					: `${source.label} responded with ${response.status}.`
			)
		}
		const page = source.read(await response.json().catch(() => ({})), cursor)
		pages++

		// Suppressions first, and before this page's contacts — not just before the
		// import's. A page's own unsubscribes must land before its subscribers do.
		const fresh_suppressions = page.suppressions.filter((row) => !seen.has(row.email.toLowerCase()))
		for (const row of fresh_suppressions) seen.add(row.email.toLowerCase())
		if (!flags.dry_run) {
			for (const row of fresh_suppressions) await suppress(row, fetch_fn)
		}
		suppressed += fresh_suppressions.length

		const contacts = page.contacts.filter((row) => !seen.has(row.email.toLowerCase()))
		for (const row of contacts) seen.add(row.email.toLowerCase())
		if (!flags.dry_run) {
			for (const batch of batches(contacts, BATCH)) {
				await post(`/v1/lists/${encodeURIComponent(list)}/recipients`, batch, fetch_fn)
			}
		}
		imported += contacts.length

		process.stdout.write(
			`\r  ${dim(`page ${pages}`)}  ${imported} contact${imported === 1 ? "" : "s"}, ${suppressed} suppressed  `
		)

		cursor = page.cursor
		if (!cursor) break
		if (flags.limit && imported >= flags.limit) break
	}
	process.stdout.write("\n")

	if (pages >= MAX_PAGES) {
		console.log(
			yellow(`Stopped after ${MAX_PAGES} pages — re-run to continue, re-adding is harmless.`)
		)
	}
	console.log(
		`${green("✓")} ${bold(String(imported))} contact${imported === 1 ? "" : "s"} into ${bold(list)}, ` +
			`${bold(String(suppressed))} suppressed` +
			(flags.dry_run ? ` ${dim("(dry run — nothing was written)")}` : "")
	)
	if (!flags.dry_run && imported > 0) {
		console.log(dim(`Next: postboi recipients ${JSON.stringify(list)}`))
	}
}

/** One suppression. Re-suppressing an address is a no-op, so a re-run is harmless. */
async function suppress(row: ImportedSuppression, fetch_fn: FetchLike): Promise<void> {
	await post("/v1/suppressions", { email: row.email, reason: row.reason }, fetch_fn)
}

export type { ImportedContact }
