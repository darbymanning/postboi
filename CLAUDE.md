# postboi

Framework-agnostic email library (npm package at repo root) plus a docs site. The
site is **not** in `docs/` — its routes are `src/routes/`, its components and content
are `src/site/`, and it is built with SvelteKit and Tailwind v4.

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

**`postboi-app/LIFECYCLE.md`** (in the app repo) is the plan for lifecycle email — events,
segments, sequences, campaigns, integrations, MCP and hosted generation. The library's share
of it is `mail.events` / `mail.segments` / `mail.sequences`, a typed `sequence()` for
sequences-as-code, the `postboi/better-auth`, `postboi/convex` and `postboi/lunora`
plugins, `postboi mcp`, `postboi import`, and the skill's Lifecycle section. Read it before
starting any of those.

Shipped so far: the `mail.*` namespaces, `sequence()`, the three auth-layer plugins, the
Lifecycle docs page and the skill's Lifecycle section. Still to come: `postboi mcp` and
`postboi import`.

The three plugins share `src/library/lifecycle.ts`, and share one rule with it: **a
signup must not fail because email tracking failed.** They sit inside somebody's
authentication path, so every call is caught and reported through `on_error` rather than
thrown. They write the same `auth.*` names the hosted Clerk and Supabase integrations
write, so a sequence keeps working when a customer moves an event between a webhook and
their own code.

## Conventions

- Code style: snake_case, no semicolons. Run `bun run check` and `bun run lint`.
- Styling the docs site: follow **[src/site/BRANDING.md](src/site/BRANDING.md)**. The
  docs are the third cut of one design language shared with the app and the marketing
  site — manila paper and ink navy, safety yellow `#FDC005`, square corners, drawn
  rules, keys that press into their own shadow, and three faces (Archivo for anything
  that names a thing, Golos Text for anything you read, Monaspace Neon for anything a
  machine said). Every token lives in `src/routes/layout.css`; all colours are oklch
  and the accent adapts per light/dark. Don't start a second palette in a component.
- Release commits are the bare version (`0.7.0`); tags are `vX.Y.Z`.
- Pre-1.0: breaking changes are **minor** bumps.
