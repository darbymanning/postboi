/**
 * The zero-config `sms()`, mirroring `mail()` in `mail.ts`: resolve a provider from the
 * environment, intercept in development, send.
 */
import type { BatchResult } from "../transport.js"
import type { SmsOptions, SmsDefaults } from "./types.js"
import type { SmsProvider } from "./provider.js"
import { PostboiError } from "../errors.js"
import { find_sms_provider } from "../registry.js"
import { load_config } from "../config.js"
import { ensure_env_loaded, is_development, read_env } from "../env.js"

type SmsConstructor = new (options: Record<string, unknown>) => SmsProvider<unknown>

/**
 * Lazy loaders for every configurable SMS provider, keyed by `POSTBOI_SMS_PROVIDER`.
 * Explicit dynamic imports keep each provider in its own chunk.
 */
const LOADERS: Record<string, () => Promise<SmsConstructor>> = {
	smsworks: () => import("./smsworks.js").then((m) => m.default as unknown as SmsConstructor),
	twilio: () => import("./twilio.js").then((m) => m.default as unknown as SmsConstructor),
	sns: () => import("./sns.js").then((m) => m.default as unknown as SmsConstructor),
	// Credential-free no-op, and the development fallback.
	mock: () => import("./mock.js").then((m) => m.default as unknown as SmsConstructor),
}

let warned_dev_fallback = false
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

/**
 * Construct the SMS provider named by `POSTBOI_SMS_PROVIDER` from the environment.
 *
 * `intercept` is set on the send path. In development it substitutes the mock **before any
 * credential is looked at**, so a configured provider is outranked rather than consulted.
 */
async function resolve_provider({ intercept = false } = {}): Promise<SmsProvider<unknown>> {
	const config = await load_config()
	await ensure_env_loaded()

	const key = read_env("POSTBOI_SMS_PROVIDER") ?? config.sms?.provider

	// Development interception, and deliberately stricter than email's. The dev inbox only
	// stands in front of mail when it's actually running; here we intercept whenever
	// NODE_ENV=development, because the failure modes aren't comparable — a stray email is
	// embarrassing, a stray text costs money, reaches a real handset, and cannot be recalled.
	// The way back out is explicit: `dev: { sms: false }` or POSTBOI_SMS_DEV=send.
	if (intercept && is_development() && !dev_sending_allowed(config.dev?.sms)) {
		if (!announced_intercept) {
			announced_intercept = true
			console.warn(
				"postboi: development — texts are logged, not sent. Set `dev: { sms: false }` in postboi.config or POSTBOI_SMS_DEV=send to send for real."
			)
		}
		const Mock = await import("./mock.js").then((m) => m.default)
		return new Mock({ log: true, default: sms_env_defaults() })
	}

	// Nothing configured. In development that's a fresh clone, so log rather than fail;
	// anywhere else it's a broken deploy, and a silently-dropped OTP locks people out.
	if (!key) {
		if (is_development()) {
			if (!warned_dev_fallback) {
				warned_dev_fallback = true
				console.warn(
					"postboi: no SMS provider configured — logging texts to the console instead of sending. Run `bunx postboi init --sms` to send for real."
				)
			}
			const Mock = await import("./mock.js").then((m) => m.default)
			return new Mock({ log: true, default: sms_env_defaults() })
		}
		throw new PostboiError({
			provider: "postboi",
			channel: "sms",
			code: "no_sms_provider",
			message:
				'No SMS provider configured. Run `bunx postboi init --sms`, set POSTBOI_SMS_PROVIDER, or import one directly, e.g. `import Twilio from "postboi/twilio"`.',
		})
	}

	const load = LOADERS[key]
	if (!load) {
		throw new PostboiError({
			provider: "postboi",
			channel: "sms",
			code: "unknown_sms_provider",
			message: `Unknown POSTBOI_SMS_PROVIDER "${key}".`,
		})
	}

	const options: Record<string, unknown> = { default: sms_env_defaults() }
	// `meta` is undefined for credential-free providers (the mock) with no registry entry.
	const meta = find_sms_provider(key)
	for (const field of meta?.fields ?? []) {
		const value = read_env(field.env) ?? config.sms?.options?.[field.arg] ?? field.default
		if (value === undefined) {
			throw new PostboiError({
				provider: key,
				channel: "sms",
				code: "missing_env",
				message: `SMS provider "${key}" needs ${field.env} — set it in the environment${field.secret ? "" : ` or as \`sms.options.${field.arg}\` in postboi.config.ts`}. Run \`bunx postboi init --sms\`.`,
			})
		}
		options[field.arg] = value
	}

	if (key === "mock") options.log = true

	const Provider = await load()
	return new Provider(options)
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
	const provider = await resolve_provider({ intercept: true })
	if (Array.isArray(options)) return provider.send(options, batch)
	return provider.send(options)
}
