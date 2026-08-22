# postboi

Framework-agnostic email library (npm package at repo root) plus a docs site in `docs/`.

## Cutting a release

Releases come out of a merge. Label the PR `release:patch`, `release:minor` or
`release:major` and merging it freezes the outgoing docs, bumps, validates,
publishes to npm, tags, cuts the GitHub release and moves the examples' pins.
Pre-1.0 a breaking change is a **minor**.

When asked to "cut a release" / "release" / "publish a new version" with no PR to
label, follow **[RELEASING.md](RELEASING.md)** — run the Release workflow by hand,
or `npm run release -- <patch|minor|major|X.Y.Z>` from a clean `main`. Do not run
the freeze/publish/push steps by hand — the workflow and the script sequence them
and check preconditions.

## Planned work

**[CHANNELS.md](CHANNELS.md)** is the plan for taking postboi multi-channel — SMS, push
notifications, and a `notify()` that fans out across them. Read it before starting any
channel work; it carries the `ProviderBase` split that everything else depends on.

## Conventions

- Code style: snake_case, no semicolons. Run `bun run check` and `bun run lint`.
- Styling the docs site: follow **[docs/BRANDING.md](docs/BRANDING.md)** — brand yellow `#FDC005`, all colours in oklch, accent adapts per light/dark.
- Release commits are the bare version (`0.7.0`); tags are `vX.Y.Z`.
- Pre-1.0: breaking changes are **minor** bumps.
