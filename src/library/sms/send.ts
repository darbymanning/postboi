/**
 * The zero-config `sms()`, mirroring `mail()`: resolve a provider from the environment,
 * intercept in development, send. Resolution itself is the shared channel machinery in
 * `channels.ts`; what stays here is the one genuinely SMS-specific policy — development
 * interception.
 */
import type { BatchResult } from "../transport.js"
import type { SmsOptions, SmsDefaults } from "./types.js"
import type { SmsProvider } from "./provider.js"
import { resolve_channel_provider, type ChannelResolution } from "../channels.js"
import { inbox_sink } from "../channel_inbox.js"
import { load_config } from "../config.js"
import { is_development, read_env } from "../env.js"

type SmsConstructor = new (options: Record<string, unknown>) => SmsProvider<unknown>

/** Lazy loaders keyed by `POSTBOI_SMS_PROVIDER` — one chunk per provider. */
const LOADERS: ChannelResolution<SmsProvider<unknown>>["loaders"] = {
	smsworks: () => import("./smsworks.js").then((m) => m.default as unknown as SmsConstructor),
	twilio: () => import("./twilio.js").then((m) => m.default as unknown as SmsConstructor),
	sns: () => import("./sns.js").then((m) => m.default as unknown as SmsConstructor),
	// Credential-free no-op, and the development fallback.
	mock: () => import("./mock.js").then((m) => m.default as unknown as SmsConstructor),
}

let announced_intercept = false

/**
 * Has the developer explicitly asked for real sends in development? Both switches are
 * opt-in and neither is the default, so the safe path is the one you get by doing nothing.
 */
function dev_sending_allowed(configured: boolean | undefined): boolean {
	if (read_env("POSTBOI_SMS_DEV") === "send") return true
	return configured === false
}

/** Read the SMS defaults from the environment. Only defined values are included. */
export function sms_env_defaults(): SmsDefaults {
	const out: SmsDefaults = {}
	const from = read_env("POSTBOI_SMS_FROM")
	const to = read_env("POSTBOI_SMS_TO")
	const country = read_env("POSTBOI_SMS_COUNTRY")
	if (from !== undefined) out.from = from
	if (to !== undefined) out.to = to
	if (country !== undefined) out.country = country
	return out
}

const RESOLUTION: ChannelResolution<SmsProvider<unknown>> = {
	channel: "sms",
	env_key: "POSTBOI_SMS_PROVIDER",
	loaders: LOADERS,
	env_defaults: sms_env_defaults as () => Record<string, unknown>,
	section: (config) => config.sms,
	init_flag: "--sms",
	dev_fallback_warning:
		"postboi: no SMS provider configured — logging texts to the console instead of sending. Run `bunx postboi init --sms` to send for real.",
}

async function resolve_provider(): Promise<SmsProvider<unknown>> {
	// Development interception, and deliberately stricter than email's. The dev inbox only
	// stands in front of mail when it's actually running; here we intercept whenever
	// NODE_ENV=development, because the failure modes aren't comparable — a stray email is
	// embarrassing, a stray text costs money, reaches a real handset, and cannot be recalled.
	// The way back out is explicit: `dev: { sms: false }` or POSTBOI_SMS_DEV=send. Checked
	// before any credential is looked at, so a configured provider is outranked, not consulted.
	const config = await load_config()
	if (is_development() && !dev_sending_allowed(config.dev?.sms)) {
		if (!announced_intercept) {
			announced_intercept = true
			console.warn(
				"postboi: development — texts are logged, not sent. Set `dev: { sms: false }` in postboi.config or POSTBOI_SMS_DEV=send to send for real."
			)
		}
		const Mock = await LOADERS.mock()
		// Captured texts land in the dev inbox when one is running, console otherwise.
		return new Mock({ log: true, sink: inbox_sink("sms"), default: sms_env_defaults() })
	}
	return resolve_channel_provider(RESOLUTION)
}

/**
 * Send a text without constructing anything. The provider is whichever
 * `POSTBOI_SMS_PROVIDER` names; its credentials and the `POSTBOI_SMS_*` defaults are read
 * from the environment on each call. Pass an array to send many.
 *
 * @example
 * ```ts
 * import { sms } from "postboi"
 *
 * await sms({ to: "+447788223344", message: "Your code is 4291" })
 * ```
 */
export function sms(options: SmsOptions): Promise<unknown>
export function sms(
	options: Array<SmsOptions>,
	batch?: { concurrency?: number }
): Promise<Array<BatchResult<unknown>>>
export async function sms(
	options: SmsOptions | Array<SmsOptions>,
	batch: { concurrency?: number } = {}
): Promise<unknown> {
	const provider = await resolve_provider()
	if (Array.isArray(options)) return provider.send(options, batch)
	return provider.send(options)
}
