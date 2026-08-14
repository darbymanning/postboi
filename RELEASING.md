# Releasing

A release ships two independent artifacts:

1. **The library** — the `postboi` npm package (published from this repo root).
2. **The docs site** — [docs.postboi.app](https://docs.postboi.app), the SvelteKit app at the repo root, deployed on push to `main`. Each release is snapshotted so readers can switch to older versions.

The library release is scripted. The docs snapshot is a short manual step because it involves copying content and hand-editing the version list.

## Prerequisites (one-time)

- A **trusted publisher** configured on npmjs.com so the Publish workflow can
  publish without a token: package settings for `postboi` → _Trusted Publisher_
  → GitHub Actions, with organization/user `postboi-mail`, repository
  `postboi`, and workflow filename `publish.yml`.

No local `npm login` or `gh auth login` needed — publishing and the GitHub
release happen in CI ([`publish.yml`](.github/workflows/publish.yml)),
authenticated via OIDC.

## Steps

Do these in order for a release of version `X.Y.Z`. Skip Part A if the docs
didn't change since the last release.

### A. Snapshot the outgoing docs version (before editing docs for the new one)

`src/site/content/docs/` always holds the **latest** docs. Freeze the
currently-published version as an archived snapshot **before** you edit docs for
`X.Y.Z`. Let `PREV` be the value of `latest` in
[`src/site/config/versions.json`](src/site/config/versions.json).

1. Copy the current docs into a version folder (set `PREV` to that value first):
   ```sh
   PREV=0.6.0   # ← the current "latest" in versions.json
   cp -R src/site/content/docs "src/site/content/v$PREV"
   ```
   This assumes you got here _before_ the new version's doc edits landed. If
   they're already on `main` — a feature branch that carried its own docs, say
   — a plain `cp` would archive the new pages as `PREV`. Take them from the
   commit just before those edits instead, and read the nav from the same
   commit:
   ```sh
   BEFORE=abc1234   # ← last commit with PREV's docs, e.g. main^ of the merge
   mkdir -p "src/site/content/v$PREV"
   git archive "$BEFORE" src/site/content/docs \
     | tar -x --strip-components=4 -C "src/site/content/v$PREV"
   git show "$BEFORE:src/site/config/navigation.ts"
   ```
2. In `src/site/config/versions.json`:
   - Set `"latest"` to the new version `X.Y.Z`.
   - Prepend an entry to `archived` (newest first):
     ```json
     {
     	"version": "PREV",
     	"slug": "vPREV",
     	"nav": [/* … */]
     }
     ```
     For `nav`, copy the current sidebar structure from
     `contentSections[0].navigation` in
     [`src/site/config/navigation.ts`](src/site/config/navigation.ts). It's JSON,
     so drop the component references (`icon: Email`) but **keep `icon: true`** —
     that's data the sidebar renders from, and every snapshot since `v0.14.0`
     carries it. This freezes the old nav even if you rename or reorder pages
     in the new version.
3. Now make the actual `X.Y.Z` doc edits in `src/site/content/docs/` (and
   `navigation.ts` if the nav changed).
4. Commit and push — this deploys the site (the docs app is the repo root now). Verify the switcher lists
   the new version and `/vPREV` still renders the old docs.

> Snapshots are plain committed files under `src/site/content/v*/`. There's
> no build-time git dependency — the site builds on a shallow clone. (The first
> snapshot, `v0.5.0`, was seeded once from git history; everything after is a
> `cp`.)

### B. Release the library

From the repo root, on a clean `main`:

```sh
npm run release -- X.Y.Z      # or: patch | minor | major
```

The script ([`scripts/release.sh`](scripts/release.sh)) does, failing fast if
anything is off:

1. Checks you're on `main` and the tree is clean.
2. Bumps `package.json` to `X.Y.Z`.
3. Runs `npm test` and `npm run build` (build runs `publint` on the package).
4. Commits `X.Y.Z`, tags `vX.Y.Z`.
5. Pushes `main` and the tag.

Pushing the tag triggers the **Publish** workflow
([`publish.yml`](.github/workflows/publish.yml)), which re-runs tests and the
build, checks the tag matches `package.json`, publishes to npm via trusted
publishing (OIDC, with provenance), and creates the GitHub release with
generated notes.

If tags can't be pushed from where you're releasing (e.g. a remote sandbox
whose git proxy only allows branch pushes), push `main` with the version-bump
commit and trigger the Publish workflow manually on `main` instead
(`workflow_dispatch`) — it derives the tag from `package.json` and creates
both the tag and the release itself.

### C. Verify

- The [Publish run](https://github.com/postboi-mail/postboi/actions/workflows/publish.yml) is green.
- `npm view postboi version` shows `X.Y.Z`.
- The GitHub release exists at `vX.Y.Z`.
- The docs site shows the new version as latest and archived versions still load.

## Conventions

- Commit message for a release is the bare version (`0.7.0`), matching history.
- Tags are `vX.Y.Z`. Pre-`0.7.0` releases predate this script and are untagged.
- Pre-1.0, breaking changes are **minor** bumps (e.g. the `settings`→`config`
  rename went `0.5.0` → `0.6.0`).
