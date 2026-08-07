/**
 * The zero-config `chat()`, mirroring `mail()` and `sms()`.
 */
import type { BatchResult } from "../transport.js"
import type { ChatDefaults, ChatOptions } from "./types.js"
import type { ChatProvider } from "./provider.js"
import { PostboiError } from "../errors.js"
import { find_chat_provider } from "../registry.js"
import { load_config } from "../config.js"
import { ensure_env_loaded, is_development, read_env } from "../env.js"

type ChatConstructor = new (options: Record<string, unknown>) => ChatProvider<unknown>

/** Lazy loaders, keyed by `POSTBOI_CHAT_PROVIDER`. */
const LOADERS: Record<string, () => Promise<ChatConstructor>> = {
	slack: () => import("./slack.js").then((m) => m.default as unknown as ChatConstructor),
	discord: () => import("./discord.js").then((m) => m.default as unknown as ChatConstructor),
	teams: () => import("./teams.js").then((m) => m.default as unknown as ChatConstructor),
	telegram: () => import("./telegram.js").then((m) => m.default as unknown as ChatConstructor),
	mock: () => import("./mock.js").then((m) => m.default as unknown as ChatConstructor),
}

let warned_dev_fallback = false

/** Read the chat defaults from the environment. Only defined values are included. */
export function chat_env_defaults(): ChatDefaults {
	const out: ChatDefaults = {}
	const to = read_env("POSTBOI_CHAT_TO")
	const username = read_env("POSTBOI_CHAT_USERNAME")
	if (to !== undefined) out.to = to
	if (username !== undefined) out.username = username
	return out
}

/**
 * Construct the chat provider named by `POSTBOI_CHAT_PROVIDER`.
 *
 * Note there is **no development interception** here, unlike SMS. Posting to your own
 * Slack channel while developing is normally the point — it costs nothing, reaches only
 * your own team, and can be deleted. The interception SMS gets exists because a stray text
 * costs money and can't be recalled; neither applies.
 */
async function resolve_provider(): Promise<ChatProvider<unknown>> {
	const config = await load_config()
	await ensure_env_loaded()

	const key = read_env("POSTBOI_CHAT_PROVIDER") ?? config.chat?.provider

	if (!key) {
		if (is_development()) {
			if (!warned_dev_fallback) {
				warned_dev_fallback = true
				console.warn(
					"postboi: no chat provider configured — logging messages to the console instead of posting."
				)
			}
			const Mock = await import("./mock.js").then((m) => m.default)
			return new Mock({ log: true, default: chat_env_defaults() })
		}
		throw new PostboiError({
			provider: "postboi",
			channel: "chat",
			code: "no_chat_provider",
			message:
				'No chat provider configured. Set POSTBOI_CHAT_PROVIDER, or import one directly, e.g. `import Slack from "postboi/slack"`.',
		})
	}

	const load = LOADERS[key]
	if (!load) {
		throw new PostboiError({
			provider: "postboi",
			channel: "chat",
			code: "unknown_chat_provider",
			message: `Unknown POSTBOI_CHAT_PROVIDER "${key}".`,
		})
	}

	const options: Record<string, unknown> = { default: chat_env_defaults() }
	const meta = find_chat_provider(key)
	for (const field of meta?.fields ?? []) {
		const value = read_env(field.env) ?? config.chat?.options?.[field.arg] ?? field.default
		if (value === undefined) {
			throw new PostboiError({
				provider: key,
				channel: "chat",
				code: "missing_env",
				message: `Chat provider "${key}" needs ${field.env} — set it in the environment.`,
			})
		}
		options[field.arg] = value
	}

	if (key === "mock") options.log = true

	const Provider = await load()
	return new Provider(options)
}

/**
 * Post a chat message without constructing anything. The provider comes from
 * `POSTBOI_CHAT_PROVIDER`; its webhook URL or token is read from the environment on each
 * call. Pass an array to post many.
 *
 * @example
 * ```ts
 * import { chat } from "postboi"
 *
 * await chat({ message: "Deploy finished" })
 * ```
 */
export function chat(options: ChatOptions): Promise<unknown>
export function chat(
	options: Array<ChatOptions>,
	batch?: { concurrency?: number }
): Promise<Array<BatchResult<unknown>>>
export async function chat(
	options: ChatOptions | Array<ChatOptions>,
	batch: { concurrency?: number } = {}
): Promise<unknown> {
	const provider = await resolve_provider()
	if (Array.isArray(options)) return provider.send(options, batch)
	return provider.send(options)
}
