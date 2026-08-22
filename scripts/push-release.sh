#!/usr/bin/env bash
set -euo pipefail

# Push local release commits on main to origin, surviving the one failure a
# blind retry never can: main moved underneath them. On a rejected push this
# fetches, rebases the unpushed commits onto the new tip (re-pointing the tag,
# when there is one), and tries again; plain network failures back off.
#
# With a tag the push is --atomic — main and the tag land together or not at
# all, so a failure never strands a version commit on main with no tag.
#
# Usage: scripts/push-release.sh [vX.Y.Z]

TAG="${1:-}"

rebase_onto_main() {
	git fetch origin main
	if git merge-base --is-ancestor origin/main HEAD; then
		return 0
	fi
	echo "• main moved — rebasing the release commits onto it"
	if ! git rebase origin/main; then
		git rebase --abort
		echo "✗ the release commits conflict with what landed on main — resolve by hand" >&2
		exit 1
	fi
	if [ -n "$TAG" ]; then
		git tag -fa "$TAG" -m "${TAG#v}"
	fi
}

for delay in 0 2 4 8 16; do
	if [ "$delay" != 0 ]; then
		echo "push failed — retrying in ${delay}s"
		sleep "$delay"
	fi
	rebase_onto_main
	if [ -n "$TAG" ]; then
		if git push --atomic origin main "refs/tags/$TAG"; then exit 0; fi
	else
		if git push origin main; then exit 0; fi
	fi
done

echo "✗ could not push to main after 5 attempts — nothing landed (the push is atomic)" >&2
exit 1
