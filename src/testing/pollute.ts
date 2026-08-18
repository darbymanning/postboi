/**
 * Fill the environment with every credential the registry knows about — the test-time
 * stand-in for a machine that has touched other software.
 *
 * A hand-written list of "names the wider world sets" has the same failure mode as a
 * hand-written list of `ambient` marks: it only covers what someone thought of. Twilio's
 * pair was missed by both, and `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` are the Twilio
 * SDK's zero-argument defaults — set by anyone using Voice or Verify, nothing to do with
 * sending a text. Deriving the list from `credential_env_keys()` instead means a provider
 * added tomorrow is polluted with on the next run, whether or not anyone remembered.
 *
 * Enabled by POSTBOI_TEST_POLLUTE=1, so CI can run the same suite twice: once on a clean
 * machine, once on a dirty one. Values are obvious junk — anything that escapes to a real
 * network is a bug this is trying to catch, not a credential worth protecting.
 *
 * Lives outside src/library on purpose: that directory is what `svelte-package` ships.
 */
import { credential_env_keys } from "../library/registry.js"

export function pollute_env(): Array<string> {
	const filled: Array<string> = []
	for (const key of credential_env_keys()) {
		if (process.env[key] !== undefined) continue
		// Shapes matter for the few providers that parse rather than pass through.
		process.env[key] = key.endsWith("_URL")
			? "https://example.invalid/not-a-real-hook"
			: `not-a-real-${key.toLowerCase()}`
		filled.push(key)
	}
	return filled
}
