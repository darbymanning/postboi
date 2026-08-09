/** Supported env-file flavours and how a line is written for each. */
export type EnvFormat = "dotenv" | "direnv" | "devvars"

export type EnvTarget = {
	file: string
	format: EnvFormat
	/** Optional note shown to the user (e.g. varlock schema reminder). */
	note?: string
}

/**
 * Decide which env file(s) a project uses from a directory listing. Recognises varlock
 * (`.env.schema`), dotenv (`.env`, `.env.local`), direnv (`.envrc`) and Cloudflare
 * Workers (`.dev.vars`). Falls back to `.env` when nothing is detected.
 */
export function detect_env_targets(files: ReadonlyArray<string>): Array<EnvTarget> {
	const has = (name: string) => files.includes(name)
	const targets: Array<EnvTarget> = []

	if (has(".env.schema")) {
		// varlock: values live in .env, declarations in .env.schema
		targets.push({
			file: ".env",
			format: "dotenv",
			note: "remember to declare it in .env.schema (varlock)",
		})
	} else if (has(".env")) {
		targets.push({ file: ".env", format: "dotenv" })
	}
	if (has(".env.local") && !targets.some((t) => t.file === ".env.local")) {
		targets.push({ file: ".env.local", format: "dotenv" })
	}
	if (has(".envrc")) targets.push({ file: ".envrc", format: "direnv" })
	if (has(".dev.vars")) targets.push({ file: ".dev.vars", format: "devvars" })

	if (targets.length === 0) targets.push({ file: ".env", format: "dotenv" })
	return targets
}

/**
 * Quote a value safely for an env file (tokens rarely need it, but be correct). Newlines
 * become `\n` escapes: the parsers are line-based, so a raw newline (an FCM service-account
 * key, say) would split the value and corrupt every line after it. dotenv expands the
 * escape back; PEM consumers accept the literal sequence either way.
 */
function quote(value: string): string {
	return `"${value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\r/g, "\\r")
		.replace(/\n/g, "\\n")}"`
}

/**
 * Parse the `KEY=value` assignments in env-file content — the same shapes `upsert_env`
 * writes, plus unquoted values written by hand. Exists so the bare `postboi env push`
 * sweep can read the *project's* env files rather than the ambient shell environment,
 * where a developer's unrelated exported secrets live.
 *
 * Double-quoted values may span lines (dotenv and Bun both allow it, and a hand-pasted
 * FCM key is the common case): an opening quote with no closing quote on its line
 * consumes following lines until one ends the quote. Truncating such a value to its
 * first line — quote included — and then *syncing that to the whole team* is the failure
 * this exists to rule out.
 */
/**
 * A `KEY=value` assignment line (already trimmed). Whitespace around `=` is accepted
 * because the library's own `parse_dotenv` accepts it — a hand-written `KEY = value`
 * that demonstrably works at runtime must not be invisible to the push sweep.
 */
const ASSIGNMENT = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/

export function parse_env(content: string): Record<string, string> {
	const out: Record<string, string> = {}
	const lines = content.split("\n")
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim()
		if (!line || line.startsWith("#")) continue
		const match = ASSIGNMENT.exec(line)
		if (!match) continue
		let value = match[2].trim()
		if (value.startsWith('"') && !closes_quote(value)) {
			while (i + 1 < lines.length) {
				value += `\n${lines[++i]}`
				if (closes_quote(value.trimEnd())) break
			}
			value = value.trimEnd()
		}
		out[match[1]] = unquote(value)
	}
	return out
}

/**
 * Does a `"`-opened value end with an unescaped closing quote? A quote is escaped only
 * when preceded by an odd number of backslashes — `quote()` writes a value ending in a
 * backslash as `...\\"`, where the final quote genuinely closes the string.
 */
function closes_quote(value: string): boolean {
	if (value.length < 2 || !value.endsWith('"')) return false
	const backslashes = /\\*$/.exec(value.slice(0, -1))
	return ((backslashes?.[0].length ?? 0) & 1) === 0
}

/** Undo `quote` (and accept single quotes / bare values from hand-written files). */
function unquote(value: string): string {
	if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
		const escapes: Record<string, string> = { '"': '"', "\\": "\\", n: "\n", r: "\r" }
		return value.slice(1, -1).replace(/\\(["\\nr])/g, (_, c: string) => escapes[c])
	}
	if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1)
	return value
}

/** Format a single `KEY=value` assignment for the given flavour. */
export function format_line(format: EnvFormat, key: string, value: string): string {
	const assignment = `${key}=${quote(value)}`
	return format === "direnv" ? `export ${assignment}` : assignment
}

/**
 * Locate a key's assignment as a `[first, last]` line-index span, extending across the
 * extra lines of a multi-line double-quoted value — the same shapes `parse_env` reads.
 * Replacing only an assignment's first line would leave the tail of the old value
 * dangling in the file, and its orphaned closing quote re-opens quoting for every
 * assignment after it.
 */
function assignment_span(lines: ReadonlyArray<string>, key: string): [number, number] | undefined {
	const pattern = new RegExp(`^(?:export\\s+)?${escape_regex(key)}\\s*=\\s*(.*)$`)
	for (let i = 0; i < lines.length; i++) {
		const match = pattern.exec(lines[i].trim())
		if (!match) continue
		let end = i
		let value = match[1].trim()
		if (value.startsWith('"') && !closes_quote(value)) {
			while (end + 1 < lines.length) {
				value += `\n${lines[++end]}`
				if (closes_quote(value.trimEnd())) break
			}
		}
		return [i, end]
	}
	return undefined
}

/**
 * Insert or replace a `KEY=` assignment in existing env-file content, preserving the
 * rest. Returns the updated content (newline-terminated).
 */
export function upsert_env(content: string, key: string, value: string, format: EnvFormat): string {
	const line = format_line(format, key, value)
	const lines = content.split("\n")
	const span = assignment_span(lines, key)
	if (span) {
		lines.splice(span[0], span[1] - span[0] + 1, line)
		return lines.join("\n")
	}
	const base = content.length === 0 || content.endsWith("\n") ? content : `${content}\n`
	return `${base}${line}\n`
}

/**
 * Drop a `KEY=` assignment from env-file content, or return the content unchanged when
 * the key isn't there. Older inits wrote default fields (POSTBOI_FROM, …) to the
 * environment; they're config-first now, and a stale env var silently shadows the config.
 */
export function remove_env(content: string, key: string): string {
	const lines = content.split("\n")
	const span = assignment_span(lines, key)
	if (!span) return content
	lines.splice(span[0], span[1] - span[0] + 1)
	return lines.join("\n")
}

/** Does a .gitignore already cover this file? Handles plain names and simple `*` globs. */
export function is_gitignored(gitignore: string, file: string): boolean {
	return gitignore
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0 && !l.startsWith("#"))
		.some((rule) => {
			const normalized = rule.replace(/^\//, "").replace(/\/$/, "")
			if (!normalized.includes("*")) return normalized === file
			const regex = new RegExp(`^${normalized.split("*").map(escape_regex).join(".*")}$`)
			return regex.test(file)
		})
}

function escape_regex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
