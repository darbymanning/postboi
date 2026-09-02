import { stdin, stdout, stderr } from "node:process"
import { ensure_env_loaded, read_env } from "../library/env.js"
import { cloud_base } from "./postboi.js"

/**
 * `postboi mcp` — the MCP server over stdio, for the clients that only speak stdio.
 *
 * It is a **proxy**, not a second server. Every message is forwarded to
 * `<base>/mcp` with the project's `POSTBOI_TOKEN`, and the reply is written back. That
 * matters more than it sounds: the tool list is generated from the API's own OpenAPI
 * description on the server, so a local implementation would be a second copy of it —
 * and a second copy is a copy that is out of date the next time an endpoint ships,
 * silently, in whichever direction the user happened to install from.
 *
 * The transport is newline-delimited JSON on stdin and stdout, which is the whole of
 * the stdio transport. Nothing but JSON-RPC ever goes to stdout — diagnostics go to
 * stderr, because a stray line on stdout is a parse error in somebody's client and
 * reads as "the server is broken".
 */

/** Longest single message accepted, so a malformed stream can't grow the buffer forever. */
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024

function note(message: string): void {
	stderr.write(`${message}\n`)
}

export async function mcp_command(args: Array<string> = []): Promise<void> {
	await ensure_env_loaded()
	const token = read_env("POSTBOI_TOKEN")
	if (!token) {
		note("No POSTBOI_TOKEN found — run `postboi init` to sign in first.")
		process.exitCode = 1
		return
	}
	const base = args.find((arg) => arg.startsWith("--url="))?.slice("--url=".length) ?? cloud_base()
	const endpoint = `${base.replace(/\/$/, "")}/mcp`
	note(`postboi mcp → ${endpoint}`)

	/** One message out, one line back — or nothing, for a notification. */
	async function forward(line: string): Promise<void> {
		let response: Response
		try {
			response = await fetch(endpoint, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "application/json",
					authorization: `Bearer ${token}`,
				},
				body: line,
			})
		} catch (error) {
			// A transport failure has to come back as a JSON-RPC error, or the client
			// waits forever for a reply to a request it believes is in flight.
			stdout.write(`${JSON.stringify(rpc_error(line, -32000, message_of(error)))}\n`)
			return
		}
		// 202 is a notification the server accepted and had nothing to say about.
		if (response.status === 202) return
		const text = await response.text()
		if (!response.ok) {
			stdout.write(
				`${JSON.stringify(rpc_error(line, response.status === 401 ? -32001 : -32000, text || response.statusText))}\n`
			)
			return
		}
		// The body is already a JSON-RPC response; pass it through on one line, since a
		// pretty-printed one would be several messages as far as the client is concerned.
		stdout.write(`${JSON.stringify(JSON.parse(text))}\n`)
	}

	let buffer = ""
	stdin.setEncoding("utf8")
	for await (const chunk of stdin) {
		buffer += chunk
		if (buffer.length > MAX_MESSAGE_BYTES) {
			note("Message exceeded the size limit; dropping the buffer.")
			buffer = ""
			continue
		}
		let newline = buffer.indexOf("\n")
		while (newline >= 0) {
			const line = buffer.slice(0, newline).trim()
			buffer = buffer.slice(newline + 1)
			if (line) await forward(line)
			newline = buffer.indexOf("\n")
		}
	}
}

function message_of(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

/**
 * An error carrying the id of the request that caused it. Reading the id back out of
 * the line we just sent is the only way to have one — the failure happened before any
 * reply existed.
 */
export function rpc_error(line: string, code: number, message: string): Record<string, unknown> {
	let id: unknown
	try {
		id = (JSON.parse(line) as { id?: unknown })?.id ?? null
	} catch {
		// Unparseable input is the client's problem, and -32700 is what says so.
		return { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } }
	}
	return { jsonrpc: "2.0", id, error: { code, message } }
}
