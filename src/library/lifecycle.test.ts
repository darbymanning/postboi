import { describe, it, expect, vi } from "vitest"
import { postboi as better_auth } from "./better_auth.js"
import { convex, identify, track } from "./convex.js"
import { lifecycle, type LifecycleClient } from "./lifecycle.js"
import { auth as lunora_auth, context, postboi as lunora } from "./lunora.js"

/**
 * The three first-party lifecycle plugins. What is worth testing about all of them is
 * the same one thing: that a failure at Postboi never becomes a failure in somebody's
 * sign-up path.
 */

function recorder(options: { fail?: boolean } = {}) {
	const tracked: Array<{ to: unknown; event: string; properties?: Record<string, unknown> }> = []
	const contacts: Array<{ email: string; changes: unknown }> = []
	const client: LifecycleClient = {
		events: {
			async track(to, event, properties) {
				if (options.fail) throw new Error("network down")
				tracked.push({ to, event, properties })
				return { id: "ev_1" } as never
			},
		},
		contacts: {
			async add(email, contact) {
				if (options.fail) throw new Error("network down")
				contacts.push({ email, changes: contact })
				return {}
			},
			async update(email, changes) {
				if (options.fail) throw new Error("network down")
				contacts.push({ email, changes })
				return {}
			},
		},
	}
	return { client, tracked, contacts }
}

describe("the shared reporter", () => {
	it("upserts the contact and records the event, in that order", async () => {
		const { client, tracked, contacts } = recorder()
		const reporter = lifecycle({ client })
		expect(
			await reporter.report("signed_up", { id: 42, email: "Ada@Example.com", name: "Ada" })
		).toBe(true)
		expect(contacts).toEqual([
			{ email: "ada@example.com", changes: { name: "Ada", external_id: "42" } },
		])
		expect(tracked).toEqual([
			{
				to: "ada@example.com",
				event: "auth.signed_up",
				properties: { user_id: "42" },
			},
		])
	})

	it("skips a user with no address rather than inventing one", async () => {
		const { client, tracked } = recorder()
		expect(await lifecycle({ client }).report("signed_up", { id: 1 })).toBe(false)
		expect(tracked).toEqual([])
	})

	it("renames and switches off events", async () => {
		const { client, tracked } = recorder()
		const reporter = lifecycle({ client, events: { signed_in: false, signed_up: "user.joined" } })
		expect(await reporter.report("signed_in", { email: "a@b.c" })).toBe(false)
		await reporter.report("signed_up", { email: "a@b.c" })
		expect(tracked.map((entry) => entry.event)).toEqual(["user.joined"])
	})

	it("never throws — a signup must not fail because tracking did", async () => {
		const { client } = recorder({ fail: true })
		const on_error = vi.fn()
		const reporter = lifecycle({ client, on_error })
		await expect(reporter.report("signed_up", { email: "a@b.c" })).resolves.toBe(false)
		expect(on_error).toHaveBeenCalledOnce()
		expect(on_error.mock.calls[0][1]).toEqual({ event: "auth.signed_up", email: "a@b.c" })
	})

	it("takes extra properties and attributes from the source record", async () => {
		const { client, tracked, contacts } = recorder()
		const reporter = lifecycle({
			client,
			properties: (_user, raw) => ({ provider: (raw as { provider: string }).provider }),
			attributes: () => ({ plan: "free" }),
		})
		await reporter.report("signed_up", { email: "a@b.c" }, { provider: "github" })
		expect(tracked[0].properties).toEqual({ provider: "github" })
		expect(contacts[0].changes).toMatchObject({ data: { plan: "free" } })
	})
})

describe("the Better Auth plugin", () => {
	it("reports a signup, and a verified address as its own event", async () => {
		const { client, tracked } = recorder()
		const plugin = better_auth({ client })
		await plugin.databaseHooks.user.create.after({
			id: "u1",
			email: "ada@example.com",
			name: "Ada",
			emailVerified: true,
		})
		expect(tracked.map((entry) => entry.event)).toEqual(["auth.signed_up", "auth.email_verified"])
	})

	it("an unverified signup is one event", async () => {
		const { client, tracked } = recorder()
		await better_auth({ client }).databaseHooks.user.create.after({
			id: "u1",
			email: "ada@example.com",
		})
		expect(tracked.map((entry) => entry.event)).toEqual(["auth.signed_up"])
	})

	it("says once that sign-ins need a way to resolve the session's user", async () => {
		const { client, tracked } = recorder()
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const plugin = better_auth({ client })
		await plugin.databaseHooks.session.create.after({ id: "s1", userId: "u1" })
		await plugin.databaseHooks.session.create.after({ id: "s2", userId: "u1" })
		expect(tracked).toEqual([])
		// Once, not once per sign-in: a warning on every login is a log nobody reads.
		expect(warn).toHaveBeenCalledOnce()
		warn.mockRestore()
	})

	it("records a sign-in when it can resolve the user", async () => {
		const { client, tracked } = recorder()
		const plugin = better_auth({
			client,
			user_for_session: async () => ({ id: "u1", email: "ada@example.com" }),
		})
		await plugin.databaseHooks.session.create.after({ id: "s1", userId: "u1" })
		expect(tracked.map((entry) => entry.event)).toEqual(["auth.signed_in"])
	})

	it("switched-off sign-ins never ask for a resolver", async () => {
		const { client } = recorder()
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const plugin = better_auth({ client, events: { signed_in: false } })
		await plugin.databaseHooks.session.create.after({ id: "s1", userId: "u1" })
		expect(warn).not.toHaveBeenCalled()
		warn.mockRestore()
	})
})

describe("the Convex helpers", () => {
	it("track and identify go through the client, creating the contact", async () => {
		const { client, tracked, contacts } = recorder()
		await identify({ id: "u1", email: "ada@example.com", name: "Ada" }, { client })
		await track("ada@example.com", "project_created", { plan: "pro" }, { client })
		expect(contacts[0]).toEqual({
			email: "ada@example.com",
			changes: { name: "Ada", external_id: "u1" },
		})
		expect(tracked[0]).toMatchObject({ event: "project_created", properties: { plan: "pro" } })
	})

	it("a failure is reported, not thrown — the mutation already committed", async () => {
		const { client } = recorder({ fail: true })
		const on_error = vi.fn()
		await expect(track("a@b.c", "x", undefined, { client, on_error })).resolves.toBeUndefined()
		await expect(identify({ email: "a@b.c" }, { client, on_error })).resolves.toBeUndefined()
		expect(on_error).toHaveBeenCalledTimes(2)
	})

	it("the bound pair carries its options to every call", async () => {
		const { client, tracked } = recorder()
		const postboi = convex({ client })
		await postboi.track("a@b.c", "x")
		expect(tracked).toHaveLength(1)
	})
})

describe("the Lunora package", () => {
	it("hangs its context off the key it was given", () => {
		const pkg = lunora({ as: "mail_events" })
		const ctx = pkg.extend({ db: {} } as Record<string, unknown>)
		expect(pkg.name).toBe("postboi")
		expect(typeof (ctx.mail_events as { track: unknown }).track).toBe("function")
		expect(ctx.db).toBeDefined()
	})

	it("track and identify behave as they do everywhere else", async () => {
		const { client, tracked, contacts } = recorder()
		const ctx = context({ client })
		await ctx.identify({ id: 7, email: "Ada@Example.com" })
		await ctx.track("ada@example.com", "job_ran")
		expect(contacts[0].email).toBe("ada@example.com")
		expect(tracked[0].event).toBe("job_ran")
	})

	it("a failing track never throws — a retried job would send twice", async () => {
		const { client } = recorder({ fail: true })
		const on_error = vi.fn()
		await expect(context({ client, on_error }).track("a@b.c", "x")).resolves.toBeUndefined()
		expect(on_error).toHaveBeenCalledOnce()
	})

	it("its auth() is the very same Better Auth plugin, not a second one", async () => {
		const { client, tracked } = recorder()
		await lunora_auth({ client }).databaseHooks.user.create.after({
			id: "u1",
			email: "ada@example.com",
			emailVerified: true,
		})
		// The names must match what postboi/better-auth writes, or an app that moved
		// between the two imports would silently stop triggering its own sequences.
		expect(tracked.map((entry) => entry.event)).toEqual(["auth.signed_up", "auth.email_verified"])
	})
})
