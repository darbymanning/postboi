import { describe, it, expect } from "vitest"
import { rpc_error } from "./mcp.js"

/**
 * `postboi mcp` is a proxy, so the only logic worth pinning is what it does when the
 * proxying fails — because a client waiting forever for a reply it believes is in
 * flight is the failure mode that looks like a hung server rather than a broken one.
 */
describe("errors the proxy has to invent", () => {
	it("carries the id of the request that caused it", () => {
		expect(rpc_error('{"jsonrpc":"2.0","id":7,"method":"tools/list"}', -32000, "offline")).toEqual({
			jsonrpc: "2.0",
			id: 7,
			error: { code: -32000, message: "offline" },
		})
	})

	it("a notification has no id, and neither does its error", () => {
		expect(
			rpc_error('{"jsonrpc":"2.0","method":"notifications/initialized"}', -32000, "x")
		).toEqual({
			jsonrpc: "2.0",
			id: null,
			error: { code: -32000, message: "x" },
		})
	})

	it("unparseable input is the client's own problem, and says which", () => {
		expect(rpc_error("not json at all", -32000, "offline")).toEqual({
			jsonrpc: "2.0",
			id: null,
			error: { code: -32700, message: "Parse error." },
		})
	})
})
