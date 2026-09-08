# Re-theme: the lime console, from the 8 September 2026 Figma (node 49:5268)

Design specification. Approved by Elias on 8 September 2026 in chat (decisions
1–4 below). Source of truth for values: Figma file `NlTjQFMQPUDLstdmzseeJl`,
node `49:5268` ("Final Design"), read through the Figma MCP — not a pasted
export. Where a Figma value fails a readability bar the spec says so and records
the substitute, per the standing ruling carried forward from the 4 September
blue re-theme ("contrast substitutions are accepted where a Figma grey fails
4.5:1 for text").

## Summary

The console moves from the blue three-surface theme of 4 September to the
Figma's lime theme. Four things change at once:

1. **The brand becomes lime.** `#B6FF56` replaces `#007BFF`, and it inverts the
   ink rule: the old brand was a fill under WHITE ink, the new one is a fill
   under NEAR-BLACK ink (`#2C2C2C`).
2. **Three dark surfaces collapse back to one.** Page, chrome and panel are all
   `#121214`; only the card steps away, to `#191919`.
3. **The rail stops being a rail.** 260px, always open. The 56px rest state,
   the hover-to-open mechanism and its cookie retire.
4. **A new metric tile picks its own colour.** A random non-grey key from the
   board palette, which is re-solved for the dark card.

The brand kit, the root `DESIGN.md` and the `/design` page are rewritten to
match. The flow builder is re-themed in full; **the flow canvas surface and its
nodes are exempt from redesign** and change colour only.

## Decisions (Elias, 8 Sep 2026)

1. **Complete re-theme everywhere**, including the flow builder's layout. The
   only exemption is the flow canvas itself and its nodes: those recolour
   through the token layer but keep their structure, layout and spacing.
2. **Light theme is kept**, with a solved-down lime for the stroke role. Lime
   cannot draw on white (`#B6FF56` measures 1.20:1 there), so light mode's
   `--marker` is a darker lime that clears 4.5:1.
3. **The sidebar is always-open at 260px**, exactly as drawn. The hover
   mechanism and its cookie are retired, not hidden.
4. **The 11 board hues are re-solved against the dark card** rather than
   re-picked. Keys are preserved, so no stored value needs a backfill.

5. **The font is Inter**, everywhere. Confirmed by Elias 8 Sep against the
   draft spec: the single `Poppins Bold` glyph on the workspace badge is Inter
   semibold, and no second family ships.
6. **Radius is 8** on every element that has one, with `rounded-full` reserved
   for the delta chip, freshness dot and avatar. Confirmed by Elias 8 Sep.

Carried forward from 4 Sep, not re-asked: contrast substitutions are accepted
where a Figma grey fails its bar for text.

## Goals and non-goals

**Goals**

- Every surface in the app carries the Figma's colour, type, spacing and radius.
- The dashboard overview matches node 49:5268 in layout, size and weight.
- A new metric tile is created with a random colour from the board palette.
- `DESIGN.md`, `docs/BRAND_KIT.md`, `/design` and `scripts/check-ui.ts` describe
  and enforce the lime theme, with no blue prose left standing.

**Non-goals**

- No redesign of the flow canvas or its nodes (decision 1).
- No new features, routes or data model changes beyond the tile-colour default.
- No change to the metric maths, formatting, or any backend behaviour.
- No new dependency. Charts stay hand-rolled SVG; icons stay `lucide-react`.

## Tokens (`src/app/globals.css`)

### Brand ramp (replaces the blue ramp)

The lime is a FILL colour first. Its defining measurement is `#B6FF56` under
`#2C2C2C` ink at **11.59:1** — which is why the Figma sets button labels in
near-black rather than white, and why `--primary-foreground` inverts.

| Token | Hex | Measured | Job |
|---|---|---|---|
| `--color-brand-50` | `#F4FFE4` | — | reserved, the palest wash |
| `--color-brand-100` | `#E9FFC9` | — | reserved |
| `--color-brand-200` | `#DBFFA6` | — | reserved |
| `--color-brand-300` | `#C9FF7D` | — | hover of the fill |
| `--color-brand-400` | `#B6FF56` | 15.53:1 on `#121214` | **THE BRAND** — the fill, the dark stroke (`--marker`), and the default chart series |
| `--color-brand-500` | `#A2E844` | — | pressed |
| `--color-brand-600` | `#8ACC2E` | — | reserved |
| `--color-brand-700` | `#6FA61C` | — | reserved |
| `--color-brand-800` | `#4F7A00` | 5.10:1 on white | **THE LIGHT STROKE** (`--marker` in `:root`) |
| `--color-brand-900` | `#3D5E00` | 7.50:1 on white | the light theme's hover-of-a-stroke |

`--color-brand-400` doing both the fill and the dark stroke is deliberate and is
a simplification over the blue ramp, which needed `500` and `600` to be
different colours because blue-under-white was tight. Lime under near-black has
11.59:1 of room, so one step covers both jobs on dark.

### Neutral ramp (dark), re-cut for `#121214`

| Token | Hex | Job | Change |
|---|---|---|---|
| `--color-neutral-950` | `#121214` | **the page** | was `#0F1011` |
| `--color-neutral-925` | `#121214` | **the chrome** — bar and rail | was `#111111`; now the same value as the page |
| `--color-neutral-900` | `#191919` | **the card** | was the panel `#181818`; re-roled |
| `--color-neutral-850` | `#202020` | **a control** | unchanged |
| `--color-neutral-800` | `#333333` | grey buttons | unchanged |
| `--color-neutral-700` | `#3A3A3A` | `--avatar`, `--accent` | unchanged |
| `--color-neutral-600` | `#343434` | **the hairline** | unchanged |
| `--color-neutral-500` | `#4A4A4A` | the heavier rule | unchanged |
| `--color-neutral-450` | `#6E6E6E` | the caps label only | unchanged — see substitution 2 |
| `--color-neutral-400` | `#828282` | the dimmest INK | was `#858585`; see substitution 1 |
| `--color-neutral-200` | `#FFFFFF` | body, headings, card titles | unchanged |

**`--panel` stops being a third surface.** The Figma draws the content area in
the same `#121214` as the page and the chrome. The role is KEPT (deleting it
would break the swatches test's one-vocabulary rule and every `bg-panel` call
site) and simply points at the same value. This is a one-surface theme again,
which reverses `DESIGN.md` §2 for the second time; the prose must say so
explicitly rather than quietly reword.

**The card is the only step, and it is tiny.** `#191919` on `#121214` measures
**1.06:1**. That is the whole argument for keeping the `#343434` hairline: a
card without its border is not a flatter card, it is an invisible one. Unchanged
in kind from the blue theme, which ran 1.01:1.

### Role changes that are not colour swaps

| Role | Was | Becomes | Note |
|---|---|---|---|
| `--primary` | `--color-brand-600` | `--color-brand-400` | the lime fill |
| `--primary-foreground` | `#FFFFFF` | `#2C2C2C` | **inverts** — near-black on lime |
| `--primary-hover` | brand-500 | `--color-brand-300` | lighter, not darker |
| `--primary-active` | brand-700 | `--color-brand-500` | |
| `--marker` (dark) | `#3D9BFF` | `--color-brand-400` | 15.53:1 on the page |
| `--marker` (light) | `#0062CC` | `--color-brand-800` | `#4F7A00`, 5.10:1 on white |
| `--muted-foreground` | `#858585` | `#828282` | substitution 1 |
| `--faint` | `#6E6E6E` | `#6E6E6E` | unchanged — substitution 2 |
| `--brand-soft` | `rgb(0 123 255 / .1)` | `rgb(182 255 86 / .1)` | |
| `--brand-soft-line` | `rgb(0 123 255 / .25)` | `rgb(182 255 86 / .25)` | |

Unchanged and explicitly re-confirmed against the Figma: `--border` `#343434`,
`--control` `#202020`, `--freshness-dot` `#34C759` with its
`rgb(0 212 146 / .15)` halo (the one Figma variable actually bound in the file,
`Accents/Green`), `--foreground` and `--heading` at `#FFFFFF`.

### Light theme

Light keeps every role. Only the brand moves: the fill stays `#B6FF56` under
`#2C2C2C` ink (11.59:1 works on any ground), and the stroke becomes
`--color-brand-800` `#4F7A00` at 5.10:1 on white. Surfaces, hairlines and ink
are unchanged from the 4 September light theme, which was solved from its own
Figma export and which this pass has no source to revise.

### Contrast substitutions

Recorded rather than silently applied, per the standing ruling.

1. **`--muted-foreground`: `#7E7E7E` → `#828282`.** The Figma sets every card
   title and axis label in `#7E7E7E`. On the page that measures 4.61:1 and is
   fine; on the `#191919` CARD — where card titles actually live — it measures
   **4.33:1**, under the 4.5 a 14px label owes. `#828282` measures 4.58:1 on the
   card and 4.87:1 on the page. A four-value nudge, invisible beside the
   original, that makes every card title legal on both grounds.

2. **Inactive tabs: `#4A4A4A` → `--muted-foreground`.** The Figma sets the
   "Main Menu" caption AND the inactive "Group"/"Calendar" tabs in `#4A4A4A`,
   which measures **2.11:1** on `#121214` — below even the 3:1 a non-text
   graphic owes, and these are interactive controls. The caption keeps a faint
   step (`--faint` `#6E6E6E`, 3.67:1, caps-label-only exactly as today); the
   TABS move up to `--muted-foreground`. An inactive tab nobody can read is a
   functional bug, not a quiet aesthetic.

   `#4A4A4A` is still used as drawn where it sits on WHITE — the "Today" and
   "Refresh All" button ink — where it measures 8.86:1.

## Type

The Figma's dominant UI size is **14px**, where the current kit's base is 15px.
The base moves down one step; this touches every surface, which is why it is
called out here rather than buried in a component list.

| Step | Size / leading / tracking | Where |
|---|---|---|
| `--text-xs` | 12 / 16 / −0.078 | axis labels, legend, delta chip, "Main Menu", freshness |
| `--text-sm` | **14** / 18 / −0.24 | **the UI base** — nav, tabs, buttons, card titles |
| `--text-md` | 15 / 22 / −0.24 | the search field's placeholder |
| `--text-display-xs` | 28 / 40 / −1.08 | the metric numeral on a chart card |
| — | 28 / 36 / −1.08 | the metric numeral on a stat tile (tighter leading) |

Weights stay **400 / 500 / 600**. The Figma sets the delta chip's percentage in
Inter **Bold (700)**; `check-ui.ts` bans `font-bold` outright and the kit runs
three weights. **Resolved: semibold.** Reopening a fourth weight for one pill is
the exact drift the gate exists to stop.

`Poppins Bold` appears once, for the workspace badge letter. **Resolved by
Elias: Inter semibold.** One glyph does not justify shipping a second font family; the badge
is a 28px lime square whose letter is 13px, and no one can identify a typeface
at that size from a single character.

`SF Pro` appears once, on the avatar initials — that is the system stack the kit
already names as `--font-sans`'s first fallback. No change.

## Shape

- **8px on everything that contains something**: cards, buttons, controls, nav
  rows, the search field, the invite card. `--radius-card`, `--radius-control`
  and `--radius-surface` all resolve to 8.
- **Full** on the delta chip, the freshness dot and halo, and the avatar.
- The Figma's `rounded-[37282700px]` on the freshness dot and
  `rounded-[999px]` on the chip are both "pill"; they normalise to
  `rounded-full`.
- `--radius-frame` — the dark-theme notch where the panel meets the chrome —
  **retires**. It existed because a radius reveals what is behind it; page,
  chrome and panel are now one colour, so it reveals nothing. Same argument the
  blue theme used to reinstate it, running the other way.

## Layout and the shell

### Sidebar — 260px, always open

`bg-chrome`, `border-r` hairline, `pt-14 px-16`, column layout.

1. **Workspace row** — `py-6`, `justify-between`. A 28px lime square, radius 8,
   holding the workspace initial in `#2C2C2C` at 13px semibold; the workspace
   name at 14px semibold white; a 24px chevron. `pb-24` below the block.
2. **Search** — 36px tall, `bg-control`, hairline border, radius 8. An 18px
   glyph in a 32px box, then the placeholder at 15px `--muted-foreground`.
   This stays a real `Input`, as the current rail already does.
3. **"Main Menu"** — 12px `--faint`, `pt-24` above it, `gap-8` below.
4. **Nav rows** — 36px, radius 8, `gap-10`. An 18px glyph in a 32px box, then
   the label at 14px. Active: `bg-control` fill, white, semibold. Rest:
   `--muted-foreground`, regular.
5. **Sub-nav** (under the active row) — `gap-16`, a 16px-wide gutter carrying
   three stacked 1px vertical rules, the active one white and the rest
   `--muted-foreground`; then 32px rows at 14px, active white, rest muted.
6. **Footer** — `px-16 pb-24 gap-16`. An "Invite Members" card (`bg-control`,
   hairline, radius 8, `px-12 py-8`, a 16px glyph, a 12px semibold white title
   over a 12px muted line), then a full-width lime "New" button: 36px, radius 8,
   a 16px glyph and a 14px semibold `#2C2C2C` label.

**Retiring the hover rail.** The 56px rest state, the pointer-open behaviour and
the cookie that remembered it all come out. `ShellSkeleton` must mirror the new
fixed 260px, for the reason it always mirrored the rail: a ghost of the wrong
width jumps the content at hydration.

### Top bar

`bg-chrome`, `border-b` hairline, `px-24 py-16`, three groups:

- **Left** — a 32px `--avatar` circle with 13px initials, the user's name at
  14px semibold white, and a 20px gift glyph carrying a small lime dot badge.
- **Centre** — flex-1, centred: *Try **Namzilabs** for free* at 14px. "Try" and
  "for free" are italic regular; "Namzilabs" is semibold italic in lime.
- **Right** — `gap-16`: "Updated just now" at 14px `--muted-foreground`; a
  Share group (14px glyph + 14px semibold white); a 16px moon toggle; a 24px
  bell.

### Main

`p-24`, `gap-16`. A header row, then the grid.

- **Header left** — "Overview" at 14px semibold white with a 16px options glyph
  beside it; "Group" and "Calendar" at 14px `--muted-foreground` (substitution
  2); a 32px "+" button.
- **Header right** — `gap-16`, three 32px buttons, radius 8:
  - **Add** — lime fill, `#2C2C2C` ink, 14px semibold, a 16px glyph.
  - **Today** — **white fill**, `#4A4A4A` ink, 14px semibold, a 16px leading
    glyph and a 12px trailing chevron.
  - **Refresh All** — **white fill**, `#4A4A4A` ink, 14px semibold, 16px glyph.

  The two white pills are verified against an isolated render of node 49:5422,
  not inferred: they are white, and they are loud against the "quiet chrome"
  thesis. Shipped as drawn; the prose in `DESIGN.md` must own the tension rather
  than pretend it is quiet.

- **Grid** — 12 columns, 16px gaps, 24px row unit. Chart cards span 4 columns ×
  10 rows; stat tiles span 3 columns × 2 rows.

## Tiles and charts

**Chart card** — `bg-card`, hairline, radius 8.
- Header: `pt-16 px-16`, title at 14px `--muted-foreground` (leading 15), the
  freshness group right-aligned (a 12px halo circle with a 4px `#34C759` dot,
  then "1 hr ago" at 12px muted).
- Body: `px-16 pb-8`. The numeral at 28px semibold, leading 40, tracking −1.08.
- Chart: `pt-12`. A right-aligned y-axis label column at 12px muted, the plot,
  and an x-axis row at 12px muted. Horizontal grid lines at each tick; a dashed
  rule on the zero floor.
- Legend: centred, `pb-16`, `gap-10`. An 8px round dot per series, then the
  label at 12px muted.

**Stat tile** — same card, same header, then `p-16`: the numeral at 28px
semibold leading 36, and a delta chip pushed right.

**Delta chip** — `rgb(120 120 120 / .15)` fill, radius full, `px-8 py-2`,
`gap-4`. A 12px direction arrow, the percentage at 12px **semibold** (see Type),
then "vs compared" at 12px regular. Both ink and arrow are
`--muted-foreground` in BOTH directions: the chip does not pick a colour for up
or down, which preserves the kit's existing "the delta refuses to pick a
direction" rule rather than inventing one.

**Series colours** — the primary series is the tile's own accent (lime by
default); the comparison series is `rgb(10 151 213 / .5)`, a blue at half alpha.
This is the one place blue survives the re-theme, and it survives as a
comparison, not as the brand.

## The random tile colour

`GROUP_ACCENT` in `src/components/flow/node-accent.ts` holds 11 hues plus grey,
each currently solved to **3.05:1 against WHITE**. On a `#191919` card that
solve is wrong and several read as mud.

1. **Re-solve all 11 hues against `#191919`** to the most vivid version of each
   hue that clears 3:1 there. Keys and hue order are preserved exactly — no key
   is added or removed, so every stored `color` keeps working with no backfill.
   That property is precisely what the key-not-hex design bought, and this is
   the first pass to actually spend it.
2. `grey` keeps its "no colour" job and is re-cut for the dark card.
3. **`accentOf()`'s fallback** changes from `var(--color-brand-500)` to
   `var(--color-brand-400)` — the Figma draws the default series in `#B6FF56`
   itself, the same value as the fill, so the series does not get its own step.
4. **`addCustomTileAction`** (`src/app/dashboard/board-actions.ts`, the insert
   near line 1188) sets `color` to a random key drawn from `GROUP_COLOR_KEYS`
   minus `grey`, instead of letting the column fall through to its `"grey"`
   default. The column default stays `"grey"` — that is the degrade path for
   rows written by anything else, and it should stay boring.

Randomness lives in the action, not in the render. A colour chosen at render
time would change on every reload, which is a different feature and a worse one.

## Docs and enforcement

- **`DESIGN.md`** (550 lines) — rewritten. It currently argues at length for
  blue and for three surfaces; both arguments are now reversed and the file must
  say so in its own voice, including §2's second reversal and §4's retirement of
  the two-step split.
- **`docs/BRAND_KIT.md`** (836 lines) — rewritten. Token tables, measured
  ratios, the substitution log, the white-secondary-button tension.
- **`scripts/check-ui.ts`** — the gate keeps every rule it has. `font-bold`
  stays banned (see Type). The allowlist entry sanctioning hexes in
  `node-accent.ts` stays and is the only one.
- **`/design`** — the living render; every swatch and specimen re-solved.

**Tests that pin the old theme** and must be rewritten to the new truth, not
deleted:

| Test | What it pins |
|---|---|
| `design-swatches.test.ts` | every role declared in both themes |
| `theme-roles.test.ts` | role vocabulary |
| `console-theme.test.ts` | the dark console's values |
| `canvas-tokens.test.ts` | canvas tokens |
| `retheme-blue-docs.test.ts` | asserts the docs describe BLUE — renamed and inverted |

New coverage: a test asserting `addCustomTileAction` writes a non-grey key, and
a contrast test asserting the re-solved hues clear 3:1 on `#191919` and that
`--muted-foreground` clears 4.5:1 on both the page and the card.

## Risks

1. **The 15px → 14px base touches every surface.** Mitigated by its being a
   token edit, but it will shift line lengths in dense views (tables, the
   connection list). Screenshot those specifically.
2. **Lime is a high-luminance brand.** `#B6FF56` at 15.53:1 is brighter than
   anything the product has shipped; large lime areas can glare. The design uses
   it only on small fills, and nothing here should grow one.
3. **The white secondary buttons** are the loudest thing in the header after the
   lime. Shipped as drawn per decision, flagged here so a future pass knows it
   was deliberate.
4. **`--panel` collapsing to `--background`** leaves 4 call sites (in 3 files) styling
   against a surface that no longer differs. They keep working; a later pass may
   simplify them. Not in scope.
5. **The flow canvas exemption is a colour-only boundary.** Anything that reads
   like layout drift inside the canvas is out of scope and should be raised, not
   fixed silently.

## Rollout

One branch, worktree-isolated, in this order — each step green before the next:

1. Token layer (`globals.css`) + the re-solved palette. The whole app recolours.
2. Gate and tests updated to the new truth.
3. Shell: sidebar (260px), top bar, `ShellSkeleton`.
4. Cards, charts, delta chip, buttons, tabs.
5. Remaining surfaces, flow builder chrome included; canvas colour-only.
6. Random tile colour.
7. `DESIGN.md`, `BRAND_KIT.md`, `/design`.

Verification at each step: `pnpm typecheck`, `pnpm test`, `pnpm check:ui`, and
`SHOT_SCHEME=dark pnpm shot /design/overview` compared against the Figma render.
