/**
 * SMTP poll adapter — reads the return-path's POP3 mailbox and turns RFC 3464 delivery
 * status notifications into normalized events. SMTP itself has no event API; the bounce
 * mailbox is where the network reports back.
 *
 * Non-destructive by default: messages stay on the server and the cursor tracks their
 * UIDLs, so ordinary mail in the same mailbox is left alone. Pass `{ delete: "1" }` in
 * `options` to remove processed messages instead.
 */
import type { PollAdapter, PollResult } from "./poll.js"
import { parse_cursor } from "./poll.js"
import type { WebhookEvent, WebhookEventType } from "./index.js"
import { pop3_session } from "./pop3.js"
import { parse_dsn } from "./dsn.js"

interface Cursor {
	/** UIDLs already examined (DSN or not) that may still be on the server. */
	seen: Array<string>
}

const DEFAULT_LIMIT = 20
/** Cap on remembered UIDLs — old ones age out as the mailbox turns over. */
const SEEN_CAP = 500
const TIMEOUT = 30_000

/** POP3 implicit TLS runs on 995; "auto" mirrors SMTP_SECURE's port-keyed default. */
function is_secure(secure: string, port: number): boolean {
	if (secure === "auto" || secure === "") return port === 995
	return secure !== "false" && secure !== "0"
}

const adapter: PollAdapter = {
	provider: "smtp",

	async poll(ctx): Promise<PollResult> {
		const cursor = parse_cursor<Cursor>("smtp", ctx.cursor)
		const seen = new Set(cursor?.seen ?? [])
		const limit = ctx.limit ?? DEFAULT_LIMIT
		const port = Number(ctx.options.port) || 995

		const connection = await pop3_session({
			host: ctx.options.host,
			port,
			secure: is_secure(ctx.options.secure ?? "auto", port),
			user: ctx.options.user,
			pass: ctx.options.pass,
			timeout: TIMEOUT,
		})

		try {
			// UIDL lists "n uid" per message; uids are stable across sessions, numbers aren't.
			const listing = (await connection.cmd_multi("UIDL"))
				.split("\r\n")
				.filter(Boolean)
				.map((line) => {
					const space = line.indexOf(" ")
					return { number: line.slice(0, space), uid: line.slice(space + 1).trim() }
				})

			const fresh = listing.filter((entry) => entry.uid && !seen.has(entry.uid))
			const batch = fresh.slice(0, limit)
			const events: Array<WebhookEvent> = []
			const processed: Array<string> = []

			for (const entry of batch) {
				const raw = await connection.cmd_multi(`RETR ${entry.number}`)
				// Ordinary mail in the mailbox parses to [] and just gets marked seen.
				events.push(...parse_dsn(raw))
				processed.push(entry.uid)
				if (ctx.options.delete === "1" || ctx.options.delete === "true") {
					await connection.cmd(`DELE ${entry.number}`)
				}
			}
			await connection.cmd("QUIT")

			// Remember what's still on the server (kept mail ages out with the mailbox) plus
			// what we just handled, newest last, capped so the cursor can't grow forever.
			const on_server = new Set(listing.map((entry) => entry.uid))
			const kept = (cursor?.seen ?? []).filter((uid) => on_server.has(uid))
			const next: Cursor = { seen: [...kept, ...processed].slice(-SEEN_CAP) }

			return {
				events,
				cursor: JSON.stringify(next),
				more: fresh.length > batch.length,
			}
		} finally {
			connection.destroy()
		}
	},
}

export default adapter

/** A realistic DSN run through the real parser — the fixture can't drift from the code. */
export async function mock(options: { type: WebhookEventType }): Promise<PollResult> {
	const action =
		options.type === "delivered" ? "delivered" : options.type === "delayed" ? "delayed" : "failed"
	const status =
		options.type === "delivered" ? "2.0.0" : options.type === "delayed" ? "4.4.1" : "5.1.1"
	const raw = [
		"From: MAILER-DAEMON@mail.example.com",
		"To: bounces@example.com",
		"Date: Thu, 21 Aug 2026 09:15:00 +0000",
		'Content-Type: multipart/report; report-type=delivery-status; boundary="=_dsn"',
		"",
		"--=_dsn",
		"Content-Type: text/plain",
		"",
		"Delivery to the following recipient failed.",
		"--=_dsn",
		"Content-Type: message/delivery-status",
		"",
		"Reporting-MTA: dns; mail.example.com",
		"Arrival-Date: Thu, 21 Aug 2026 09:14:58 +0000",
		"",
		"Final-Recipient: rfc822; recipient@example.com",
		`Action: ${action}`,
		`Status: ${status}`,
		"Diagnostic-Code: smtp; 550 5.1.1 mailbox unavailable",
		"",
		"--=_dsn",
		"Content-Type: text/rfc822-headers",
		"",
		"Message-ID: <mock-message-id@example.com>",
		"Subject: Mock subject",
		"",
		"--=_dsn--",
	].join("\r\n")

	return {
		events: parse_dsn(raw),
		cursor: JSON.stringify({ seen: ["mock-uid-1"] }),
	}
}
