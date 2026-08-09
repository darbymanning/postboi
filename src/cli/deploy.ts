/** Hosts the CLI can push environment variables to. */
export type Host = "vercel" | "cloudflare" | "netlify" | "railway"

export const HOST_LABEL: Record<Host, string> = {
	vercel: "Vercel",
	cloudflare: "Cloudflare (wrangler)",
	netlify: "Netlify",
	railway: "Railway",
}

/** The CLI binary each host pushes through — used to check availability on PATH. */
export const HOST_CLI: Record<Host, string> = {
	vercel: "vercel",
	cloudflare: "wrangler",
	netlify: "netlify",
	railway: "railway",
}

/** The npm package carrying each host's CLI, for running it without a global install. */
export const HOST_PACKAGE: Record<Host, string> = {
	vercel: "vercel",
	cloudflare: "wrangler",
	netlify: "netlify-cli",
	railway: "@railway/cli",
}

/** A command to run against a host. `stdin` is piped when set (secrets). */
export type PushSpec = {
	cmd: string
	args: Array<string>
	stdin?: string
}

/**
 * How to invoke a host's CLI: the binary itself when it's on PATH, otherwise through the
 * project's package runner (`bunx wrangler …`), so a missing global install downgrades to
 * a slightly slower first run instead of a dead end.
 */
export function host_invocation(
	host: Host,
	package_manager: "bun" | "pnpm" | "yarn" | "npm",
	on_path: (cmd: string) => boolean
): { cmd: string; prefix: Array<string>; via_runner: boolean } {
	const bin = HOST_CLI[host]
	if (on_path(bin)) return { cmd: bin, prefix: [], via_runner: false }
	// npx serves yarn too — classic yarn has no dlx, and npx ships with node either way.
	const runner =
		package_manager === "bun"
			? ["bunx"]
			: package_manager === "pnpm"
				? ["pnpm", "dlx"]
				: ["npx", "--yes"]
	return { cmd: runner[0], prefix: [...runner.slice(1), HOST_PACKAGE[host]], via_runner: true }
}

/**
 * Is this directory linked to a host project? "unlinked" is fixable with {@link
 * link_args}; "unknown" means the host keeps its link state somewhere we can't cheaply
 * check (Railway stores it in a global config keyed by directory) — attempt the push and
 * let the failure message point at linking.
 */
export function link_state(
	host: Host,
	files: ReadonlyArray<string>,
	exists: (path: string) => boolean
): "linked" | "unlinked" | "unknown" {
	switch (host) {
		case "vercel":
			return exists(".vercel/project.json") ? "linked" : "unlinked"
		case "netlify":
			return exists(".netlify/state.json") ? "linked" : "unlinked"
		case "cloudflare":
			// Wrangler's "link" is the config file itself: secrets push to the Worker it names.
			return files.some((f) => /^wrangler\.(toml|jsonc?|json)$/.test(f)) ? "linked" : "unlinked"
		case "railway":
			return "unknown"
	}
}

/**
 * The host CLI's interactive link command (binary-relative args), or null where linking
 * isn't a CLI command (Cloudflare's link is a config file to write).
 */
export function link_args(host: Host): Array<string> | null {
	switch (host) {
		case "vercel":
			return ["link"]
		case "netlify":
			return ["link"]
		case "railway":
			return ["link"]
		case "cloudflare":
			return null
	}
}

/** Detect deployment targets from a directory listing. */
export function detect_hosts(files: ReadonlyArray<string>): Array<Host> {
	const has = (name: string) => files.includes(name)
	const hosts: Array<Host> = []

	if (has(".vercel") || has("vercel.json")) hosts.push("vercel")
	if (has("wrangler.toml") || has("wrangler.jsonc") || has("wrangler.json") || has(".dev.vars")) {
		hosts.push("cloudflare")
	}
	if (has("netlify.toml") || has(".netlify")) hosts.push("netlify")
	if (has("railway.json") || has("railway.toml")) hosts.push("railway")

	return hosts
}

/** Adapter package → host. The cloudflare entry also covers `adapter-cloudflare-workers`. */
const ADAPTER_HOSTS: ReadonlyArray<readonly [RegExp, Host]> = [
	[/@sveltejs\/adapter-vercel/, "vercel"],
	[/@sveltejs\/adapter-cloudflare/, "cloudflare"],
	[/@sveltejs\/adapter-netlify/, "netlify"],
]

/**
 * Infer the host from the SvelteKit adapter referenced in config sources (the contents of
 * `svelte.config.*`, `vite.config.*`, and/or `package.json`). Returns the first match — a
 * project only ships one adapter.
 */
export function detect_adapter_host(sources: ReadonlyArray<string>): Host | null {
	const blob = sources.join("\n")
	for (const [pattern, host] of ADAPTER_HOSTS) {
		if (pattern.test(blob)) return host
	}
	return null
}

/**
 * Binary-relative args to upsert a single env var. Every host overwrites an existing
 * value — the user chose "push to host" for freshly collected credentials, so keeping a
 * stale value would be the surprise, not replacing it. Vercel needs `--force` to say so
 * (a bare `env add` errors on an existing name); the other three upsert natively.
 * Vercel and Cloudflare read the value from stdin so it never lands in shell history.
 */
export function push_args(
	host: Host,
	key: string,
	value: string
): { args: Array<string>; stdin?: string } {
	switch (host) {
		case "vercel":
			return { args: ["env", "add", key, "production", "--force"], stdin: value }
		case "cloudflare":
			return { args: ["secret", "put", key], stdin: value }
		case "netlify":
			return { args: ["env:set", key, value] }
		case "railway":
			return { args: ["variables", "--set", `${key}=${value}`] }
	}
}

/** Assemble a full command for one env var through the resolved invocation. */
export function push_spec(
	invocation: { cmd: string; prefix: Array<string> },
	host: Host,
	key: string,
	value: string
): PushSpec {
	const { args, stdin } = push_args(host, key, value)
	return { cmd: invocation.cmd, args: [...invocation.prefix, ...args], stdin }
}

/** The equivalent command to run by hand, shown when an automatic push fails or is skipped. */
export function manual_hint(host: Host, key: string): string {
	switch (host) {
		case "vercel":
			return `vercel env add ${key} production --force`
		case "cloudflare":
			return `wrangler secret put ${key}`
		case "netlify":
			return `netlify env:set ${key} <value>`
		case "railway":
			return `railway variables --set "${key}=<value>"`
	}
}
