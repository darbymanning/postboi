import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { bold, dim, green, red, type create_prompts } from "./prompts.js"

type Prompts = ReturnType<typeof create_prompts>

export const SKILL_TARGET = join(".claude", "skills", "postboi", "SKILL.md")

/**
 * The agent skill ships inside the npm package (skills/postboi/SKILL.md) so an installed
 * copy always matches the installed version.
 */
export function bundled_skill_path(): string | undefined {
	// ../skills resolves from dist/cli.js in the published package, ../../skills from src/cli in dev.
	for (const path of ["../skills/postboi/SKILL.md", "../../skills/postboi/SKILL.md"]) {
		const file = fileURLToPath(new URL(path, import.meta.url))
		if (existsSync(file)) return file
	}
	return undefined
}

export function bundled_skill(): string | undefined {
	const file = bundled_skill_path()
	return file ? readFileSync(file, "utf8") : undefined
}

/** existsSync follows symlinks, so a dangling link (package not installed yet) reads as absent. */
function present(path: string): boolean {
	try {
		lstatSync(path)
		return true
	} catch {
		return false
	}
}

function is_link(path: string): boolean {
	try {
		return lstatSync(path).isSymbolicLink()
	} catch {
		return false
	}
}

/**
 * Link the installed skill at node_modules/postboi/skills — new releases then land with no
 * diff at all. Falls back to a copy where symlinks don't work (Windows without dev mode).
 */
function link_skill(target: string, source = bundled_skill_path()): boolean {
	try {
		// Prefer node_modules/postboi over import.meta.url: pnpm and bun resolve the running
		// file into a version-pinned store path, which would pin the link to today's version.
		const dir = realpathSync(dirname(resolve(target)))
		const nm = ancestors(dir)
			.map((d) => join(d, "node_modules", "postboi", "skills", "postboi", "SKILL.md"))
			.find((p) => existsSync(p))
		if (!nm && !source) return false
		rmSync(target, { force: true })
		// The link is resolved from the *real* directory, so anything symlinked above the
		// target (macOS /var, a linked checkout) would send a relative link astray.
		symlinkSync(relative(dir, nm ?? source!), target)
		return true
	} catch {
		return false
	}
}

function ancestors(dir: string): Array<string> {
	const out = [dir]
	for (let d = dirname(dir); d !== out[out.length - 1]; d = dirname(d)) out.push(d)
	return out
}

/**
 * Point an already-installed copy at the bundled skill, so upgrades don't leave a stale one
 * behind. Never creates the file — installing is init's (prompted) job.
 */
export function refresh_skill(target = SKILL_TARGET, skill = bundled_skill()): boolean {
	if (!skill || !present(target)) return false
	if (is_link(target)) return false // already live — the link tracks the installed version
	if (link_skill(target)) {
		console.log(
			`${green("✓")} linked ${bold(target)} to the installed postboi ${dim("— future releases update it with no diff")}`
		)
		return true
	}
	if (readFileSync(target, "utf8") === skill) return false
	writeFileSync(target, skill)
	console.log(`${green("✓")} refreshed the agent skill at ${bold(target)}`)
	return true
}

/** Offer to install the agent skill into .claude/skills/; an existing copy is refreshed silently. */
export async function offer_skill(prompts: Prompts, target = SKILL_TARGET): Promise<void> {
	const skill = bundled_skill()
	if (!skill) return
	if (present(target)) {
		refresh_skill(target, skill)
		return
	}
	const question = `\nInstall the ${bold("postboi")} agent skill? ${dim("— teaches AI coding agents the library")}`
	if (!(await prompts.confirm(question))) return
	install_skill(target, skill)
}

/** Write (or link) the skill into place. Callers decide whether to ask first. */
function install_skill(target: string, skill: string): void {
	mkdirSync(dirname(target), { recursive: true })
	if (link_skill(target)) {
		console.log(
			`${green("✓")} linked ${bold(target)} to the installed postboi ${dim("— commit it; upgrades update the skill for free")}`
		)
		// The link points into node_modules, so a fresh clone has it dangling until deps are
		// installed — and a dangling skill is silently absent rather than visibly broken.
		console.log(dim("  (it resolves once dependencies are installed — say so in your README)"))
		return
	}
	writeFileSync(target, skill)
	console.log(`${green("✓")} wrote ${bold(target)} — commit it so agents pick it up`)
}

/**
 * `bunx postboi skill` — install the skill on its own, no prompts and no other setup.
 *
 * The prompted offer only fires during `init`, so the case it misses is the common one:
 * postboi is already a dependency (often added by the very agent that then has to guess at
 * the API), init never ran, and nothing in an installed package announces itself. This is
 * the one command to reach for there.
 *
 * Returns false when the bundled skill can't be found, so the caller can exit non-zero.
 */
export function skill_command(target = SKILL_TARGET): boolean {
	const skill = bundled_skill()
	if (!skill) {
		console.log(red("Couldn't find the bundled skill — is postboi installed in this project?"))
		return false
	}
	// An existing copy is upgraded to a link where it can be; already-linked is a no-op that
	// still deserves a line, or the command looks like it did nothing.
	if (present(target)) {
		if (!refresh_skill(target, skill)) {
			console.log(`${green("✓")} already installed at ${bold(target)}`)
		}
		return true
	}
	install_skill(target, skill)
	return true
}
