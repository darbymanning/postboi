import { ChatProvider, type PreparedChat, type WebhookChatOptions } from "./provider.js"
import type { RequestSpec } from "../transport.js"
import type { ProviderError } from "../errors.js"

type SendResponse = { ok: true }

/**
 * Discord webhooks — https://discord.com/developers/docs/resources/webhook
 *
 * Like Slack, the destination lives in the URL. Discord answers `204 No Content` on
 * success, so there's nothing to parse.
 *
 * @example
 * ```ts
 * import Discord from "postboi/discord"
 *
 * const chat = new Discord({ webhook_url: process.env.DISCORD_WEBHOOK_URL })
 * await chat.send({ message: "Deploy finished" })
 * ```
 */
export default class Discord extends ChatProvider<SendResponse> {
	protected readonly provider = "discord"

	constructor({ webhook_url, ...options }: WebhookChatOptions) {
		super({ ...options, default: { to: webhook_url, ...options.default } })
	}

	protected build_request(message: PreparedChat): RequestSpec {
		const content = message.title ? `**${message.title}**\n${message.message}` : message.message
		return {
			url: message.to,
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				// 2000 characters is a hard API limit; truncate rather than have Discord
				// reject the whole post over a long stack trace.
				// 1999 + the one-character ellipsis lands exactly on the limit.
				content: content.length > 2000 ? `${content.slice(0, 1999)}…` : content,
				...(message.username ? { username: message.username } : {}),
			}),
		}
	}

	protected parse_error(_response: Response, data: unknown): ProviderError | undefined {
		if (data === null || typeof data !== "object") return undefined
		const e = data as Record<string, unknown>
		if (typeof e.message === "string") {
			return { message: e.message, code: e.code as string | number | undefined }
		}
		return undefined
	}
}
