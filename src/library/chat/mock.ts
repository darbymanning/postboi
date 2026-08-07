import {
	ChatProvider,
	type ChatOptions,
	type ChatProviderOptions,
	type PreparedChat,
} from "./provider.js"
import type { BatchResult, RequestSpec } from "../transport.js"
import { PostboiError } from "../errors.js"

/** A normalized snapshot of a chat message captured by the mock. */
export interface SentChat {
	to: string
	message: string
	title?: string
	username?: string
}

/** Options for the chat mock constructor. */
type Options = ChatProviderOptions & {
	/** When true, every `send` rejects with a simulated {@link PostboiError}. */
	fail?: boolean
	/** Print each captured message. Off by default so tests stay quiet. */
	log?: boolean
}

type SendResponse = { id: string; message: SentChat }

/**
 * In-memory mock chat provider, and the development fallback when nothing is configured.
 *
 * Unlike SMS, chat is *not* intercepted in development by default: posting to your own
 * Slack channel while developing is usually the point, costs nothing, and can be deleted.
 *
 * @example
 * ```ts
 * import MockChat from "postboi/chat-mock"
 *
 * const chat = new MockChat({ default: { to: "https://example.test/hook" } })
 * await chat.send({ message: "hi" })
 * expect(chat.last?.message).toBe("hi")
 * ```
 */
export default class MockChat extends ChatProvider<SendResponse> {
	protected readonly provider = "mock"
	#fail: boolean
	#log: boolean
	#counter = 0

	/** Every message captured by this instance, in send order. */
	readonly sent: Array<SentChat> = []

	constructor({ fail, log, ...options }: Options = {}) {
		// A placeholder destination, so the mock is usable with no configuration at all.
		super({ ...options, default: { to: "mock://chat", ...options.default } })
		this.#fail = fail ?? false
		this.#log = log ?? false
	}

	/** The most recently captured message, or undefined if nothing has been sent. */
	get last(): SentChat | undefined {
		return this.sent.at(-1)
	}

	/** Forget all captured messages. */
	clear(): void {
		this.sent.length = 0
	}

	send(options: ChatOptions): Promise<SendResponse>
	send(
		options: Array<ChatOptions>,
		batch?: { concurrency?: number }
	): Promise<Array<BatchResult<SendResponse>>>
	async send(
		options: ChatOptions | Array<ChatOptions>,
		batch: { concurrency?: number } = {}
	): Promise<SendResponse | Array<BatchResult<SendResponse>>> {
		if (Array.isArray(options)) {
			return this.run_batch(options, (one) => this.send(one), batch)
		}
		return this.with_hooks(
			() => this.prepare_chat(options),
			async (message) => {
				if (this.#fail) {
					throw new PostboiError({
						provider: "mock",
						channel: "chat",
						message: "Simulated failure from mock chat provider",
					})
				}
				const captured: SentChat = {
					to: message.to,
					message: message.message,
					title: message.title,
					username: message.username,
				}
				this.sent.push(captured)
				if (this.#log) {
					const heading = captured.title ? `${captured.title} — ` : ""
					console.log(`postboi (mock chat) → ${captured.to}\n\n${heading}${captured.message}`)
				}
				return { id: `mock-chat-${++this.#counter}`, message: captured }
			}
		)
	}

	// Never reached — `send` is overridden and nothing calls through to the HTTP path.
	protected build_request(_message: PreparedChat): RequestSpec {
		throw new PostboiError({
			provider: "mock",
			channel: "chat",
			message: "The mock chat provider does not make requests",
		})
	}
}
