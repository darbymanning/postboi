# Branding — the docs site

The docs are the third cut of one design language. The app and the marketing site
speak it too; see `postboi-app/AGENTS.md`, "One design language, two cuts". Manila
paper and ink navy, safety yellow, square corners, drawn rules, keys that press
into their own shadow.

Everything below lives in **`src/routes/layout.css`**. If something needs a colour,
a radius or a shadow, it is already there or it should be — do not start a second
palette in a component.

## The three faces

| Face | Package | What it sets |
| --- | --- | --- |
| **Archivo** | `@fontsource-variable/archivo/wdth.css` | headings, labels, buttons — here for its *width* axis (62–125), which is what lets one family cover a poster title and condensed tracked-out docket caps |
| **Golos Text** | `@fontsource-variable/golos-text/wght.css` | everything you read |
| **Monaspace Neon** | `@fontsource/monaspace-neon/latin.css` | anything a machine said: code, commands, keys, paths |

Archivo replaced Inter across the product. Inter is a fine typeface and the single
most-used interface font on the web; a product whose whole voice is "this is not the
sixth one of these you have seen" cannot be set in it.

`@layer base` puts `h1`–`h6` in Archivo automatically, so a heading does not have to
ask. That split *is* the typographic idea: the thing naming a section is the poster
face, the thing you read under it is the reading face.

## The three registers

Three utilities, no fourth:

- **`.poster`** — large, expanded, black. The doc masthead's title and the error
  page's status. Uppercase, with `word-spacing` opened back up, because tracking a
  headline down closes the word space with it.
- **`.docket`** — small, condensed, tracked-out caps: the printing on a form.
  Category eyebrows, file numbers, table column heads, tab labels, the language on a
  code slip, `Take this page`.
- **`.machine`** — mono. Inline code and code blocks.

## The press

`:root` carries light; `.dark` overrides it. Read `--background` as **a sheet** and
`--background-inset` as **the mount it is pinned to** — that is why the doc panel is
manila and the cards inside it are white: a document laid on card, not a card
floating on a page.

- `--paper` / `--foreground` — manila `oklch(0.955 0.018 88)`, ink navy `oklch(0.16 0.032 268)`, and inverted in dark.
- `--border` is the hairline between two areas; **`--line` is the drawn rule** — a
  masthead, a docket underscore, the frame of a key — and it is meant to be read.
- `--brand-yellow` `#FDC005` never changes. `--accent` does: the yellow is too pale
  to read on paper, so light mode's interactive accent is the brand orange and dark
  mode's is the yellow. `--hot` is the yellow when it has to be *text*.
- All colours are oklch.

## The furniture

- **`@utility card`** — a sheet on a desk: a drawn edge and a hard 3px offset with
  no blur in it. The `--shadow-*` scale is the same idea, growing by offset. Printed
  things cast an edge, not a glow — and an offset shadow is the only kind that
  survives an ink-dark ground.
- **`@utility key`** — the one shape every small control takes: the theme toggle,
  the copy buttons, the pager, the phone's action bar. Pressing it moves the whole
  key the width of its shadow and takes the shadow away, which is what a physical key
  does. `translate`, not `scale`, so the label doesn't resample.
- **`@utility inset-shadow`** — the mount a sheet is pinned to: an inset ring, nothing else.
- **`perforated-t`, `airmail`, `halftone`** — printed furniture, available when a
  surface wants it.

## The one gesture for "you are here"

A solid block of safety yellow that slides. It is the sidebar's live page, the TOC's
current run, and the installation tabs' selected package manager — one product, one
way of saying it. Not a glow, not a gradient, and not tinted text: the row's own
type simply goes to full ink.

## Radii

`--radius-base` is `0.0625rem` and the scale tops out at 6px. Not zero: a nested
panel's corner landing exactly on its parent's reads as a misprint, and a focus ring
on a hard corner looks broken. `--radius-full` stays a real pill, for the things that
are round because of what they are.

## The social card

`src/routes/og/[...slug]/+server.ts` renders the same masthead at 1200×630 — docket
category, Archivo title in caps, the yellow block struck on the left of the rule. It
has no CSS engine, so the tokens are converted to hex literals at the top of that
file; change them together with `layout.css`.
