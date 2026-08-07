/**
 * The zero-config `push()`, mirroring `mail()`, `sms()` and `chat()`.
 */
import type { BatchResult } from "../transport.js"
import type { PushDefaults, PushOptions } from "./types.js"
import type { PushProvider } from "./provider.js"
import { PostboiError } from "../errors.js"
import { find_push_provider } from "../registry.js"
import { load_config } from "../config.js"
import { ensure_env_loaded, is_development, read_env } from "../env.js"

type PushConstructor = new (options: Record<string, unknown>) => PushProvider<unknown>

/** Lazy loaders, keyed by `POSTBOI_PUSH_PROVIDER`. */
const LOADERS: Record<string, () => Promise<PushConstructor>> = {
	webpush: () => import("./webpush.js").then((m) => m.default as unknown as PushConstructor),
	fcm: () => import("./fcm.js").then((m) => m.default as unknown as PushConstructor),
	mock: () => import("./mock.js").then((m) => m.default as unknown as PushConstructor),
}

let warned_dev_fallback = false

/** Read the push defaults from the environment. */
export function push_env_defaults(): PushDefaults {
	const out: PushDefaults = {}
	const icon = read_env("POSTBOI_PUSH_ICON")
	if (icon !== undefined) out.icon = icon
	// Deliberately no POSTBOI_PUSH_TO: a push target is per-device, so a single one in the
	// environment would be a footgun rather than a convenience.
	return out
}

/** Construct the push provider named by `POSTBOI_PUSH_PROVIDER`. */
async function resolve_provider(): Promise<PushProvider<unknown>> {
	const config = await load_config()
	await ensure_env_loaded()

	const key = read_env("POSTBOI_PUSH_PROVIDER") ?? config.push?.provider

	if (!key) {
		if (is_development()) {
			if (!warned_dev_fallback) {
				warned_dev_fallback = true
				console.warn(
					"postboi: no push provider configured — logging notifications to the console instead of sending."
				)
			}
			const Mock = await import("./mock.js").then((m) => m.default)
			return new Mock({ log: true, default: push_env_defaults() })
		}
		throw new PostboiError({
			provider: "postboi",
			channel: "push",
			code: "no_push_provider",
			message:
				'No push provider configured. Set POSTBOI_PUSH_PROVIDER, or import one directly, e.g. `import WebPush from "postboi/webpush"`.',
		})
	}

	const load = LOADERS[key]
	if (!load) {
		throw new PostboiError({
			provider: "postboi",
			channel: "push",
			code: "unknown_push_provider",
			message: `Unknown POSTBOI_PUSH_PROVIDER "${key}".`,
		})
	}

	const options: Record<string, unknown> = { default: push_env_defaults() }
	const meta = find_push_provider(key)
	for (const field of meta?.fields ?? []) {
		const value = read_env(field.env) ?? config.push?.options?.[field.arg] ?? field.default
		if (value === undefined) {
			throw new PostboiError({
				provider: key,
				channel: "push",
				code: "missing_env",
				message: `Push provider "${key}" needs ${field.env} — set it in the environment.`,
			})
		}
		options[field.arg] = value
	}

	if (key === "mock") options.log = true

	const Provider = await load()
	return new Provider(options)
}

/**
 * Send a push notification without constructing anything.
 *
 * @example
 * ```ts
 * import { push } from "postboi"
 *
 * await push({ to: subscription, title: "Order shipped", message: "On its way" })
 * ```
 */
export function push(options: PushOptions): Promise<unknown>
export function push(
	options: Array<PushOptions>,
	batch?: { concurrency?: number }
): Promise<Array<BatchResult<unknown>>>
export async function push(
	options: PushOptions | Array<PushOptions>,
	batch: { concurrency?: number } = {}
): Promise<unknown> {
	const provider = await resolve_provider()
	if (Array.isArray(options)) return provider.send(options, batch)
	return provider.send(options)
}
