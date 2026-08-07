import {
	SmsProvider,
	type PreparedSms,
	type SmsOptions,
	type SmsProviderOptions,
} from "./provider.js"
import type { BatchResult, RequestSpec } from "../transport.js"
import { PostboiError } from "../errors.js"
import { segments } from "./phone.js"

/** A normalized snapshot of a text captured by the mock provider. */
export interface SentSms {
	to: Array<string>
	from?: string
	message: string
	/** Segment count and encoding — the unit providers actually bill. */
	segments: { count: number; encoding: "gsm7" | "ucs2"; units: number }
	/**
	 * When the send asked for future delivery. Captured for the same reason the email mock
	 * captures it: "sent" and "queued for Tuesday" are otherwise indistinguishable.
	 */
	scheduled_at?: Date
}

/** Options for the SMS mock constructor. */
type Options = SmsProviderOptions & {
	/** When true, every `send` rejects with a simulated {@link PostboiError}. */
	fail?: boolean
	/**
	 * Print each captured text to the console. Off by default so tests stay quiet;
	 * `sms()` turns it on whenever it resolves the mock itself, because there the point is
	 * seeing the code you would have texted.
	 */
	log?: boolean
}

type SendResponse = { id: string; message: SentSms }

/**
 * In-memory mock SMS provider. Runs the same normalization and validation as a real one —
 * defaults, E.164 conversion, segment counting — but records instead of sending.
 *
 * This is also what stands in front of a real provider in development, which matters more
 * for SMS than for email: a stray dev send costs real money and reaches a real handset
 * with no way to take it back.
 *
 * @example
 * ```ts
 * import MockSms from "postboi/sms-mock"
 *
 * const text = new MockSms({ default: { from: "POSTBOI", country: "GB" } })
 * await text.send({ to: "07788 223344", message: "hi" })
 * expect(text.last?.to).toEqual(["+447788223344"])
 * ```
 */
export default class MockSms extends SmsProvider<SendResponse> {
	protected readonly provider = "mock"
	protected override readonly requires_from = false
	protected override readonly supports_scheduling = true
	#fail: boolean
	#log: boolean
	#counter = 0

	/** Every text captured by this instance, in send order. */
	readonly sent: Array<SentSms> = []

	constructor({ fail, log, ...options }: Options = {}) {
		super(options)
		this.#fail = fail ?? false
		this.#log = log ?? false
	}

	/** The most recently captured text, or undefined if nothing has been sent. */
	get last(): SentSms | undefined {
		return this.sent.at(-1)
	}

	/** Forget all captured texts. */
	clear(): void {
		this.sent.length = 0
	}

	send(options: SmsOptions): Promise<SendResponse>
	send(
		options: Array<SmsOptions>,
		batch?: { concurrency?: number }
	): Promise<Array<BatchResult<SendResponse>>>
	async send(
		options: SmsOptions | Array<SmsOptions>,
		batch: { concurrency?: number } = {}
	): Promise<SendResponse | Array<BatchResult<SendResponse>>> {
		if (Array.isArray(options)) {
			return this.run_batch(options, (one) => this.send(one), batch)
		}
		return this.with_hooks(
			() => this.prepare_sms(options),
			async (message) => {
				if (this.#fail) {
					throw new PostboiError({
						provider: "mock",
						channel: "sms",
						message: "Simulated failure from mock SMS provider",
					})
				}
				const captured: SentSms = {
					to: message.to,
					from: message.from,
					message: message.message,
					segments: segments(message.message),
					scheduled_at: message.scheduled_at,
				}
				this.sent.push(captured)
				if (this.#log) log_sms(captured)
				return { id: `mock-sms-${++this.#counter}`, message: captured }
			}
		)
	}

	// Never reached — `send` is overridden and nothing calls through to the HTTP path.
	protected build_request(_message: PreparedSms): RequestSpec {
		throw new PostboiError({
			provider: "mock",
			channel: "sms",
			message: "The mock SMS provider does not make requests",
		})
	}

	protected parse_response(_response: Response, _data: unknown): SendResponse {
		throw new PostboiError({
			provider: "mock",
			channel: "sms",
			message: "The mock SMS provider does not make requests",
		})
	}
}

/**
 * Print a captured text. The body goes out whole: the reason to read a dev text in the
 * terminal is almost always a code inside it, and a truncated line is useless.
 */
function log_sms(message: SentSms): void {
	const lines = [
		`postboi (mock sms): ${message.to.join(", ")}`,
		...(message.from ? [`  from: ${message.from}`] : []),
		`  cost: ${message.segments.count} segment${message.segments.count === 1 ? "" : "s"} (${message.segments.encoding})`,
	]
	if (message.scheduled_at) lines.push(`  send: ${message.scheduled_at.toISOString()}`)
	lines.push("", message.message.trim())
	console.log(lines.join("\n"))
}
