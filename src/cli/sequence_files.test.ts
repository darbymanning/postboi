import { describe, expect, it } from "vitest"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	load_sequence_files,
	name_from_stem,
	pull_sequences,
	push_sequences,
	read_lockfile,
	render_sequence_file,
	same_definition,
	slug,
	write_lockfile,
	type SequenceApi,
} from "./sequence_files.js"
import type { SequenceDefinition } from "../library/sequence.js"

const welcome: SequenceDefinition = {
	trigger: { kind: "contact_added" },
	entry: "one_time",
	steps: [
		{ id: "hello", kind: "email", subject: "Hi {name}", html: "<p>Hi</p>" },
		{ id: "wait", kind: "delay", for: { days: 2 } },
	],
}

describe("files", () => {
	it("slug and name_from_stem round-trip a name", () => {
		expect(slug("Trial onboarding (v2)")).toBe("trial_onboarding_v2")
		expect(slug("")).toBe("sequence")
		expect(name_from_stem("win_back")).toBe("Win back")
	})

	it("a pulled file imports back to the same definition", async () => {
		const root = mkdtempSync(join(tmpdir(), "postboi-seq-"))
		const { written, lock } = pull_sequences(
			[{ name: "Welcome", version: 3, definition: welcome }],
			{},
			"sequences",
			root
		)
		expect(written).toEqual([join(root, "sequences", "welcome.ts")])
		expect(lock).toEqual({ Welcome: 3 })
		const source = readFileSync(written[0], "utf8")
		expect(source).toContain('import { sequence } from "postboi"')
		expect(source).toContain('"name": "Welcome"')

		// The file imports `postboi`, which a temp dir can't resolve — stand in for it with
		// a local shim that has the same one-function surface, and load through the loader.
		writeFileSync(
			join(root, "sequences", "welcome.ts"),
			source.replace('from "postboi"', 'from "../shim.js"')
		)
		writeFileSync(
			join(root, "shim.js"),
			"export function sequence(input) { const { name, ...definition } = input; return { name, definition } }"
		)
		const { sequences, problems } = await load_sequence_files("sequences", root)
		expect(problems).toEqual([])
		expect(sequences).toHaveLength(1)
		expect(sequences[0].name).toBe("Welcome")
		expect(sequences[0].definition).toEqual(welcome)

		// A file without a sequence export is named, not fatal.
		writeFileSync(join(root, "sequences", "broken.ts"), "export const nothing = 1\n")
		const again = await load_sequence_files("sequences", root)
		expect(again.problems).toEqual(["broken.ts: no default export from sequence()."])
		expect(again.sequences).toHaveLength(1)

		write_lockfile({ Welcome: 4, Alpha: 1 }, root)
		expect(read_lockfile(root)).toEqual({ Alpha: 1, Welcome: 4 })
	})

	it("render_sequence_file is data first", () => {
		const source = render_sequence_file("Dunning", welcome)
		expect(source.startsWith('import { sequence } from "postboi"')).toBe(true)
		expect(source).toContain("export default sequence({")
	})
})

describe("push", () => {
	function fake(
		rows: Array<{ id: string; name: string; version: number; definition: SequenceDefinition }>
	) {
		const calls: Array<string> = []
		const api: SequenceApi = {
			list: async () => rows,
			create: async (name) => {
				calls.push(`create ${name}`)
				return { id: `seq_${name}`, version: 1 }
			},
			update: async (id, changes) => {
				calls.push(`update ${id} expecting ${changes.expected_version ?? "any"}`)
				const row = rows.find((entry) => entry.id === id)!
				if (changes.expected_version !== undefined && changes.expected_version !== row.version) {
					return { conflict: row.version }
				}
				return { version: row.version + 1 }
			},
		}
		return { api, calls }
	}

	it("creates new files, skips unchanged ones, updates changed ones, and moves the lock", async () => {
		const remote = [{ id: "seq_w", name: "Welcome", version: 2, definition: welcome }]
		const { api, calls } = fake(remote)
		const changed: SequenceDefinition = { ...welcome, steps: [welcome.steps[0]] }
		const { outcomes, lock } = await push_sequences(
			api,
			[
				{ file: "welcome.ts", name: "welcome", definition: welcome },
				{ file: "dunning.ts", name: "Dunning", definition: changed },
			],
			{}
		)
		expect(outcomes.map((o) => o.action)).toEqual(["unchanged", "created"])
		expect(calls).toEqual(["create Dunning"])
		expect(lock).toEqual({ welcome: 2, Dunning: 1 })

		const second = await push_sequences(
			api,
			[{ file: "welcome.ts", name: "Welcome", definition: changed }],
			{ Welcome: 2 }
		)
		expect(second.outcomes[0]).toMatchObject({ action: "updated", version: 3 })
		expect(calls.at(-1)).toBe("update seq_w expecting 2")
	})

	it("a file behind the dashboard is a conflict unless forced", async () => {
		const remote = [{ id: "seq_w", name: "Welcome", version: 5, definition: welcome }]
		const { api, calls } = fake(remote)
		const changed: SequenceDefinition = { ...welcome, steps: [] }
		const files = [{ file: "welcome.ts", name: "Welcome", definition: changed }]
		const held = await push_sequences(api, files, { Welcome: 3 })
		expect(held.outcomes[0]).toEqual({
			file: "welcome.ts",
			name: "Welcome",
			action: "conflict",
			local: 3,
			remote: 5,
		})
		expect(calls).toEqual([])
		expect(held.lock).toEqual({ Welcome: 3 })

		const forced = await push_sequences(api, files, { Welcome: 3 }, { force: true })
		expect(forced.outcomes[0]).toMatchObject({ action: "updated", version: 6 })
		expect(calls).toEqual(["update seq_w expecting any"])
	})

	it("same_definition ignores key order and undefined", () => {
		expect(same_definition({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true)
		expect(same_definition({ a: 1, b: undefined }, { a: 1 })).toBe(true)
		expect(same_definition({ a: 1 }, { a: 2 })).toBe(false)
	})
})
