import { readFileSync } from "node:fs"
import { exit, stdin } from "node:process"
import { analyze, check_links } from "../library/inspect/index.js"
import type { Finding, Report } from "../library/inspect/index.js"
import { bold, cyan, dim, green, red, yellow } from "./prompts.js"

/**
 * `postboi inspect` — the static analyzer at the command line, for CI and for
 * anyone who wants a verdict on an HTML file before it becomes an email.
 *
 * The analysis is postboi/inspect's `analyze()`, unchanged: client compatibility,
 * Gmail clipping, accessibility, deliverability signals. `--links` adds the one
 * thing the analyzer won't do on its own — actually fetching every link.
 *
 * The exit code is the contract: 0 when the email passes (info findings
 * included), 1 on warnings or errors, so `postboi inspect build/welcome.html`
 * is a complete CI step; `--info-fails` tightens it for the fastidious.
 */

const HELP = `
${bold("Usage")}
  ${cyan("bunx postboi inspect <file.html>")}   Lint an email's HTML ${dim("(«-» reads stdin)")}

${bold("Options")}
  --links       Also fetch every http(s) link and report the ones that don't answer
  --subject <s> Include the subject line in the analysis
  --json        Print the full report as JSON instead of findings
  --info-fails  Exit non-zero on info findings too, not just warnings and errors
`

function read_source(target: string): string {
	if (target === "-") return readFileSync(stdin.fd, "utf8")
	return readFileSync(target, "utf8")
}

const MARKS: Record<Finding["severity"], string> = {
	error: red("✗"),
	warning: yellow("!"),
	info: dim("·"),
}

function print_report(report: Report): void {
	// The message sentence already names the impacted clients — one line per finding.
	for (const finding of report.findings) {
		console.log(` ${MARKS[finding.severity]} ${finding.message}`)
	}
	if (report.findings.length) console.log("")

	const kb = Math.round(report.size.html_bytes / 102.4) / 10
	const clip = report.size.gmail_clip ? " — Gmail will clip this" : ""
	console.log(
		dim(
			`HTML: ${kb} KB${clip} · ${report.links.length} link${report.links.length === 1 ? "" : "s"} · ${report.images.length} image${report.images.length === 1 ? "" : "s"}`
		)
	)
}

export async function inspect_command(args: Array<string>): Promise<void> {
	if (args.includes("-h") || args.includes("--help")) return void console.log(HELP)

	const subject_at = args.indexOf("--subject")
	const subject = subject_at !== -1 ? args[subject_at + 1] : undefined
	const target = args.find(
		(argument, index) =>
			!argument.startsWith("-") && (subject_at === -1 || index !== subject_at + 1)
	)
	if (!target && !args.includes("-")) {
		console.log(HELP)
		console.error(red("Pass an HTML file to inspect (or «-» for stdin)."))
		return exit(1)
	}

	let html: string
	try {
		html = read_source(target ?? "-")
	} catch (error) {
		console.error(red(`Couldn't read ${target}: ${error instanceof Error ? error.message : error}`))
		return exit(1)
	}

	// An HTML file has nowhere to carry a plain-text part, so its absence proves
	// nothing here — the same check is meaningful when a whole message is analyzed
	// (the dev inbox, the hosted report), and pure noise on every CLI run.
	const analyzed = analyze({ html, subject })
	const findings = analyzed.findings.filter((finding) => finding.id !== "missing_plain_text")
	const report: Report = {
		...analyzed,
		findings,
		status: findings[0]?.severity ?? "pass",
	}

	if (args.includes("--json")) {
		console.log(JSON.stringify(report, null, 2))
	} else {
		print_report(report)
	}

	let broken_links = 0
	if (args.includes("--links") && report.links.length) {
		const results = await check_links(report.links)
		for (const link of results) {
			if (link.ok) continue
			broken_links += 1
			console.log(` ${red("✗")} ${link.url} ${dim(`— ${link.error ?? `answered ${link.status}`}`)}`)
		}
		if (!args.includes("--json")) {
			console.log(
				dim(
					`Checked ${results.length} link${results.length === 1 ? "" : "s"}, ${broken_links} broken`
				)
			)
		}
	}

	const failing = args.includes("--info-fails")
		? report.status !== "pass"
		: report.status === "error" || report.status === "warning"
	if (failing || broken_links) {
		if (!args.includes("--json")) console.log(red(`\n${bold(report.status)}`))
		return exit(1)
	}
	if (!args.includes("--json")) console.log(green(`\n${report.status}`))
}
