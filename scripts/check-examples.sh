#!/usr/bin/env bash
set -uo pipefail

# Install and check every example — the loop CI's Examples job runs, shared with
# the release workflow so "a green run here is a green run there" stays true by
# construction rather than by copy-paste.

failed=""
for dir in examples/*/; do
	echo "── $dir"
	if ! (cd "$dir" && bun install && bun run ci); then
		failed="$failed $dir"
	fi
done

if [ -n "$failed" ]; then
	echo "✗ failing examples:$failed" >&2
	exit 1
fi
