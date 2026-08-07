/**
 * The zero-config `chat()`, on the shared channel resolution in `channels.ts`.
 *
 * Note there is **no development interception** here, unlike SMS. Posting to your own
 * Slack channel while developing is normally the point — it costs nothing, reaches only
 * your own team, and can be deleted. The interception SMS gets exists because a stray text
 * costs money and can't be recalled; neither applies.
 */
import type { BatchResult } from "../transport.js"
import type { ChatDefaults, ChatOptions } from "./types.js"
import type { ChatProvider } from "./provider.js"
import { resolve_channel_provider, type ChannelResolution } from "../channels.js"
import { find_chat_provider } from "../registry.js"
import { read_env } from "../env.js"

type ChatConstructor = new (options: Record<string, unknown>) => ChatProvider<unknown>

/** Lazy loaders keyed by `POSTBOI_CHAT_PROVIDER`. */
const LOADERS: ChannelResolution<ChatProvider<unknown>>["loaders"] = {
	slack: () => import("./slack.js").then((m) => m.default as unknown as ChatConstructor),
	discord: () => import("./discord.js").then((m) => m.default as unknown as ChatConstructor),
	teams: () => import("./teams.js").then((m) => m.default as unknown as ChatConstructor),
	telegram: () => import("./telegram.js").then((m) => m.default as unknown as ChatConstructor),
	mock: () => import("./mock.js").then((m) => m.default as unknown as ChatConstructor),
}

/** Read the chat defaults from the environment. Only defined values are included. */
export function chat_env_defaults(): ChatDefaults {
	const out: ChatDefaults = {}
	const to = read_env("POSTBOI_CHAT_TO")
	const username = read_env("POSTBOI_CHAT_USERNAME")
	if (to !== undefined) out.to = to
	if (username !== undefined) out.username = username
	return out
}

const RESOLUTION: ChannelResolution<ChatProvider<unknown>> = {
	channel: "chat",
	env_key: "POSTBOI_CHAT_PROVIDER",
	loaders: LOADERS,
	find: find_chat_provider,
	env_defaults: chat_env_defaults as () => Record<string, unknown>,
	section: (config) => config.chat,
	init_flag: "--chat",
	dev_fallback_warning:
		"postboi: no chat provider configured — logging messages to the console instead of posting. Run `bunx postboi init --chat` to post for real.",
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
	const provider = await resolve_channel_provider(RESOLUTION)
	if (Array.isArray(options)) return provider.send(options, batch)
	return provider.send(options)
}
