/**
 * `send()` — one call, every channel.
 *
 * Two modes, chosen by whether `channels` is given: **fan out** to everything in `to`, or
 * walk a **fallback chain** until one channel delivers. Either way the work happens in the
 * caller's process — channel selection, ordering and per-channel results all execute here,
 * and only the transport is ever somebody else's.
 */
import type { BodyInput, SendOptions } from "./index.js"
import type { SmsOptions, Phone } from "./sms/types.js"
import type { ChatOptions } from "./chat/types.js"
import { PostboiError, type Channel } from "./errors.js"

/**
 * Default channel order for `channels: "cheapest"`.
 *
 * The spread is total rather than marginal, which is what makes this worth doing: push and
 * chat cost nothing per message, email is fractions of a penny, and an SMS into Western
 * Europe can be 2.8p or more. Preferring push over SMS doesn't save a percentage — it saves
 * the entire cost of the message.
 */
const COST_ORDER: ReadonlyArray<Channel> = ["push", "chat", "email", "sms"]

/** Where to reach someone, keyed by channel. Never inferred — you say which is which. */
export interface Recipients {
	email?: SendOptions["to"]
	sms?: Array<Phone> | Phone
	chat?: string
	/** Reserved for the push channel. */
	push?: string
}

/** The outcome for one channel. */
export type ChannelResult =
	| { channel: Channel; ok: true; response: unknown }
	| { channel: Channel; ok: false; error: PostboiError }

/** What `send()` resolves to. It never rejects when at least one channel was attempted. */
export interface SendResult {
	/** True when at least one channel delivered. */
	ok: boolean
	/** Every channel attempted, in order. In a fallback chain, stops at the first success. */
	results: Array<ChannelResult>
	/** The channel that delivered. In fan-out mode, the first that succeeded. */
	delivered?: Channel
}

/** Options for {@link send}. */
export interface FanOutOptions {
	/** Where to reach the person, keyed by channel. */
	to: Recipients
	/**
	 * The plain-text message. Used as the SMS and chat body, and as email's `text` part —
	 * so the common case is one string reaching every channel.
	 */
	message?: string
	/** Email subject, and the chat message's title. */
	subject?: string
	/** Email HTML body. Falls back to `message` when omitted. */
	body?: BodyInput
	/**
	 * Fallback chain instead of fan-out: try channels in this order and **stop at the first
	 * success**. `"cheapest"` uses the built-in cost order (push → chat → email → sms).
	 */
	channels?: Array<Channel> | "cheapest"
	/** Per-channel overrides, merged over what the shared fields produce. */
	email?: Partial<SendOptions>
	/** Per-channel overrides, merged over what the shared fields produce. */
	sms?: Partial<SmsOptions>
	/** Per-channel overrides, merged over what the shared fields produce. */
	chat?: Partial<ChatOptions>
}

/** Build the per-channel options from the shared fields plus that channel's overrides. */
function options_for(channel: Channel, options: FanOutOptions): unknown {
	const { to, message, subject, body } = options
	switch (channel) {
		case "email":
			return {
				to: to.email,
				subject,
				// A caller who only passed `message` still gets a valid email: the text
				// becomes the body rather than sending an empty one.
				body: body ?? message ?? "",
				...(message !== undefined && body !== undefined ? { text: message } : {}),
				...options.email,
			}
		case "sms":
			return { to: to.sms, message: message ?? "", ...options.sms }
		case "chat":
			return { to: to.chat, message: message ?? "", title: subject, ...options.chat }
		default:
			return undefined
	}
}

/** Dispatch one channel through its own zero-config entry point. */
async function deliver(channel: Channel, options: FanOutOptions): Promise<unknown> {
	const built = options_for(channel, options)
	switch (channel) {
		case "email": {
			const { mail } = await import("./mail.js")
			return mail(built as SendOptions)
		}
		case "sms": {
			const { sms } = await import("./sms/send.js")
			return sms(built as SmsOptions)
		}
		case "chat": {
			const { chat } = await import("./chat/send.js")
			return chat(built as ChatOptions)
		}
		default:
			throw new PostboiError({
				provider: "postboi",
				code: "unsupported_channel",
				message: `The "${channel}" channel isn't available yet.`,
			})
	}
}

/** Which channels to attempt, in order. */
function resolve_channels(options: FanOutOptions): Array<Channel> {
	const addressed = (Object.keys(options.to) as Array<Channel>).filter(
		(c) => options.to[c as keyof Recipients] !== undefined
	)
	if (!options.channels) return addressed
	const order = options.channels === "cheapest" ? COST_ORDER : options.channels
	// An explicit order still can't reach a channel with no address, so intersect rather
	// than trusting the list — otherwise "cheapest" would try every channel every time.
	return order.filter((c) => addressed.includes(c))
}

/**
 * Send one message across every channel you can reach someone on.
 *
 * **Fan-out** (default) attempts every channel in `to` and returns a result for each — one
 * channel failing never loses the others. **Fallback** (`channels`) walks the list and stops
 * at the first success, which is what you want for a code or an alert that only needs to
 * arrive once.
 *
 * @example
 * ```ts
 * import { send } from "postboi"
 *
 * // fan out
 * await send({
 * 	to: { email: "ada@example.com", sms: "+447788223344" },
 * 	subject: "Your order shipped",
 * 	message: "Your order shipped",
 * })
 *
 * // cheapest channel that works, and nothing else
 * const result = await send({
 * 	to: { chat: hook, sms: "+447788223344" },
 * 	channels: "cheapest",
 * 	message: "Your code is 4291",
 * })
 * result.delivered // "chat"
 * ```
 */
export async function send(options: FanOutOptions): Promise<SendResult> {
	const channels = resolve_channels(options)
	if (channels.length === 0) {
		throw new PostboiError({
			provider: "postboi",
			code: "no_recipient",
			message:
				"No channel to send on — `to` needs at least one of email, sms or chat with an address.",
		})
	}

	const results: Array<ChannelResult> = []
	const fallback = options.channels !== undefined

	if (fallback) {
		// Sequential on purpose: the whole point is not paying for the next channel once one
		// has worked. A failure here is not fatal — it's the signal to try the next one,
		// which is also how a template-only channel (WhatsApp outside its 24h window) will
		// hand off rather than fail the send.
		for (const channel of channels) {
			try {
				results.push({ channel, ok: true, response: await deliver(channel, options) })
				return { ok: true, results, delivered: channel }
			} catch (error) {
				results.push({ channel, ok: false, error: normalize(error, channel) })
			}
		}
		return { ok: false, results }
	}

	// Fan-out runs concurrently — the channels are independent, and one slow provider
	// shouldn't hold up the rest.
	const settled = await Promise.all(
		channels.map(async (channel): Promise<ChannelResult> => {
			try {
				return { channel, ok: true, response: await deliver(channel, options) }
			} catch (error) {
				return { channel, ok: false, error: normalize(error, channel) }
			}
		})
	)
	results.push(...settled)
	const delivered = results.find((r) => r.ok)?.channel
	return { ok: delivered !== undefined, results, delivered }
}

/** Normalize whatever a channel threw, making sure it carries the channel that failed. */
function normalize(error: unknown, channel: Channel): PostboiError {
	if (error instanceof PostboiError) {
		// A channel entry point can throw before a provider exists (nothing configured), in
		// which case the error has no channel yet — fill it in so a caller reading results
		// never has to guess which leg this came from.
		if (error.channel) return error
		return new PostboiError({
			provider: error.provider,
			channel,
			status: error.status,
			code: error.code,
			message: error.message,
			raw: error.raw,
		})
	}
	return new PostboiError({
		provider: "postboi",
		channel,
		message: error instanceof Error ? error.message : String(error),
		raw: error,
	})
}
