import {
	PushProvider,
	type PreparedPush,
	type PushOptions,
	type PushProviderOptions,
} from "./provider.js"
import type { BatchResult, RequestSpec } from "../transport.js"
import { PostboiError } from "../errors.js"

/** A normalized snapshot of a notification captured by the mock. */
export interface SentPush {
	to: string
	title?: string
	message: string
	url?: string
	data?: Record<string, unknown>
}

/** Options for the push mock constructor. */
type Options = PushProviderOptions & {
	/** When true, every `send` rejects with a simulated {@link PostboiError}. */
	fail?: boolean
	/** When true, every `send` rejects as though the subscription had expired (410). */
	expired?: boolean
	/** Print each captured notification. Off by default so tests stay quiet. */
	log?: boolean
}

type SendResponse = { id: string; message: SentPush }

/**
 * In-memory mock push provider, and the development fallback.
 *
 * The `expired` option is worth knowing about: expiring subscriptions are the normal
 * steady state of push, not an edge case, and the handling is easy to get wrong — so it's
 * simulatable rather than something you discover in production.
 *
 * @example
 * ```ts
 * import MockPush from "postboi/push-mock"
 *
 * const notify = new MockPush({ expired: true })
 * await notify.send({ to: "tok", message: "hi" }).catch((e) => {
 *   if (MockPush.is_expired(e)) forget_subscription()
 * })
 * ```
 */
export default class MockPush extends PushProvider<SendResponse> {
	protected readonly provider = "mock"
	#fail: boolean
	#expired: boolean
	#log: boolean
	#counter = 0

	/** Every notification captured by this instance, in send order. */
	readonly sent: Array<SentPush> = []

	constructor({ fail, expired, log, ...options }: Options = {}) {
		super({ ...options, default: { to: "mock-token", ...options.default } })
		this.#fail = fail ?? false
		this.#expired = expired ?? false
		this.#log = log ?? false
	}

	/** The most recently captured notification, or undefined if nothing has been sent. */
	get last(): SentPush | undefined {
		return this.sent.at(-1)
	}

	/** Forget all captured notifications. */
	clear(): void {
		this.sent.length = 0
	}

	send(options: PushOptions): Promise<SendResponse>
	send(
		options: Array<PushOptions>,
		batch?: { concurrency?: number }
	): Promise<Array<BatchResult<SendResponse>>>
	async send(
		options: PushOptions | Array<PushOptions>,
		batch: { concurrency?: number } = {}
	): Promise<SendResponse | Array<BatchResult<SendResponse>>> {
		if (Array.isArray(options)) {
			return this.run_batch(options, (one) => this.send(one), batch)
		}
		return this.with_hooks(
			() => this.prepare_push(options),
			async (message) => {
				if (this.#expired) {
					throw new PostboiError({
						provider: "mock",
						channel: "push",
						status: 410,
						code: "expired_subscription",
						message: "Push subscription has expired or been unsubscribed (simulated).",
					})
				}
				if (this.#fail) {
					throw new PostboiError({
						provider: "mock",
						channel: "push",
						message: "Simulated failure from mock push provider",
					})
				}
				const captured: SentPush = {
					to: typeof message.to === "string" ? message.to : message.to.endpoint,
					title: message.title,
					message: message.message,
					url: message.url,
					data: message.data,
				}
				this.sent.push(captured)
				if (this.#log) {
					const heading = captured.title ? `${captured.title}\n` : ""
					console.log(`postboi (mock push) → ${captured.to}\n\n${heading}${captured.message}`)
				}
				return { id: `mock-push-${++this.#counter}`, message: captured }
			}
		)
	}

	// Never reached — `send` is overridden and nothing calls through to the HTTP path.
	protected build_request(_message: PreparedPush): RequestSpec {
		throw new PostboiError({
			provider: "mock",
			channel: "push",
			message: "The mock push provider does not make requests",
		})
	}

	protected parse_response(_response: Response, _data: unknown): SendResponse {
		throw new PostboiError({
			provider: "mock",
			channel: "push",
			message: "The mock push provider does not make requests",
		})
	}
}
