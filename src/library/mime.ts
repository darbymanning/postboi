/**
 * RFC 5322 message composition — the MIME builder shared by the providers that hand a
 * whole message over as one blob: SMTP (the `DATA` payload) and Gmail (`raw`).
 *
 * Internal: not part of the public surface.
 */
import type { MailAddress, MailAttachment } from "./index.js"

/** Hex string of `bytes` random bytes, via the WebCrypto global (works everywhere node:crypto doesn't). */
export const random_hex = (bytes: number): string =>
	Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
		b.toString(16).padStart(2, "0")
	).join("")

/** Strip CR/LF from a header value — the trust boundary that blocks header injection. */
export const clean = (value: string): string => value.replace(/[\r\n]/g, " ")

/** RFC 2047 encode a header word only when it contains non-ASCII. */
function enc_word(value: string): string {
	const v = clean(value)
	// eslint-disable-next-line no-control-regex
	if (/^[\x00-\x7F]*$/.test(v)) return v
	return `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`
}

/** Format an address as `Encoded Name <addr>` (or bare `addr`), CR/LF stripped. */
export function format_address(a: MailAddress): string {
	return a.name ? `${enc_word(a.name)} <${clean(a.address)}>` : clean(a.address)
}

/** Wrap a base64 string to 76-character lines, as MIME requires. */
const wrap = (b64: string): string => b64.replace(/.{1,76}/g, "$&\r\n").trimEnd()

/** A single MIME entity: its headers (already formatted) and an encoded body. */
type Part = { headers: Array<string>; body: string }

/** A leaf part with base64 transfer encoding from a UTF-8 string. */
function leaf(content_type: string, text: string): Part {
	return {
		headers: [`Content-Type: ${content_type}`, "Content-Transfer-Encoding: base64"],
		body: wrap(Buffer.from(text, "utf8").toString("base64")),
	}
}

/** A leaf part for an attachment (its content is already base64). */
function attachment_part(a: MailAttachment): Part {
	const name = clean(a.name)
	return {
		headers: [
			`Content-Type: ${a.mime_type || "application/octet-stream"}; name="${name}"`,
			"Content-Transfer-Encoding: base64",
			`Content-Disposition: attachment; filename="${name}"`,
		],
		body: wrap(a.content),
	}
}

/** Combine parts under a multipart/* container with a fresh boundary. */
function multipart(subtype: string, parts: Array<Part>): Part {
	const boundary = `=_postboi_${random_hex(12)}`
	const lines: Array<string> = []
	for (const p of parts) {
		lines.push(`--${boundary}`, ...p.headers, "", p.body)
	}
	lines.push(`--${boundary}--`)
	return {
		headers: [`Content-Type: multipart/${subtype}; boundary="${boundary}"`],
		body: lines.join("\r\n"),
	}
}

/** The already-parsed parts of a message, ready to be written out as one RFC 5322 blob. */
export type MimeMessage = {
	from: MailAddress
	to: Array<MailAddress>
	cc?: Array<MailAddress>
	/**
	 * Written as a `Bcc:` header. SMTP leaves it out (the envelope carries those
	 * recipients); an API that takes the whole message as one blob (Gmail) reads it from
	 * here and strips it before delivery.
	 */
	bcc?: Array<MailAddress>
	reply_to?: Array<MailAddress>
	subject: string
	html?: string
	text?: string
	attachments?: Array<MailAttachment>
	headers?: Record<string, string>
}

/** Build the RFC 5322 message (headers + MIME body), CRLF-terminated lines. */
export function compose_mime(message: MimeMessage): string {
	const text_part = message.text ? leaf("text/plain; charset=utf-8", message.text) : undefined
	const html_part = message.html ? leaf("text/html; charset=utf-8", message.html) : undefined
	let content: Part =
		text_part && html_part
			? multipart("alternative", [text_part, html_part])
			: (html_part ?? text_part ?? leaf("text/plain; charset=utf-8", ""))

	if (message.attachments?.length) {
		content = multipart("mixed", [content, ...message.attachments.map(attachment_part)])
	}

	const headers: Array<string> = [
		`From: ${format_address(message.from)}`,
		`To: ${message.to.map(format_address).join(", ")}`,
	]
	if (message.cc?.length) headers.push(`Cc: ${message.cc.map(format_address).join(", ")}`)
	if (message.bcc?.length) headers.push(`Bcc: ${message.bcc.map(format_address).join(", ")}`)
	if (message.reply_to?.length) {
		headers.push(`Reply-To: ${message.reply_to.map(format_address).join(", ")}`)
	}
	headers.push(
		`Subject: ${enc_word(message.subject)}`,
		`Date: ${new Date().toUTCString()}`,
		`Message-ID: <${random_hex(16)}@${message.from.address.split("@")[1] ?? "postboi"}>`,
		"MIME-Version: 1.0"
	)
	for (const [name, value] of Object.entries(message.headers ?? {})) {
		headers.push(`${clean(name)}: ${clean(value)}`)
	}

	return [...headers, ...content.headers, "", content.body].join("\r\n")
}
