/**
 * Opt-out keywords — the words a person texts back to say "stop".
 *
 * Every carrier and every provider recognises the same short list, because the CTIA
 * (US) and the UK networks settled on it years ago and everyone else copied it. A
 * reply is an opt-out when its **whole** trimmed body is one of these words, case
 * and trailing punctuation aside: "STOP" and "stop." opt out, "please stop texting
 * me" does not — that one is a person to talk to, not a flag to set.
 *
 * Used by the Twilio poll adapter to turn an inbound reply into an `unsubscribed`
 * event, and exported from the package root for anyone handling their own inbound
 * webhook.
 */

/** The industry-standard opt-out keywords, plus the French one Canada requires. */
export const OPT_OUT_KEYWORDS: ReadonlyArray<string> = [
	"STOP",
	"STOPALL",
	"UNSUBSCRIBE",
	"CANCEL",
	"END",
	"QUIT",
	"ARRET",
]

/**
 * Is this reply an opt-out? True when the whole message, trimmed and stripped of trailing
 * punctuation, is one of {@link OPT_OUT_KEYWORDS} in any case.
 *
 * ```ts
 * is_opt_out("STOP") // true
 * is_opt_out("stop.") // true
 * is_opt_out("Please stop") // false — a sentence, not a keyword
 * ```
 */
export function is_opt_out(text: string | undefined | null): boolean {
	if (!text) return false
	const word = text
		.trim()
		.replace(/[.!?,;:]+$/u, "")
		.trim()
		.toUpperCase()
	// "ARRÊT" with its circumflex is how a French speaker types it; the keyword list
	// carries the bare form the carriers document, so fold the accent before matching.
	const folded = word.normalize("NFD").replace(/[̀-ͯ]/g, "")
	return OPT_OUT_KEYWORDS.includes(folded)
}
