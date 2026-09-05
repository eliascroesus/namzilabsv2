# Re-theme: the blue console (dark and light), from the 4 September 2026 Figma

Design specification. Approved by Elias on 4 September 2026 in chat (decisions
1–6 below). Source of truth for values: the two Figma exports Elias pasted
(dark, then light); where a Figma value fails a readability bar the spec says so
and records the substitute, per Elias's "I trust you if it is the Figma design".

## Summary

The console moves from the cyan-on-`#1B191A` one-surface theme of 2 September
to the Figma's blue theme: three dark surfaces (page `#0F1011`, chrome
`#111111`, panel `#181818`), `#343434` hairlines, `#007BFF` as the brand, 8px
corners on every control (no pills), a full-width 60px top bar carrying the
wordmark, a re-dressed hover rail, a 28px Inter headline number on tiles, and a
matching light theme (white chrome, `#E1E1E1` hairlines, `#F7F8F9` page and
panel). The brand kit, the root `DESIGN.md` and the `/design` page are rewritten
to match. The flow builder's canvas stays frozen.

## Decisions (Elias, 4 Sep 2026)

1. Brand blue `#007BFF` replaces the cyan everywhere.
2. Three dark surfaces instead of one (page, chrome, panel), as the Figma shows.
3. The sidebar STAYS a hover rail (56px at rest, 260px expanded). Only its
   dressing changes; the expanded state follows the Figma sidebar.
4. Tile headline numeral: 28px (from 36px), Inter 600.
5. Contrast substitutions are accepted where a Figma grey fails 4.5:1 for text.
6. Light theme values come from the Figma light export.

## Goals and non-goals

Goals: every route in both themes renders in the new vocabulary with no
hard-coded hex in components; the brand kit, `DESIGN.md` and `/design` agree
with the tokens; `check:ui`, `design-swatches`, `page-width`, `chrome-band` and
`console-theme` tests are updated to pin the NEW rules, never silenced.

Non-goals: the flow builder canvas and its node accents (`src/components/flow/*`,
`--canvas-*`, `GROUP_ACCENT`) — untouched (Elias: "tidy and fix, never
redesign"); a fixed sidebar (decision 3); a 12px caption step (captions stay
13px, the closed type scale's nearest step); Poppins for the workspace name (a
Figma artefact — it is set in the UI face at 15px/600).

## Tokens (`src/app/globals.css`)

### Brand ramp (replaces the cyan ramp)

| Step | Hex | Role | Measured |
|---|---|---|---|
| 50 | `#E6F2FF` | wash on light | — |
| 100 | `#CCE5FF` | | — |
| 200 | `#99CBFF` | | — |
| 300 | `#66B2FF` | | 8.51:1 on `#0F1011` |
| 400 | `#3D9BFF` | THE DARK STROKE (`--marker` in `.dark`): links, focus ring, selected edge. NOT the active tab's rule — see `--tab-rule` below (amended 5 Sep: the Figma draws that rule in grey) | 6.65:1 on `#0F1011`, 6.59:1 on `#111111`, 6.20:1 on `#181818` |
| 500 | `#007BFF` | THE BRAND: hover of the fill, the workspace initial tint (`rgb(0 123 255 / .75)`), decorative dots, chart series default | 4.79:1 as a stroke on `#0F1011` |
| 600 | `#0070E8` | THE FILL (`--primary`, both themes) under WHITE ink | 4.68:1 white-on-fill; the Figma's `#007BFF` measures 3.98:1 under white, under the 4.5 a 15px label owes — one step deeper, indistinguishable beside it |
| 700 | `#0069D9` | pressed | 5.22:1 under white |
| 800 | `#0062CC` | THE LIGHT STROKE (`--marker` in `:root`): links, ring, active rule on white | 5.80:1 on white |
| 900 | `#0056B3` | reserved (light hover of a stroke) | 7.04:1 on white |

`--primary-foreground` becomes `#FFFFFF` in both themes (was near-black under
cyan). `--brand-soft` = `rgb(0 123 255 / 0.10)`, `--brand-soft-line` =
`rgb(0 123 255 / 0.25)` (dark) / `0.30` (light). Hover walks UP on dark
(600 → 500) and DOWN on light (600 → 700), and because a component may not
spell `dark:`, that is a ROLE: `--primary-hover` = brand-500 in `.dark` and
brand-700 in `:root`, bridged as `bg-primary-hover`; the pressed step
`--primary-active` = brand-700 in both (amended 5 Sep; until the final pass
lands, `button.tsx` hovers to 500 in both themes, which on light puts white
text on `#007BFF` at 3.98:1 for the duration of the hover).

Two more roles the Figma implies, added 5 Sep: `--tab-rule` — the active tab's
1px bottom rule — is `--muted-foreground` in `.dark` (the Figma draws
`#7E7E7E`) and `--heading` in `:root` (the Figma draws `#313131`), bridged as
`border-tab-rule`; the rule is NOT the blue stroke. The active nav row's glyph
keeps `text-marker` on its `--control` row (two signals: fill and colour; the
docs must not claim the glyph is uncoloured).

### Neutral ramp (dark), re-cut for `#0F1011`

| Step | Hex | Role |
|---|---|---|
| 950 | `#0F1011` | `--background` — THE PAGE ground |
| 925 (new) | `#111111` | `--chrome` — top bar, rail, AND `--card` |
| 900 | `#181818` | `--panel` — the content area under the top bar |
| 850 (new) | `#202020` | `--control` — fields, the search box, the active nav row |
| 800 | `#333333` | `--secondary` — grey buttons |
| 700 | `#3A3A3A` | `--accent` — the hover/press step above a grey button (amended 5 Sep); also `--avatar` |
| 700 | `#3A3A3A` | avatar / icon circles (`--avatar`) |
| 600 | `#343434` | `--border` — EVERY hairline |
| 500 | `#4A4A4A` | `--rule` (heavier control edge); the Figma's "Main Menu" grey is NOT text-safe (2.13:1) |
| 450 (new) | `#6E6E6E` | `--faint` — the caps section label only ("Main Menu"), 3.70:1 on `#111111`; never body copy |
| 400 | `#858585` | `--muted-foreground` — the Figma's `#7E7E7E` measures 4.37:1 on the panel; `#858585` is 4.81:1 there and 5.12:1 on a card |
| 200 | `#FFFFFF` | `--foreground`, `--heading`, `--card-foreground` — the Figma sets body AND titles in white |

Step numbers are labels for the ladder; the file keeps its surface-half /
ink-half rule: 500 is the last LINE step, 450 is a caps-label-only step, 400 is
the first TEXT step.

Steps 300 / 100 / 50 stay DEFINED, re-cut for the new ground — `#B5B5B5`,
`#E5E5E5`, `#FAFAFA` — because `scroll-area.tsx`, `switch.tsx`, `button.tsx`'s
`white` variant and the off-limits `node-meta.ts` all still spell them
directly. Nothing in this pass retires them; they simply stop being read by a
ROLE.

**Depth, stated honestly.** The old line — "a control recesses from a card" —
does not survive this Figma and is not carried forward. On dark, on the
`#111111` chrome and cards, a field is a step UP (`--control` `#202020`) and its
hover a further step up (`--accent` `#3A3A3A`, amended 5 Sep). On light a field is a step DOWN
(`#F4F4F4` on white) and its hover a further step down (`#ECECEC`). The two
directions mirror each other; neither is "recessed".

Shadows: `--shadow-card` = `0 1px 2px rgb(0 0 0 / .20), 0 0 3px rgb(0 0 0 / .10)`
(the Figma card shadow, both themes). Card radius stays 10px; controls 8px;
`--radius-frame` becomes 8px. Which corner it cuts is settled in Layout below.
The corner is a DARK-theme device: in light the page and the panel are both
`#F7F8F9` (the Figma light export's outer frame is a dark artefact, not a
ground), so the notch cuts a colour out of the same colour and draws nothing
there; the code's comment says so (amended 5 Sep after the shell review).

### Light theme (`:root`), from the Figma light export

| Role | Hex | Measured |
|---|---|---|
| `--background` (page) and `--panel` | `#F7F8F9` | — |
| `--chrome` (top bar, rail) and `--card` | `#FFFFFF` | — |
| `--border` (hairline) | `#E1E1E1` | — |
| control outline (`--input`) | `#E4E4E4` | — |
| `--control` (search box, active nav row) | `#F4F4F4` | — |
| `--secondary` | `#FFFFFF` with a `--input` outline (the Figma's grey buttons are white with an `#E4E4E4` edge) | — |
| `--secondary-foreground` (the button's TEXT) | `#303030` — the Figma's own button label | 13.2:1 on white |
| icon ink on grey buttons, where an icon sets its own ink | `#4A4A4A` | **8.86:1** on white, measured — the Figma export's own 8.4:1 is a rounding on their side |
| `--foreground` / `--heading` | `#000000` / `#313131` (page title, workspace name) | — |
| `--muted-foreground` | `#6B6B6B` — the Figma's `#8E8E8E` measures 3.28:1 on white; `#6B6B6B` is 5.33:1 on white and 5.01:1 on `#F7F8F9` | |
| `--faint` (caps label) | `#8E8E8E` (the Figma's `#BABABA` is 1.94:1) | 3.28:1, caps label only |
| `--avatar` (bell and avatar circles) | `#FFFFFF` with the `--input` (`#E4E4E4`) outline | — |
| `--muted` (fill) | `#F4F4F4` (light) / `#181818` (dark) | — |
| `--accent` (hover) | `#ECECEC` (light — a step darker than `--control`) / `#3A3A3A` (dark — amended 5 Sep after the token review: at `#333333` it equalled `--secondary` and a grey button's hover vanished; `#3A3A3A` is the step above, shared with `--avatar` as a value, not as a role) | — |
| `--rule` (heavier control edge) | `#CFCFCF` (light) / `#4A4A4A` (dark) | — |
| `--input` (control outline) | `#E4E4E4` (light) / `= --border` (dark) | — |
| `--popover` / `--popover-foreground` | `= --card` / `= --card-foreground`, in BOTH themes | — |
| `--primary` / `--marker` | `#0070E8` / `#0062CC` | see the ramp |
| `--success` etc. | unchanged (`#00734B` trio) | |
| `--freshness-dot` | `#34C759` on `rgb(0 212 146 / .15)` | 8.51:1 on `#111111`; on white the dot keeps its halo |

### State

`--success`, `--warn`, `--danger` trios are unchanged in both themes. A new
`--freshness-dot: #34C759` (both themes) and `--freshness-halo: rgb(0 212 146 /
0.15)` replace the tile's re-use of `--success`/`--success-soft` for the
"healthy" dot; the state vocabulary stays separate from the brand.

## Shape

Buttons, chips' containers, inputs, selects, tabs, nav rows, the period
switch: `rounded-control` (8px). Cards, popovers, menus: 10px. Circles only for
avatars, the bell badge, the freshness dot and the "active count" numeral. The
`rounded-full` in `ui/button.tsx`'s base class and in `ui/page.tsx`'s
`PERIOD_TRACK`/`PERIOD_PILL` go, and so does the pair of `rounded-full`
overrides on `calendar-board.tsx`'s month-stepper arrows — the last place a
circle could have survived inside a rectangular groove. `select.tsx` was
already `rounded-control` on both its trigger and its items: verified, not
changed. `tests/console-theme.test.ts`'s pin flips to assert
`rounded-control`. This is recorded in the brand kit as the final word on the
shape rule, with the Figma as the reference.

## Type

`--font-sans`/`--font-display` unchanged (system UI first, Inter fallback — SF
Pro renders on Apple hardware). Body 15/22, captions 13, page title 26/600 stay.
Changes: the tile numeral (`.stat-numeral`, `--text-display-md`) becomes 28px /
40px line, Inter 600 (`font-family: var(--font-inter, "Inter"), var(--font-sans)`
— Inter explicitly, since the numeral is the one place the Figma names it);
the wordmark "Namzilabs" is a new `.wordmark` class: Inter, 24px, weight 900,
22px line — the ONLY weight above 600 in the kit. The 900 is declared in the
CSS class itself (`globals.css`), never as a `font-black` utility at a call
site, so `scripts/check-ui.ts` — which scans `.tsx` only and never `.css` —
needs no allow-list entry for it and does not get one. There is exactly ONE
weight exception in the kit, and it is this class. Secondary button labels in
the Figma's top bar are 15/500; the header's "+ Add / Today / Refresh All" are
12px/550 Inter — mapped to the kit's `xs` button size (13px), not a new step.

## Layout and the shell

Every fractional Figma measurement is rounded to a whole pixel (Elias, 4 Sep):
35.99 → 36, 27.99 → 28, 23.99 → 24, 15.99 → 16, 12.11 → 12, 5.99 → 6,
1.11 → 1, 0.11 → 0. Nothing in the kit is ever set to a fraction of a pixel.

- **Top bar**: full width, 60px (`--spacing-topbar` 44 + 8 + 8 = 60, unchanged
  arithmetic), `--chrome` fill, `--border` bottom rule. Left: the wordmark
  (moves out of the rail). Centre: "Welcome back{, name}!". Right: Invite
  members and New flow as `secondary` 32px buttons with 16px icons, the bell
  (32px circle `--avatar`, badge count), the avatar circle (initials, 13/600).
  The `#topbar-slot` / `#topbar-status` portals the flow builder uses stay.
  **The metrics-setup ring is REMOVED from the bar** — the Figma has none, and
  the dashboard's own setup checklist already shows the same progress. The
  ring's markup, `TopBar`'s `metricCount` prop and the whole pass-through chain
  behind it (`AppFrame`, `AppShell`, the dashboard page's `metricCount`
  computation) go with it, in one commit, because each link is unused the
  moment the one below it is.
- **Rail**: stays the hover rail (decision 3). At rest 56px of icons on
  `--chrome`. Expanded (260px), top to bottom: the workspace switcher row (28px
  `rounded-control` square tinted `rgb(0 123 255 / .75)` with the initial in
  white 13/**600** — `font-semibold`, the kit's own top weight; the Figma's 700
  here is one of the several the kit does not follow, and `.wordmark` stays the
  ONE exception above 600 — the name 15/600, a chevron), a search FIELD-styled
  control (`--control` fill, `--border`
  outline, magnifier, "Search", ⌘K) that opens the same palette, a "Main Menu"
  caps label in `--faint` 12px, nav rows 36px with 18px icons (active row
  `--control` fill), Dashboard's sub-items 32px indented with a 8px dash
  marker, and at the foot a full-width `primary` "New flow" and a "Get Free
  Access" row (bell icon with a blue dot, muted text). The wordmark leaves the
  rail. The collapse/pin cookie behaviour is unchanged.
- **Frame**: `AppFrame` renders the top bar ABOVE a row of [rail | panel]. The
  panel is `--panel` and rounds its **top-RIGHT** corner (8px,
  `rounded-tr-frame`) where it meets the bar's bottom edge; its top-LEFT corner,
  beside the rail, stays square. That is the export read literally — the rail
  and the panel butt together on the left with a hairline, and the only corner
  the Figma softens is the far one. `shell-skeleton.tsx` mirrors the new
  geometry; `tests/page-width.test.ts` is updated to pin it.
- **Page header** (`ui/page.tsx` PageHeader): tab strip left (active tab
  15/600 in `--heading` with a 1px `--muted-foreground` bottom rule and a "…"
  menu; inactive 15/500 muted; a 28px `secondary` "+" square), title centred
  26/600 with the pencil, actions right. The actions are the Figma's three, in
  this order (settled 5 Sep; the Mobile section uses the same order):
  - **"+ Add"** — the brand fill (`variant="accent"`, which is the kit's
    `--primary` fill; there is no variant literally named `primary`) at `xs`,
    with a 16px plus. Only the canvas board offers it; the groups board shows
    the other two.
  - a **"Today ▾" dropdown** — `secondary` `xs`, a 16px calendar icon, the
    selected preset's label, a chevron — replacing the dashboard's six-pill
    period track. It lists the SAME presets (`RANGE_OPTIONS`) as real links
    (`?range=` in the URL, so modifier-click and no-JS keep working); only the
    control's shape changes.
  - **"Refresh All"** — `secondary` `xs`, with a 16px refresh icon. Blue is
    spent on "+ Add" and "New flow" only.
  `xs` ships `[&_svg]:size-3.5`, so each of the three passes `[&_svg]:size-4`
  to reach the Figma's 16px glyph.

## Mobile (phones, below `md` = 768px) — added 5 Sep 2026 at Elias's request

Today the shell has no phone layout at all (no breakpoint in `app-frame`,
`sidebar` or `app-shell`; the rail expands on hover, which a touch screen
cannot do). The re-theme ships one.

- **Shell.** Below `md` the rail is not rendered. The top bar becomes: a 32px
  menu button (`--avatar` circle, hamburger glyph) then the wordmark on the
  left, the avatar circle on the right; the greeting is hidden below `sm`;
  Invite members and New flow leave the bar. The menu button opens a left
  **drawer** built on the kit's `ui/sheet.tsx` (`side="left"`, 280px wide,
  `--chrome` fill, `--border` edge) holding exactly the rail's expanded
  content: workspace switcher, search (opens ⌘K), "Main Menu", the nav with
  Dashboard's sub-items, and the foot (New flow, Get Free Access, plus Invite
  members). Any navigation closes the drawer. The drawer is the same
  component tree as the expanded rail, not a copy.
- **Content.** Below `md` the panel drops its rounded top-right corner (the
  page gutter is the same flat 24px at every width; there is no side inset
  to drop — amended 5 Sep); the page header stacks: the tab strip scrolls
  horizontally inside its own `overflow-x-auto` container at EVERY width
  (above `md` too, so a long view name can never push a page-level
  sideways scroll), the title sits on its own line left-aligned,
  the actions row wraps with 8px gaps ("+ Add" keeps its label; "Refresh
  All" and "Today" keep theirs at `xs`). Tiles render in ONE column at full
  width in placement order (the board grid's column count is 1 below `md`);
  charts fit their container width; tables scroll inside their own container.
  No horizontal page scroll at 390px wide on any authenticated route.
- **Touch.** Nav rows and drawer rows are at least 44px tall below `md`
  (`min-h-11`); buttons keep 32px with at least 8px between them; the
  freshness dot and delta chips are unchanged.
- **Verification.** The repo's tests have no DOM (no jsdom; ruling 4 in the
  ledger), so the phone rules are pinned as source pins plus
  `renderToStaticMarkup`: the rail's `md:` classes and the menu button's
  `md:hidden`; the drawer's close-on-navigation and close-at-`md` handlers;
  `BOARD_GRID`'s one-column base; the fixed-width scan with its allow-list.
  The manual pass is Elias on the Vercel preview on a phone, both themes.

## Tiles and charts

- Metric card: label 15/400 muted; freshness dot (`--freshness-dot` in the
  halo) + "1 hr ago" 13 muted; numeral 28/40 Inter 600 `--heading`; chart
  below with 13px muted axis labels; the per-column coloured edge strip
  (`--tile-edge`) is removed from the default board (the Figma has none) but
  the token stays for the canvas board.
- Chart series default: `--color-brand-500` (`#007BFF`); area fill
  `rgb(0 123 255 / .12)` — in code, `Sparkbars`' wash becomes `bg-brand-500/12`
  (up from the 5% it inherited), its border staying at 25%
  (`border-brand-500/25`); bars `#007BFF`. The comparison series (yesterday)
  is the brand's 300 step — **documentation only**: nothing in the product
  plots a second series today, so this line is written into BRAND_KIT §9 and
  nothing is wired for it in this pass. `GROUP_ACCENT` untouched.
- Delta chips ("+50% vs compared"): success/danger soft washes, 8px corners.

## Components (`src/components/ui`)

- `button.tsx`: base radius `rounded-control`; `secondary` uses
  `bg-secondary text-secondary-foreground` with a `--input` outline in the
  light theme; `accent`/`primary` fills use `--primary` with white ink; sizes
  unchanged (32px default).
- `card.tsx`: `--card` fill, `--border` edge, `--shadow-card`.
- `tabs.tsx` line variant: active rule uses `--heading`'s companion
  `--rule`; corners 8px.
- `avatar.tsx`: fallback and group-count fills both `--avatar`.
- `input.tsx`: textarea takes `rounded-control` (the comment/code mismatch is
  resolved toward 8px); stale "9999px" comments corrected.
- `page.tsx`: PERIOD track/pill 8px; PageHeader centred title.

## Docs and enforcement

- `docs/BRAND_KIT.md`: §1 principle 1 rewritten ("three darks, one hairline"),
  §2 ramps and state tables replaced with the values above and their
  measurements, §3 type (numeral 28, wordmark), §4 shape (8px, no pills — final,
  with the Figma named), §5 layout (top bar carries the wordmark; rail
  dressing), §6 components, §9 chart colours, §11 retired-token table gains
  the cyan ramp and `rounded-full`-on-buttons.
- Root `DESIGN.md`: frontmatter and §2/§5/§6 rewritten in lockstep; the
  self-contradictory `--canvas-bg` sentence in §10 fixed.
- `/design` page: swatch arrays and captions updated (`design-swatches` test
  pins them, so the arrays move with the tokens rather than in a later docs
  pass); the RADII/DIRECTION contradiction resolved; and the page's remaining
  pre-retheme prose rewritten in the same pass rather than ledgered — the
  `note=` strings and JSX comments still describing a charcoal `#2E2E2E` band
  around an `#F5F5F5` page, an `ink-*` ramp retired two re-themes ago, a
  yellow brand ("ONE GREEN, IN THREE SHAPES") and a pill-first radius set.
  The page whose job is to be the reference is the last place doc-rot may sit.
- `scripts/check-ui.ts` is **not edited by this pass**, and that is a finding
  rather than an omission. Its `retired token` rule matches deleted TOKEN
  NAMES, and no token name is retired here — `brand-*` keeps every one of its
  names and only changes value; the old cyan HEXES are already a build failure
  anywhere in `.tsx` under the generic `hex literal` rule. Its `font-bold` ban
  needs no `.wordmark` allowance either, because the 900 is set in the CSS
  class and `check-ui.ts` scans `.tsx` only. The radius set already keeps
  `full` (avatars, badges, dots). The cyan values are recorded in
  `docs/BRAND_KIT.md` §11's retired table instead, which is where a value that
  changed under a name that did not actually belongs.
- Tests updated to pin the new rules: `console-theme` (8px buttons, blue
  tokens), `page-width` (new frame geometry), `design-swatches`, `chrome-band`
  (unchanged values, re-verified).

## Deferred — ledgered here, deliberately NOT in this plan

Three pre-existing inconsistencies were found while writing this spec. Each is
a behaviour question rather than a colour one, so none is fixed under a
re-theme; they are written down so the next pass does not have to re-find them.

1. `TargetBar` (`charts.tsx`) draws an unmet goal in neutral grey while
   `GoalBar` (`board-charts/scorecard.tsx`) draws the same state in the brand,
   despite a comment claiming the two were reconciled.
2. `Sparkbars`' comment describes a "latest bucket" emphasis that its markup
   does not implement — every bar takes the same class regardless of position.
3. `board-column.tsx` still sets `--tile-edge` per lane after `MetricCard`
   stops reading it. That is intentional for the canvas board, but the token
   then has a setter and no reader on the default board, which is worth a
   deliberate decision rather than a comment.

## Rollout

One branch (`retheme-blue`), one PR to main after: `pnpm typecheck`, full
`vitest`, `pnpm build`, `check:orphans`, `check:ui`, and a screenshot sweep of
every authenticated route in both themes at 1440 and 1920 wide (Playwright is
not in the repo; the sweep is `pnpm dev` + manual capture by the final
reviewer, with the Figma beside it).

## Risks

- `text-muted-foreground` has 94 consumers and `bg-card` 46: the value changes
  are global by design; the sweep is the net.
- The one-surface thesis was the previous re-theme's central idea; reversing
  it is deliberate and documented here so nobody "restores" it.
- The button shape rule has flipped before; this spec names the Figma as the
  reference so the next flip needs a new design, not a comment.
- White ink on the fill sits at 4.68:1 — passes, but only at 600; anything
  lighter than `#0070E8` as a fill under white text fails.
