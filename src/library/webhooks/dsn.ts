/**
 * RFC 3464 delivery status notification (DSN) parsing — the bounce reports SMTP servers
 * mail back to the return-path when delivery fails (or, with DSN requested, succeeds).
 *
 * `parse_dsn` is deliberately forgiving: anything that isn't a `multipart/report;
 * report-type=delivery-status` message returns `[]` rather than throwing, so it can sit
 * in an inbound-mail path and only ever speak up for actual DSNs. Non-3464 bounces
 * (qmail-style prose) also return `[]` — the raw message is the caller's escape hatch.
 */
import type { WebhookEvent, WebhookEventType, BounceDetail } from "./index.js"
import { to_date } from "./shared.js"

/** Split raw message text into header block and body at the first blank line. */
function split_message(raw: string): { headers: string; body: string } {
	const normalized = raw.replace(/\r\n/g, "\n")
	const blank = normalized.indexOf("\n\n")
	if (blank === -1) return { headers: normalized, body: "" }
	return { headers: normalized.slice(0, blank), body: normalized.slice(blank + 2) }
}

/** Unfold header continuation lines and read fields into a lowercase-keyed map. */
function parse_headers(block: string): Map<string, string> {
	const unfolded = block.replace(/\n[ \t]+/g, " ")
	const fields = new Map<string, string>()
	for (const line of unfolded.split("\n")) {
		const colon = line.indexOf(":")
		if (colon === -1) continue
		const name = line.slice(0, colon).trim().toLowerCase()
		// First occurrence wins — a forged duplicate can't shadow the real field.
		if (!fields.has(name)) fields.set(name, line.slice(colon + 1).trim())
	}
	return fields
}

/** Extract a content-type parameter (boundary, report-type), unquoting as needed. */
function ct_param(content_type: string, name: string): string | undefined {
	const match = content_type.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|[^;\\s]+)`, "i"))
	if (!match) return undefined
	return match[2] ?? match[1]
}

/** Split a multipart body into its parts (the preamble and epilogue drop away). */
function split_parts(body: string, boundary: string): Array<string> {
	const parts: Array<string> = []
	const lines = body.split("\n")
	let current: Array<string> | undefined
	for (const line of lines) {
		if (line.trimEnd() === `--${boundary}` || line.trimEnd() === `--${boundary}--`) {
			if (current) parts.push(current.join("\n"))
			current = line.trimEnd() === `--${boundary}` ? [] : undefined
			continue
		}
		current?.push(line)
	}
	return parts
}

/** `rfc822; user@example.com` → `user@example.com` (the address after the type token). */
function dsn_address(value: string | undefined): string | undefined {
	if (!value) return undefined
	const semicolon = value.indexOf(";")
	const address = (semicolon === -1 ? value : value.slice(semicolon + 1)).trim()
	return address || undefined
}

const ACTIONS: Record<string, WebhookEventType> = {
	failed: "bounced",
	delayed: "delayed",
	delivered: "delivered",
	// "relayed" and "expanded" say nothing about the recipient's mailbox — ignored.
}

/** Classify an RFC 3463 status code: 5.x.x permanent, 4.x.x transient. */
function bounce_category(status: string | undefined): BounceDetail["category"] {
	if (status?.startsWith("5")) return "hard"
	if (status?.startsWith("4")) return "soft"
	return "unknown"
}

/**
 * Parse an RFC 3464 delivery status notification into normalized events — one per
 * recipient the report covers. Anything that isn't a DSN returns `[]`; this never
 * throws on ordinary mail.
 */
export function parse_dsn(raw: string): Array<WebhookEvent> {
	const message = split_message(raw)
	const headers = parse_headers(message.headers)
	const content_type = headers.get("content-type") ?? ""

	if (
		!/multipart\/report/i.test(content_type) ||
		!/delivery-status/i.test(ct_param(content_type, "report-type") ?? "")
	) {
		return []
	}
	const boundary = ct_param(content_type, "boundary")
	if (!boundary) return []

	let status_body: string | undefined
	let original_headers: Map<string, string> | undefined
	for (const part of split_parts(message.body, boundary)) {
		const { headers: part_head, body: part_body } = split_message(part.replace(/^\n+/, ""))
		const part_type = parse_headers(part_head).get("content-type") ?? ""
		if (/message\/(?:global-)?delivery-status/i.test(part_type)) {
			status_body = part_body
		} else if (/message\/(?:global\b|rfc822)|text\/rfc822-headers/i.test(part_type)) {
			// The returned original — its own headers carry the Message-ID and Subject.
			original_headers = parse_headers(split_message(part_body.replace(/^\n+/, "")).headers)
		}
	}
	if (!status_body) return []

	// The delivery-status part is field groups separated by blank lines: one per-message
	// group (Reporting-MTA, Arrival-Date), then one group per recipient.
	const groups = status_body
		.split(/\n{2,}/)
		.map((group) => parse_headers(group))
		.filter((group) => group.size > 0)
	const per_message = groups.find((group) => group.has("reporting-mta")) ?? groups[0]

	const events: Array<WebhookEvent> = []
	for (const group of groups) {
		const action = group.get("action")?.toLowerCase()
		const type = action ? ACTIONS[action] : undefined
		if (!type) continue

		const status = group.get("status")
		// Diagnostic-Code carries its own type token ("smtp; 550 ..."), same shape as addresses.
		const diagnostic = dsn_address(group.get("diagnostic-code"))
		events.push({
			type,
			provider: "smtp",
			message_id: original_headers?.get("message-id"),
			email:
				dsn_address(group.get("final-recipient")) ?? dsn_address(group.get("original-recipient")),
			timestamp: to_date(
				group.get("last-attempt-date") ?? per_message?.get("arrival-date") ?? headers.get("date")
			),
			subject: original_headers?.get("subject"),
			bounce:
				type === "bounced"
					? { category: bounce_category(status), detail: diagnostic ?? status }
					: undefined,
			raw: Object.fromEntries(group),
		})
	}
	return events
}
