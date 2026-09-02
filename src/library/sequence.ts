/**
 * Sequences as code. A `sequences/welcome.ts` file exports what `sequence()` returns;
 * `bunx postboi sync` pushes every such file to the account, and `bunx postboi
 * sequences pull` writes dashboard edits back as files. The shapes here are the wire
 * shapes the Postboi provider's `sequences` namespace speaks — the same JSON the
 * dashboard builder produces — with a few helpers so a file reads as a list of steps
 * rather than a tree of objects.
 *
 * Nothing runs here: a sequence definition is data, and the hosted engine walks it.
 *
 * @example
 * ```ts
 * // sequences/welcome.ts
 * import { sequence, email, delay, condition, tag } from "postboi"
 *
 * export default sequence({
 * 	name: "Welcome",
 * 	trigger: { kind: "contact_added" },
 * 	entry: "one_time",
 * 	steps: [
 * 		email({ subject: "Welcome aboard, {name}", html: "<p>Hi {name}…</p>" }),
 * 		delay({ days: 2 }),
 * 		condition({ match: "all", rules: [{ kind: "engagement", metric: "opened", within_days: 3, happened: true }] }, {
 * 			then: [email({ subject: "Three things people miss", html: "…" })],
 * 			else: [email({ subject: "Still there?", html: "…" })],
 * 		}),
 * 		tag({ add: ["welcomed"] }),
 * 	],
 * })
 * ```
 */

import type { Register } from "./index.js"
import type { SegmentDefinition, SegmentOp } from "./postboi_provider.js"

/** Whole minutes, hours and days, added together. */
export interface SequenceDuration {
	minutes?: number
	hours?: number
	days?: number
}

export type SequenceTrigger =
	| { kind: "contact_added"; list_ids?: Array<string> }
	| { kind: "tag_added"; tags: Array<string> }
	| { kind: "segment_entered"; segment_id: string }
	| {
			kind: "event"
			names: Array<string>
			property?: { key: string; op: SegmentOp; value?: string }
	  }
	| { kind: "inbound_webhook"; hook: string }
	| { kind: "inactivity"; days: number }
	| { kind: "frequency"; name: string; count: number; days: number }
	| { kind: "manual" }

/** The sending addresses `bunx postboi sync` typed, when it has — otherwise any string. */
type From = Register extends { from: infer F } ? F : string
/** The WhatsApp templates `bunx postboi sync` typed, when it has. */
type Template = Register extends { template: infer T } ? T : string

interface SequenceStepBase {
	/** Stable id (`s_` + 8 chars). Minted by the server when omitted; keep it once it exists. */
	id?: string
	/** Send to unsubscribed contacts too. Never to suppressed ones. */
	transactional?: boolean
}

export type SequenceStep = SequenceStepBase &
	(
		| {
				kind: "email"
				subject: string
				html?: string
				text?: string
				from?: From
				reply_to?: string
				template?: string
		  }
		| { kind: "sms"; text: string; provider?: string }
		| {
				kind: "whatsapp"
				template: Template
				variables?: Record<string, string>
				provider?: string
		  }
		| { kind: "push"; title: string; body: string; url?: string; provider?: string }
		| { kind: "slack"; text: string; provider?: string }
		| {
				kind: "delay"
				for?: SequenceDuration
				until?:
					| { weekday?: number; time: string }
					| { attribute: string; offset?: SequenceDuration; before?: boolean }
		  }
		| {
				kind: "wait_for_event"
				name: string
				timeout: SequenceDuration
				on_timeout?: Array<SequenceStep>
		  }
		| {
				kind: "condition"
				if: SegmentDefinition
				then?: Array<SequenceStep>
				else?: Array<SequenceStep>
		  }
		| { kind: "branch"; branches: Array<SequenceBranch> }
		| { kind: "tag"; add?: Array<string>; remove?: Array<string> }
		| { kind: "list"; list_id: string; action: "subscribe" | "unsubscribe" }
		| { kind: "webhook"; url: string; key?: string }
		| { kind: "exit" }
	)

export interface SequenceBranch {
	name: string
	if?: SegmentDefinition
	weight?: number
	steps: Array<SequenceStep>
}

/** The definition the API stores — what the dashboard builder produces. */
export interface SequenceDefinition {
	trigger: SequenceTrigger
	steps: Array<SequenceStep>
	/** `unlimited` (default), `one_time`, or `matching_field` with a `data` key. */
	entry?: "unlimited" | "one_time" | "matching_field"
	matching_field?: string
	/** Allowlist: only these addresses may enter, whatever the trigger says. */
	only?: Array<string>
	/** HH:MM in the contact's timezone; marketing sends wait for the window to end. */
	quiet_hours?: { from: string; to: string }
}

/** What a `sequences/*.ts` file exports: the definition and the name it is saved under. */
export interface SequenceFile {
	name: string
	definition: SequenceDefinition
}

/**
 * Declare a sequence. Returns `{ name, definition }` — the name defaults to the file's
 * stem when `postboi sync` reads it, so it is optional here.
 */
export function sequence(input: SequenceDefinition & { name?: string }): SequenceFile {
	const { name, ...definition } = input
	return { name: name ?? "", definition }
}

type Of<K extends SequenceStep["kind"]> = Extract<SequenceStep, { kind: K }>
type Fields<K extends SequenceStep["kind"]> = Omit<Of<K>, "kind">

export function email(fields: Fields<"email">): Of<"email"> {
	return { kind: "email", ...fields }
}
export function sms(fields: Fields<"sms">): Of<"sms"> {
	return { kind: "sms", ...fields }
}
export function whatsapp(fields: Fields<"whatsapp">): Of<"whatsapp"> {
	return { kind: "whatsapp", ...fields }
}
export function push(fields: Fields<"push">): Of<"push"> {
	return { kind: "push", ...fields }
}
export function slack(fields: Fields<"slack">): Of<"slack"> {
	return { kind: "slack", ...fields }
}
/** `delay({ days: 2 })`, or `delay({ until: { time: "09:00", weekday: 1 } })`. */
export function delay(wait: SequenceDuration | Fields<"delay">): Of<"delay"> {
	if ("for" in wait || "until" in wait || "id" in wait) return { kind: "delay", ...wait }
	return { kind: "delay", for: wait as SequenceDuration }
}
export function wait_for_event(
	name: string,
	timeout: SequenceDuration,
	on_timeout: Array<SequenceStep> = []
): Of<"wait_for_event"> {
	return { kind: "wait_for_event", name, timeout, on_timeout }
}
export function condition(
	test: SegmentDefinition,
	lanes: { then?: Array<SequenceStep>; else?: Array<SequenceStep> }
): Of<"condition"> {
	return { kind: "condition", if: test, then: lanes.then ?? [], else: lanes.else ?? [] }
}
export function branch(branches: Array<SequenceBranch>): Of<"branch"> {
	return { kind: "branch", branches }
}
export function tag(changes: Fields<"tag">): Of<"tag"> {
	return { kind: "tag", ...changes }
}
export function list(
	list_id: string,
	action: "subscribe" | "unsubscribe" = "subscribe"
): Of<"list"> {
	return { kind: "list", list_id, action }
}
export function webhook(url: string, key?: string): Of<"webhook"> {
	return { kind: "webhook", url, ...(key ? { key } : {}) }
}
export function exit(): Of<"exit"> {
	return { kind: "exit" }
}

/** Every step, depth-first — a file's own sanity checks, and the CLI's summary. */
export function walk_steps(steps: Array<SequenceStep>): Array<SequenceStep> {
	const out: Array<SequenceStep> = []
	for (const step of steps) {
		out.push(step)
		if (step.kind === "wait_for_event") out.push(...walk_steps(step.on_timeout ?? []))
		if (step.kind === "condition") {
			out.push(...walk_steps(step.then ?? []), ...walk_steps(step.else ?? []))
		}
		if (step.kind === "branch") {
			for (const lane of step.branches) out.push(...walk_steps(lane.steps))
		}
	}
	return out
}
