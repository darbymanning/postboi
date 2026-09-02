import { describe, expect, test, vi } from "vitest"
import { IMPORT_SOURCES, batches } from "./import_sources.js"
import { import_command, parse_import_flags } from "./import.js"

/**
 * The mappings, against the shape each ESP actually returns, and the order the command
 * writes in. The order is the part worth a test: suppressions before contacts, per page
 * and not just per run.
 */

describe("what each source's records mean", () => {
	test("Mailchimp: merge fields become name and data, cleaned means bounced", () => {
		const page = IMPORT_SOURCES.mailchimp.read(
			{
				members: [
					{
						email_address: "ada@example.com",
						status: "subscribed",
						merge_fields: { FNAME: "Ada", LNAME: "Lovelace", COMPANY: "Analytical" },
						tags: [{ name: "vip" }, { name: "beta" }],
					},
					{ email_address: "gone@example.com", status: "unsubscribed" },
					{ email_address: "dead@example.com", status: "cleaned" },
					{ email_address: "maybe@example.com", status: "pending" },
				],
			},
			undefined
		)
		expect(page.contacts).toEqual([
			{
				email: "ada@example.com",
				name: "Ada Lovelace",
				data: { company: "Analytical" },
				tags: ["vip", "beta"],
				status: "subscribed",
			},
			{ email: "maybe@example.com", name: undefined, data: {}, tags: [], status: "pending" },
		])
		expect(page.suppressions).toEqual([
			{ email: "gone@example.com", reason: "unsubscribe" },
			{ email: "dead@example.com", reason: "bounce" },
		])
		// A short page is the last page.
		expect(page.cursor).toBeUndefined()
	})

	// The next offset counts every row the page held, suppressed ones included — counting
	// only the contacts would re-read the rows it skipped, forever.
	test("Mailchimp: a full page's next offset counts what it skipped", () => {
		const members = Array.from({ length: 1000 }, (_, i) => ({
			email_address: `person${i}@example.com`,
			status: i % 2 === 0 ? "subscribed" : "unsubscribed",
		}))
		expect(IMPORT_SOURCES.mailchimp.read({ members }, "2000").cursor).toBe("3000")
	})

	test("Kit: its four dead states map onto our three reasons", () => {
		const page = IMPORT_SOURCES.kit.read(
			{
				subscribers: [
					{
						email_address: "ada@example.com",
						first_name: "Ada",
						state: "active",
						fields: { plan: "pro" },
					},
					{ email_address: "a@example.com", state: "cancelled" },
					{ email_address: "b@example.com", state: "bounced" },
					{ email_address: "c@example.com", state: "complained" },
				],
				pagination: { has_next_page: true, end_cursor: "abc" },
			},
			undefined
		)
		expect(page.contacts).toEqual([
			{
				email: "ada@example.com",
				name: "Ada",
				data: { plan: "pro" },
				status: "subscribed",
			},
		])
		expect(page.suppressions.map((row) => row.reason)).toEqual([
			"unsubscribe",
			"bounce",
			"complaint",
		])
		expect(page.cursor).toBe("abc")
	})

	test("Loops: the user group is the nearest thing it has to a tag", () => {
		const page = IMPORT_SOURCES.loops.read(
			{
				contacts: [
					{
						email: "ada@example.com",
						firstName: "Ada",
						lastName: "Lovelace",
						subscribed: true,
						userGroup: "Founders",
						plan: "pro",
					},
					{ email: "gone@example.com", subscribed: false },
				],
			},
			undefined
		)
		expect(page.contacts[0]).toEqual({
			email: "ada@example.com",
			name: "Ada Lovelace",
			data: { plan: "pro" },
			tags: ["Founders"],
			status: "subscribed",
		})
		expect(page.suppressions).toEqual([{ email: "gone@example.com", reason: "unsubscribe" }])
	})

	test("Brevo: one blacklist flag, recorded as the safer of the two things it means", () => {
		const page = IMPORT_SOURCES.brevo.read(
			{
				contacts: [
					{
						email: "ada@example.com",
						attributes: { FIRSTNAME: "Ada", LASTNAME: "Lovelace", PLAN: "pro" },
					},
					{ email: "gone@example.com", emailBlacklisted: true },
				],
			},
			undefined
		)
		expect(page.contacts[0].name).toBe("Ada Lovelace")
		expect(page.contacts[0].data).toEqual({ plan: "pro" })
		expect(page.suppressions).toEqual([{ email: "gone@example.com", reason: "unsubscribe" }])
	})
})

describe("flags", () => {
	test("both spellings, and the ones that take no value", () => {
		expect(parse_import_flags(["--from", "Kit", "--key=abc", "--dry-run"])).toEqual({
			from: "kit",
			key: "abc",
			dry_run: true,
		})
	})
})

describe("batching", () => {
	test("splits without losing or duplicating a row", () => {
		expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
		expect(batches([], 2)).toEqual([])
	})
})

describe("the order it writes in", () => {
	/** Every call the command made, in order, as `METHOD path`. */
	function recorder(pages: Array<unknown>) {
		const calls: Array<string> = []
		let page = 0
		const fetch_fn = vi.fn(async (url: string, init?: RequestInit) => {
			if (url.includes("api.kit.com")) {
				const body = pages[page++] ?? { subscribers: [] }
				return new Response(JSON.stringify(body), { status: 200 })
			}
			calls.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`)
			return new Response("{}", { status: 200 })
		})
		return { calls, fetch_fn: fetch_fn as unknown as typeof fetch }
	}

	// The one mistake in an ESP migration nobody can take back: a window in which a send
	// could reach somebody the old ESP had already been told not to mail. So the
	// suppressions of a page land before that page's own subscribers, not just before
	// the import's last page.
	test("a page's suppressions land before that page's contacts", async () => {
		process.env.POSTBOI_TOKEN = "pbk_test"
		const { calls, fetch_fn } = recorder([
			{
				subscribers: [
					{ email_address: "ada@example.com", state: "active" },
					{ email_address: "gone@example.com", state: "cancelled" },
				],
				pagination: { has_next_page: false },
			},
		])
		await import_command(["--from", "kit", "--key", "abc", "--list", "Moved"], fetch_fn)
		expect(calls).toEqual(["POST /v1/suppressions", "POST /v1/lists/Moved/recipients"])
	})

	test("a dry run reads the source and writes nothing", async () => {
		process.env.POSTBOI_TOKEN = "pbk_test"
		const { calls, fetch_fn } = recorder([
			{
				subscribers: [{ email_address: "ada@example.com", state: "active" }],
				pagination: { has_next_page: false },
			},
		])
		await import_command(["--from", "kit", "--key", "abc", "--dry-run"], fetch_fn)
		expect(calls).toEqual([])
	})

	test("an unknown source is refused before anything is read", async () => {
		const { fetch_fn } = recorder([])
		await expect(import_command(["--from", "sendgrid"], fetch_fn)).rejects.toThrow("Usage")
	})

	// A 401 from the source is their key, not ours; conflating the two sends people to
	// the wrong dashboard.
	test("the source's own refusal is reported as the source's", async () => {
		process.env.POSTBOI_TOKEN = "pbk_test"
		const fetch_fn = (async (url: string) =>
			url.includes("api.kit.com")
				? new Response("{}", { status: 401 })
				: new Response("{}", { status: 200 })) as unknown as typeof fetch
		await expect(import_command(["--from", "kit", "--key", "wrong"], fetch_fn)).rejects.toThrow(
			/Kit refused that key/
		)
	})
})
