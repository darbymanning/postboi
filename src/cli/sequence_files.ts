import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"
import type { SequenceDefinition, SequenceFile } from "../library/sequence.js"

/**
 * Sequences as code, the file half. A `sequences/` directory holds one `.ts` per
 * sequence, each default-exporting what `sequence()` returns; `.postboi/sequences.json`
 * remembers the version each file was last pushed at, which is the sync conflict rule:
 * a push whose lockfile version is behind the account's fails unless forced, and a
 * pull writes the account's copy back as a file and moves the lock forward.
 *
 * Pure helpers (render, slug, lockfile shapes) live here beside the I/O so the tests
 * can prove the file that gets written round-trips through `import()`.
 */

export const DEFAULT_DIR = "sequences"
export const LOCKFILE = join(".postboi", "sequences.json")

/** `{ "Welcome": 3 }` — the account version each named sequence was last synced at. */
export type Lockfile = Record<string, number>

export function read_lockfile(root = "."): Lockfile {
	const file = join(root, LOCKFILE)
	if (!existsSync(file)) return {}
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Lockfile)
			: {}
	} catch {
		return {}
	}
}

export function write_lockfile(lock: Lockfile, root = "."): void {
	const file = join(root, LOCKFILE)
	mkdirSync(join(root, ".postboi"), { recursive: true })
	const sorted = Object.fromEntries(Object.entries(lock).sort(([a], [b]) => a.localeCompare(b)))
	writeFileSync(file, `${JSON.stringify(sorted, null, "\t")}\n`)
}

/** "Trial onboarding" → "trial_onboarding": a file stem a sequence name maps to. */
export function slug(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "_")
			.replace(/^_+|_+$/g, "")
			.slice(0, 60) || "sequence"
	)
}

/** "welcome_back" → "Welcome back": the name a file stem implies when the file names none. */
export function name_from_stem(stem: string): string {
	const words = stem.replace(/[_-]+/g, " ").trim()
	return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * A `sequences/<slug>.ts` source for a definition: `sequence({ name, ...definition })`
 * as pretty JSON, which `import()` reads back exactly. Step helpers are for hands;
 * a pulled file is data first, and is valid input to push again as it stands.
 */
export function render_sequence_file(name: string, definition: SequenceDefinition): string {
	const body = JSON.stringify({ name, ...definition }, null, "\t")
	return `import { sequence } from "postboi"

// Pulled from your Postboi account by \`postboi sequences pull\`. Edit and \`postboi sync\`
// pushes it back; the dashboard and this file share one version counter.
export default sequence(${body})
`
}

export interface LoadedSequence {
	file: string
	name: string
	definition: SequenceDefinition
}

/**
 * Import every `*.ts` / `*.js` in the directory and read its default export. A file
 * without one, or whose export isn't a sequence, is reported by name and skipped;
 * the rest still push. Needs a runtime that imports TypeScript (Bun, Node 23.6+).
 */
export async function load_sequence_files(
	dir = DEFAULT_DIR,
	root = "."
): Promise<{ sequences: Array<LoadedSequence>; problems: Array<string> }> {
	const folder = join(root, dir)
	const sequences: Array<LoadedSequence> = []
	const problems: Array<string> = []
	if (!existsSync(folder)) return { sequences, problems }
	const files = readdirSync(folder)
		.filter((file) => /\.(ts|mts|js|mjs)$/.test(file) && !/\.(test|d)\.[cm]?[tj]s$/.test(file))
		.sort()
	for (const file of files) {
		const path = join(folder, file)
		try {
			const mod = (await import(
				/* @vite-ignore */ `${pathToFileURL(path).href}?t=${Date.now()}`
			)) as {
				default?: unknown
			}
			const exported = mod.default as Partial<SequenceFile> | undefined
			if (
				!exported ||
				typeof exported !== "object" ||
				!exported.definition ||
				typeof exported.definition !== "object"
			) {
				problems.push(`${file}: no default export from sequence().`)
				continue
			}
			const stem = basename(file).replace(/\.[cm]?[tj]s$/, "")
			sequences.push({
				file,
				name: exported.name?.trim() || name_from_stem(stem),
				definition: exported.definition,
			})
		} catch (error) {
			problems.push(`${file}: ${error instanceof Error ? error.message : String(error)}`)
		}
	}
	return { sequences, problems }
}

/** The API surface push/pull need — injected so the tests pass a fake. */
export interface SequenceApi {
	list(): Promise<
		Array<{ id: string; name: string; version: number; definition: SequenceDefinition }>
	>
	create(name: string, definition: SequenceDefinition): Promise<{ id: string; version: number }>
	update(
		ref: string,
		changes: { definition: SequenceDefinition; expected_version?: number }
	): Promise<{ version: number } | { conflict: number }>
}

export type PushOutcome =
	| { file: string; name: string; action: "created" | "updated" | "unchanged"; version: number }
	| { file: string; name: string; action: "conflict"; local: number | undefined; remote: number }

/**
 * Push every loaded file. Unchanged definitions are skipped without a request past the
 * listing. A file whose lock version is behind the account's version — someone saved on
 * the dashboard since — is a conflict unless `force`, and is left alone.
 */
export async function push_sequences(
	api: SequenceApi,
	files: Array<LoadedSequence>,
	lock: Lockfile,
	options: { force?: boolean } = {}
): Promise<{ outcomes: Array<PushOutcome>; lock: Lockfile }> {
	const remote = await api.list()
	const outcomes: Array<PushOutcome> = []
	const next: Lockfile = { ...lock }
	for (const local of files) {
		const existing = remote.find((row) => row.name.toLowerCase() === local.name.toLowerCase())
		if (!existing) {
			const created = await api.create(local.name, local.definition)
			next[local.name] = created.version
			outcomes.push({
				file: local.file,
				name: local.name,
				action: "created",
				version: created.version,
			})
			continue
		}
		if (same_definition(existing.definition, local.definition)) {
			next[local.name] = existing.version
			outcomes.push({
				file: local.file,
				name: local.name,
				action: "unchanged",
				version: existing.version,
			})
			continue
		}
		const known = lock[local.name]
		if (!options.force && known !== undefined && known < existing.version) {
			outcomes.push({
				file: local.file,
				name: local.name,
				action: "conflict",
				local: known,
				remote: existing.version,
			})
			continue
		}
		const result = await api.update(existing.id, {
			definition: local.definition,
			...(options.force ? {} : { expected_version: existing.version }),
		})
		if ("conflict" in result) {
			outcomes.push({
				file: local.file,
				name: local.name,
				action: "conflict",
				local: known,
				remote: result.conflict,
			})
			continue
		}
		next[local.name] = result.version
		outcomes.push({
			file: local.file,
			name: local.name,
			action: "updated",
			version: result.version,
		})
	}
	return { outcomes, lock: next }
}

/** Definitions compare as canonical JSON — step ids included, so a minted id is a change worth pulling. */
export function same_definition(a: unknown, b: unknown): boolean {
	return canonical(a) === canonical(b)
}

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, entry]) => entry !== undefined)
			.sort(([a], [b]) => a.localeCompare(b))
		return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`
	}
	return JSON.stringify(value)
}

/**
 * Write the account's sequences (one, by name, or all) as files. Existing files are
 * overwritten — that is what pull means — and the lock moves to the pulled versions.
 */
export function pull_sequences(
	rows: Array<{ name: string; version: number; definition: SequenceDefinition }>,
	lock: Lockfile,
	dir = DEFAULT_DIR,
	root = "."
): { written: Array<string>; lock: Lockfile } {
	const folder = join(root, dir)
	mkdirSync(folder, { recursive: true })
	const written: Array<string> = []
	const next: Lockfile = { ...lock }
	for (const row of rows) {
		const file = join(folder, `${slug(row.name)}.ts`)
		writeFileSync(file, render_sequence_file(row.name, row.definition))
		written.push(file)
		next[row.name] = row.version
	}
	return { written, lock: next }
}
