/**
 * The shapes the inspect module speaks: what goes into {@link analyze} and
 * what a report looks like. Pure types — safe to import anywhere.
 */

/**
 * How much a finding matters. `error` means the email is broken for someone,
 * `warning` means it degrades somewhere that matters, `info` is worth knowing.
 */
export type Severity = "error" | "warning" | "info"

/** One client a compatibility finding lands on, and how hard. */
export interface ClientImpact {
	/** Stable client id, e.g. "outlook-windows". */
	client: string
	/** Display name, e.g. "Outlook (Windows)". */
	name: string
	support: "none" | "partial"
}

/** One thing the analysis noticed. */
export interface Finding {
	/**
	 * Stable check id ("gmail_clip", "images_missing_alt", …). Compatibility
	 * findings all carry id "compat" and name the feature in {@link feature}.
	 */
	id: string
	severity: Severity
	/** A human sentence. The whole story when you only read one field. */
	message: string
	/** For compatibility findings: the caniemail feature slug. */
	feature?: string
	/** For compatibility findings: the clients where the feature degrades. */
	clients?: Array<ClientImpact>
	/** How many times the problem occurs, when counting makes sense. */
	occurrences?: number
	/** Somewhere to read more, when there is somewhere. */
	url?: string
}

/** One hyperlink found in the body. */
export interface LinkInfo {
	url: string
	/** The link's visible text, when it has any. */
	text?: string
	scheme: "https" | "http" | "mailto" | "tel" | "other"
}

/** One image found in the body. */
export interface ImageInfo {
	src: string
	alt?: string
	width?: string
	height?: string
}

/**
 * What to analyze. Everything is optional — pass what you have and the checks
 * that need more stay silent. Header-dependent checks (List-Unsubscribe) only
 * run when {@link headers} is provided, so a bare HTML string is never nagged
 * about headers it couldn't possibly carry.
 */
export interface AnalyzeInput {
	html?: string
	/** The plain-text alternative, when one exists. */
	text?: string
	subject?: string
	/** Header names → values, e.g. from a parsed MIME message. Matched case-insensitively. */
	headers?: Record<string, string>
	/** Raw message size in bytes, when known — feeds the message-size check. */
	size_bytes?: number
	/**
	 * What the input is: a whole `"message"` (the default), or bare `"html"` — a
	 * file, an editor buffer — which has nowhere to carry a plain-text part, so
	 * its absence proves nothing and that check stays quiet.
	 */
	source?: "message" | "html"
}

/** What {@link analyze} hands back. */
export interface Report {
	findings: Array<Finding>
	/** The worst severity present, or "pass" when the list is empty. */
	status: "pass" | Severity
	size: {
		/** UTF-8 byte length of the HTML body. */
		html_bytes: number
		/** Whether Gmail will clip the message (~102KB of HTML). */
		gmail_clip: boolean
		/** The raw message size, echoed back when the input carried one. */
		message_bytes?: number
	}
	links: Array<LinkInfo>
	images: Array<ImageInfo>
}

/** The outcome of fetching one link with {@link check_links}. */
export interface LinkCheck {
	url: string
	ok: boolean
	/** HTTP status when the request completed. */
	status?: number
	/** Why the request failed when it did not complete. */
	error?: string
}
