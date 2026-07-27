/** Package managers the CLI can install with. */
export type PackageManager = "bun" | "pnpm" | "yarn" | "npm"

export type PackageJson = {
	packageManager?: string
	dependencies?: Record<string, string>
	devDependencies?: Record<string, string>
	peerDependencies?: Record<string, string>
}

/**
 * Detect the project's package manager from its `packageManager` field, then its lockfile,
 * defaulting to npm.
 */
export function detect_package_manager(
	files: ReadonlyArray<string>,
	pkg?: PackageJson
): PackageManager {
	const declared = pkg?.packageManager?.split("@")[0]
	if (declared === "bun" || declared === "pnpm" || declared === "yarn" || declared === "npm") {
		return declared
	}
	if (files.includes("bun.lock") || files.includes("bun.lockb")) return "bun"
	if (files.includes("pnpm-lock.yaml")) return "pnpm"
	if (files.includes("yarn.lock")) return "yarn"
	if (files.includes("package-lock.json")) return "npm"
	return "npm"
}

/**
 * Frameworks whose production build bundles server code, so postboi can be a devDependency:
 * SvelteKit bundles everything via its adapters, and the Nitro-based frameworks (Nuxt,
 * SolidStart, TanStack Start, Analog) emit a self-contained output that doesn't read
 * node_modules at runtime. Next, Remix and Astro externalise server deps — postboi stays a
 * regular dependency there.
 */
const BUNDLED_FRAMEWORK_PACKAGES = [
	"svelte",
	"@sveltejs/kit",
	"nuxt",
	"@solidjs/start",
	"@tanstack/react-start",
	"@tanstack/solid-start",
	"@analogjs/platform",
]

/** Does this project use a framework that bundles server code at build time? */
export function is_bundled_framework(files: ReadonlyArray<string>, pkg?: PackageJson): boolean {
	if (files.some((f) => /^(svelte|nuxt)\.config\.(js|ts|mjs|mts)$/.test(f))) return true
	return BUNDLED_FRAMEWORK_PACKAGES.some((name) => has_dependency(pkg, name))
}

/** Is the dependency already present in any of the package.json dependency maps? */
export function has_dependency(pkg: PackageJson | undefined, name: string): boolean {
	if (!pkg) return false
	return Boolean(
		pkg.dependencies?.[name] || pkg.devDependencies?.[name] || pkg.peerDependencies?.[name]
	)
}

/** The command to add a dependency with the given package manager. */
export function install_command(
	pm: PackageManager,
	name: string,
	dev = false
): { cmd: string; args: Array<string> } {
	const base = pm === "npm" ? { cmd: "npm", args: ["install"] } : { cmd: pm, args: ["add"] }
	return { cmd: base.cmd, args: dev ? [...base.args, "-D", name] : [...base.args, name] }
}

/**
 * Add the `postboi()` Vite plugin to a Vite config's source.
 *
 * The plugin does two things a hand-written `optimizeDeps` block can't. It excludes
 * `postboi/remote` from Vite's dependency prebundle (which would serve those modules
 * empty instead of letting the SvelteKit transform see them), *and* it inlines
 * `postboi.config.*` into the server build.
 *
 * That second half is why this exists. Without it the config is only found by walking up
 * from `process.cwd()` at runtime — fine locally, but a deployed serverless function
 * doesn't contain the file at all (nothing imports it, so tracing never includes it), so
 * `default.from` / `default.to` / `hooks` silently vanish in production.
 *
 * Text edits only, and only shapes we're sure about: returns `"present"` when the plugin
 * is already there, the updated source when a safe insertion point exists, and `"unable"`
 * otherwise (the caller prints a manual hint rather than guessing).
 */
export function add_vite_plugin(source: string): string | "present" | "unable" {
	if (source.includes("postboi/vite")) return "present"

	const IMPORT = 'import { postboi } from "postboi/vite"'
	const COMMENT =
		"\t// Bundles postboi.config into the server build, and keeps postboi/remote out of\n\t// Vite's dependency prebundle."

	// Insert the plugin into an existing plugins array, right after the opening bracket.
	const plugins = source.match(/plugins\s*:\s*\[/)
	if (plugins) {
		const with_plugin = source.replace(plugins[0], `${plugins[0]}\n${COMMENT}\n\t\tpostboi(),`)
		return add_import(with_plugin, IMPORT)
	}

	// No plugins array — add one at the top of the config object literal.
	if (source.includes("defineConfig({")) {
		const with_plugin = source.replace(
			"defineConfig({",
			`defineConfig({\n${COMMENT}\n\tplugins: [postboi()],`
		)
		return add_import(with_plugin, IMPORT)
	}
	return "unable"
}

/** Put an import after the file's existing imports, or at the top if it has none. */
function add_import(source: string, statement: string): string {
	const imports = [...source.matchAll(/^import .*$/gm)]
	const last = imports.at(-1)
	if (!last?.index) return `${statement}\n${source}`
	const end = last.index + last[0].length
	return `${source.slice(0, end)}\n${statement}${source.slice(end)}`
}

/**
 * Insert `optimizeDeps: { exclude: ["postboi/remote"] }` into a Vite config's source.
 * Kept for configs the plugin can't be added to safely — the plugin supplies the same
 * exclude, so this is only the fallback.
 */
export function add_remote_exclude(source: string): string | "present" | "unable" {
	if (source.includes("postboi/remote")) return "present"

	// A flat optimizeDeps object — extend its exclude array, or add one.
	const optimize = source.match(/optimizeDeps\s*:\s*\{[^{}]*\}/)
	if (optimize) {
		const block = optimize[0]
		const updated = /exclude\s*:\s*\[/.test(block)
			? block.replace(/(exclude\s*:\s*\[)/, '$1"postboi/remote", ')
			: block.replace(/(optimizeDeps\s*:\s*\{)/, '$1 exclude: ["postboi/remote"],')
		return source.replace(block, updated)
	}
	// optimizeDeps exists but is nested (e.g. esbuildOptions) — don't risk a text edit.
	if (source.includes("optimizeDeps")) return "unable"

	// No optimizeDeps at all — add one at the top of the config object literal.
	if (source.includes("defineConfig({")) {
		return source.replace(
			"defineConfig({",
			'defineConfig({\n\t// postboi/remote must reach the SvelteKit transform, not Vite\'s dependency prebundle\n\toptimizeDeps: { exclude: ["postboi/remote"] },'
		)
	}
	return "unable"
}
