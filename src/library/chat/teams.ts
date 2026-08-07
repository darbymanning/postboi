import { ChatProvider, type PreparedChat, type WebhookChatOptions } from "./provider.js"
import type { RequestSpec } from "../transport.js"
import type { ProviderError } from "../errors.js"

type SendResponse = { ok: true }

/**
 * Microsoft Teams, via a **Power Automate Workflows** webhook.
 *
 * ⚠️ Not the old Office 365 connector. Microsoft blocked new connectors in August 2024 and
 * **disabled existing ones in May 2026**, so a legacy `office.com/webhook/…` URL no longer
 * delivers. The replacement is a Workflows webhook, created from the *Post to a channel
 * when a webhook request is received* template — its URL lives on
 * `logic.azure.com` / `powerplatform.com`.
 *
 * We post an Adaptive Card rather than the legacy MessageCard: Workflows still accepts
 * MessageCard for migration compatibility, but Microsoft's guidance is Adaptive Cards, and
 * MessageCard drops interactive elements.
 *
 * @example
 * ```ts
 * import Teams from "postboi/teams"
 *
 * const chat = new Teams({ webhook_url: process.env.TEAMS_WEBHOOK_URL })
 * await chat.send({ title: "Deploy", message: "Finished in 42s" })
 * ```
 */
export default class Teams extends ChatProvider<SendResponse> {
	protected readonly provider = "teams"

	constructor({ webhook_url, ...options }: WebhookChatOptions) {
		super({ ...options, default: { to: webhook_url, ...options.default } })
	}

	protected build_request(message: PreparedChat): RequestSpec {
		const body: Array<Record<string, unknown>> = []
		if (message.title) {
			body.push({
				type: "TextBlock",
				text: message.title,
				weight: "Bolder",
				size: "Medium",
				wrap: true,
			})
		}
		body.push({ type: "TextBlock", text: message.message, wrap: true })

		return {
			url: message.to,
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				type: "message",
				attachments: [
					{
						contentType: "application/vnd.microsoft.card.adaptive",
						content: {
							type: "AdaptiveCard",
							$schema: "http://adaptivecards.io/schemas/adaptive-card.json",
							version: "1.4",
							body,
						},
					},
				],
			}),
		}
	}

	protected parse_error(_response: Response, data: unknown): ProviderError | undefined {
		if (data === null || typeof data !== "object") return undefined
		// Power Automate answers { error: { code, message } } on rejection.
		const e = (data as { error?: Record<string, unknown> }).error
		if (e && typeof e.message === "string") {
			return { message: e.message, code: e.code as string | undefined }
		}
		return undefined
	}
}
