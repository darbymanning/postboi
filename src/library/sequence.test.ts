import { describe, expect, it } from "vitest"
import {
	branch,
	condition,
	delay,
	email,
	exit,
	list,
	sequence,
	tag,
	wait_for_event,
	walk_steps,
	webhook,
} from "./sequence.js"

describe("sequence()", () => {
	it("returns the name and the definition the API stores", () => {
		const file = sequence({
			name: "Welcome",
			trigger: { kind: "contact_added" },
			entry: "one_time",
			steps: [email({ subject: "Hi {name}", html: "<p>Hi</p>" }), delay({ days: 2 })],
		})
		expect(file.name).toBe("Welcome")
		expect(file.definition).toEqual({
			trigger: { kind: "contact_added" },
			entry: "one_time",
			steps: [
				{ kind: "email", subject: "Hi {name}", html: "<p>Hi</p>" },
				{ kind: "delay", for: { days: 2 } },
			],
		})
		expect(sequence({ trigger: { kind: "manual" }, steps: [] }).name).toBe("")
	})

	it("step helpers build the wire shapes", () => {
		expect(delay({ until: { time: "09:00", weekday: 1 } })).toEqual({
			kind: "delay",
			until: { time: "09:00", weekday: 1 },
		})
		expect(wait_for_event("billing.purchase", { days: 3 })).toEqual({
			kind: "wait_for_event",
			name: "billing.purchase",
			timeout: { days: 3 },
			on_timeout: [],
		})
		const yes = { match: "all" as const, rules: [] }
		expect(condition(yes, { then: [tag({ add: ["vip"] })] })).toEqual({
			kind: "condition",
			if: yes,
			then: [{ kind: "tag", add: ["vip"] }],
			else: [],
		})
		expect(list("list_1", "unsubscribe")).toEqual({
			kind: "list",
			list_id: "list_1",
			action: "unsubscribe",
		})
		expect(webhook("https://example.com/hook", "score")).toEqual({
			kind: "webhook",
			url: "https://example.com/hook",
			key: "score",
		})
		expect(exit()).toEqual({ kind: "exit" })
	})

	it("walk_steps lists nested lanes depth-first", () => {
		const steps = [
			condition({ match: "all", rules: [] }, { then: [tag({ add: ["a"] })], else: [exit()] }),
			branch([
				{ name: "A", weight: 50, steps: [tag({ add: ["b"] })] },
				{ name: "B", weight: 50, steps: [] },
			]),
			wait_for_event("x", { hours: 1 }, [tag({ add: ["c"] })]),
		]
		expect(walk_steps(steps).map((step) => step.kind)).toEqual([
			"condition",
			"tag",
			"exit",
			"branch",
			"tag",
			"wait_for_event",
			"tag",
		])
	})
})
