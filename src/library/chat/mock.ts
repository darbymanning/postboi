import {
	ChatProvider,
	type ChatOptions,
	type ChatProviderOptions,
	type PreparedChat,
} from "./provider.js"
import type { BatchResult, RequestSpec } from "../transport.js"
import { PostboiError } from "../errors.js"
import { MockRecorder, type MockRecorderOptions } from "../mock_recorder.js"

/** A normalized snapshot of a chat message captured by the mock. */
export interface SentChat {
	to: string
	message: string
	title?: string
	username?: string
}

/** Options for the chat mock constructor. */
type Options = ChatProviderOptions & MockRecorderOptions

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
	#recorder: MockRecorder<SentChat>

	constructor({ fail, log, ...options }: Options = {}) {
		// A placeholder destination, so the mock is usable with no configuration at all.
		super({ ...options, default: { to: "mock://chat", ...options.default } })
		this.#recorder = new MockRecorder("chat", { fail, log }, log_chat)
	}

	/** Every message captured by this instance, in send order. */
	get sent(): Array<SentChat> {
		return this.#recorder.sent
	}

	/** The most recently captured message, or undefined if nothing has been sent. */
	get last(): SentChat | undefined {
		return this.#recorder.last
	}

	/** Forget all captured messages. */
	clear(): void {
		this.#recorder.clear()
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
			async (message) =>
				this.#recorder.capture({
					to: message.to,
					message: message.message,
					title: message.title,
					username: message.username,
				})
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

/** Print a captured chat message. */
function log_chat(captured: SentChat): void {
	const heading = captured.title ? `${captured.title} — ` : ""
	console.log(`postboi (mock chat) → ${captured.to}\n\n${heading}${captured.message}`)
}
