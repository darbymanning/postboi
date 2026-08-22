#!/usr/bin/env bun
/**
 * Point every example at a just-published release.
 *
 * Pre-1.0 a caret can't cross the minor — `^0.35.0` will never install `0.36.0` —
 * so until the pins move the examples keep building against the previous release
 * and the CI Examples job on main goes red the moment one of them uses something
 * the release added.
 *
 * Runs after the publish, not before: the examples install postboi from npm, so
 * a bumped pin is uninstallable until the version is actually out there.
 *
 * Usage: bun scripts/bump-examples.ts X.Y.Z
 */

import { Glob } from "bun"

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
	console.error("usage: bun scripts/bump-examples.ts X.Y.Z")
	process.exit(1)
}

const bumped: Array<string> = []

for await (const path of new Glob("examples/*/package.json").scan(".")) {
	const before = await Bun.file(path).text()
	const after = before.replace(/("postboi":\s*")\^[^"]+(")/g, `$1^${version}$2`)
	if (after === before) continue
	await Bun.write(path, after)
	bumped.push(path)
}

if (!bumped.length) {
	console.log(`• every example already pins ^${version}`)
	process.exit(0)
}

console.log(`✓ pinned ^${version} in ${bumped.length} example${bumped.length === 1 ? "" : "s"}`)
for (const path of bumped) console.log(`  ${path}`)
