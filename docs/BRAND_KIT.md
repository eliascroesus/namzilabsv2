# Namzilabs Brand Kit & UI Guide

The single source of truth for how Namzilabs looks and behaves. Tokens live in
`src/app/globals.css` (`@theme`), primitives in `src/components/ui/`, and the
living render of everything here is `/design`. If this document, the tokens,
and `/design` ever disagree, the tokens win and the other two are bugs.

Benchmarked against Linear, Stripe, Notion, Vercel, Miro and Zapier: one
neutral scale, one accent, a 14px UI base, hairline borders over heavy
shadows, and a state for everything — hover, focus, empty, loading, error.

**The thesis: quiet chrome, loud numbers.** This is a reconciliation product —
six tools disagree and the app's job is to answer in one figure you can defend.
So the number and the canvas carry all the presence, and everything around them
is furniture. Furniture that shouts is why most operational tools are
exhausting by 4pm.

---

## 1. Principles

1. **One accent.** Deep indigo does every job that means "this is the action /
   the selection / the focus." Everything else is neutral or a state color.
2. **Roles, not ramps.** Components say `bg-primary`, `border-border`,
   `text-muted-foreground` — never `bg-brand-600` or `border-neutral-300`.
   Roles are what make a future dark theme a one-file change.
3. **Hairlines carry structure; shadows whisper.** A 1px `border-border` does
   the separating. Shadows (≤ 8% alpha at rest) only say how far a surface
   floats.
4. **Every interactive element has all five states**: rest, hover, focus-visible,
   active, disabled. No exceptions — including icon buttons, tabs, and nav.
5. **Numbers are typeset.** Every metric wears `.tnum` and goes through
   `formatMetricValue`; every date goes through `formatDate`/`formatDateTime`.
   Users never see raw storage keys (`gsheets`) or raw enums (`error`).

## 2. Color

### Accent — ultramarine (`brand-*`)
| Step | Hex | Job |
|---|---|---|
| 50 | `#eef1fe` | selected-row wash, soft chips (`--accent`) |
| 100 | `#e0e5fd` | tint borders, hover wash on soft chips |
| 200–300 | `#c5cdfb` / `#9eaaf7` | decorative tints only |
| 400 | `#7183f1` | focus ring (`--ring`) |
| 500 | `#4a5ee8` | hover-on-dark |
| 600 | `#2b44d8` | **primary** — buttons, links, active nav (7.19:1 on white) |
| 700 | `#2135b3` | hover/pressed, `--accent-foreground` |
| 800 | `#1d2d8f` | active (pressed) on primary buttons |

The accent has to live in the blue–violet band, because green, amber and red
are spoken for by the state trios and an accent that collides with "this
failed" cannot also mean "press this". Within that band, indigo-500/600 is the
most-used accent in software right now and reads as a stock choice.
Ultramarine is a pigment colour rather than a UI colour — the right note for a
product whose claim is that its numbers are the defensible ones — and it
measures better: the same button clears AAA where indigo cleared AA.

### Neutrals — warm
The ramp is **warm** (hue ≈ 40°, very low saturation) and Tailwind's stock
`neutral-*` is redefined in place rather than sat beside, so the handful of raw
`neutral-*` classes sanctioned inside `ui/` warm up with everything else.

Reached through roles: `--background`/`--card` white, `--foreground`
neutral-900 `#211f1d`, `--muted` neutral-100, `--muted-foreground`
neutral-500 `#6b6660`, `--border`/`--input` neutral-200 `#e9e6e1`. Dark
surfaces use the `ink-*` ladder (rail = `ink-950` `#1b1a18`; toast = `ink-900`).

### The page is a canvas, and content floats on it
Every authenticated page scrolls on `--color-canvas-bg` `#f1efec` — the same
warm surface the builder's canvas uses — and **everything with content in it is
a white island**: a `Card`, a `TableShell`, or a bar wearing
`rounded-surface border border-border bg-card shadow-card`. Pages used to be
pure white with white cards on them, so a card was announced only by a
hairline; the builder next door read as objects floating over a surface, and
the same product was made of two materials. Nothing sits flat on the page
except a heading, a caption, or a filter's own label.

**Pure black is banned as a foreground.** `#000` on `#fff` is 21:1 — a
contrast no printed page has ever asked a reader to sustain. The warm 900 is
16.4:1, still past AAA, and leaves headroom at the top of the scale.
`--muted-foreground` also *rose* from 4.74:1 to 5.68:1 in the same move.

### State trios (never raw green/amber/red/blue classes)
| State | bg | text | strong | ink-on-soft |
|---|---|---|---|---|
| success | `bg-success-soft` | `text-success-ink` | `bg-success` | 5.44:1 |
| warn | `bg-warn-soft` | `text-warn-ink` | `bg-warn` | 5.18:1 |
| danger | `bg-danger-soft` | `text-danger-ink` | `bg-danger` | 5.49:1 |
| pending / transient | `bg-muted` | `text-muted-foreground` | — | 5.09:1 |

The inks are **solved, not picked**: each is the darkest step that still looks
like its hue, chosen so ink-on-its-own-soft lands in a 5.1–5.5:1 band. The tight
band is the point — a badge row where green measures 4.4 and red measures 6.1
reads as inconsistent weight even when nobody can say why. (The previous green
and amber sat at 4.38 and 4.41, i.e. under AA for the 11px semibold these are
actually set in.)

**Blue is dead.** Transient "testing/updating" states are `pending` (neutral).
Links are `text-primary hover:underline` — never `text-blue-600`.

### Sanctioned exceptions
Step-identity hexes (`node-accent.ts`), connector brand hexes
(`source-style.ts`), and canvas tokens are the only raw colors allowed, and
only in those files. `RANK_ACCENTS`-style copies are forbidden — import them.

## 3. Typography

**Two faces.** Inter variable (`cv01`, `ss03`, −0.008em body tracking) runs the
interface, where a typeface's job at 13–15px is to disappear. **Instrument
Sans** (`--font-display`, via `.font-display`) runs the three places that should
not: page titles, the landing hero, and the metric numeral. It never appears
below 17px. `--font-mono` (system mono) carries IDs, keys, URLs and code.

A product set entirely in Inter is the house style of every dashboard built
since 2019 — legible, and indistinguishable.

**Six sizes in-app, nothing between them** (plus three for marketing):
`xs` 12 · `sm` 14 (default) · `md` 16 · `lg` 18 · `xl` 20 · `display-xs` 24 ·
`display-sm` 30 · `display-md` 36 · (`display-lg` 48 and the fluid `banner`,
landing only). Weights: 400, `font-medium`, `font-semibold`. Never
`font-bold` — enforced, not merely asked for.

**ONE NAME PER SIZE, and this is the second attempt at that rule.** The kit
once spelled the scale `micro/tiny/small/base/lead/title/display/stat`, which
kept the set closed but meant no vendored shadcn or Untitled UI component could
render — `--text-*: initial` clears the stock names, so their `text-sm` resolved
to nothing. The scale was re-pitched onto Untitled UI's spelling with the eight
old names kept as ALIASES "while the app migrates surface by surface". The
migration stalled: for months the app ran **twelve names over nine sizes**, with
three-way ties at 12px (`xs`/`micro`/`tiny`) and 16px (`md`/`base`/`lead`), and
`check:ui` passed the entire time because every one of them was legal. A closed
set with two spellings per step is not closed. The aliases are deleted, all 326
call sites are converted, and the gate now names the replacement.

`base` moved a step DOWN on the way (16px → 14px). It had been re-pointed at
`md` in a "bigger scale" commit while `--text-sm` kept the comment calling it
the app's default body — so body copy rendered at 16px wherever a file said
`text-base` and 14px wherever it said `text-sm`. Fourteen is the size the
interface is built at.

**Canonical recipes** (the only spellings):
| Role | Recipe |
|---|---|
| Page title (h1) | `PageHeader` → `font-display text-display-sm font-semibold text-ground-ink` |
| Section heading (h2) | `SectionHeading` → `text-xs font-semibold uppercase tracking-wide text-muted-foreground` |
| Card/modal title | `text-lg font-semibold tracking-tight text-foreground` |
| List-item title | `text-sm font-semibold text-foreground` (or `text-md` for hero rows) |
| Body / secondary / caption | `text-sm` / `text-sm text-muted-foreground` / `text-xs text-muted-foreground` |
| Long-form reading prose | `text-md leading-relaxed` — legal pages and landing copy ONLY; the app's body is 14px |
| Headline number | `.stat-numeral text-display-md` + `formatMetricValue` — display face + tabular figures, no other size, ever |
| Field label | `FieldLabel` (`mb-1.5 block text-sm font-semibold text-foreground`) |

`text-2xl` and up are not in the theme and compile to nothing. The nine retired
aliases are a named `check:ui` failure rather than a silent no-op, because 326
sites moved at once and a missed one would otherwise render at its inherited
size on a page nobody reopened.

## 4. Shape & elevation

**Radii — four tokens + full:** `rounded-control` 8px (buttons, inputs, menu
rows) · `rounded-card` 12px (sections, list rows, the rail's 40px tiles) ·
`rounded-surface` 16px (panels, modals, tables, step cards, dashboard tiles,
flow cards) · `rounded-frame` 32px (the app's own left edge — see below) ·
`rounded-full` (pills, avatars, switches). Stock `rounded`/`-md`/`-lg`/`-xl`
and arbitrary radii are banned.

**The frame is every page's, not the builder's.** `AppFrame` cuts
`rounded-l-frame` out of the scroll region's left corners on every
authenticated route and lets the rail's wash show through the notch; right, top
and bottom stay flush to the viewport. It was the builder's alone once, which
meant the shape of the application changed as you navigated — the kind of
inconsistency nobody reports and everybody feels.

**Shadows:** surfaces with a border use the ring-free ladder —
`shadow-card` (rest) · `shadow-card-hover` (hover/drag) · `shadow-surface`
(floating over canvas) · `shadow-panel` (modals). The ringed twins exist only
for borderless surfaces. `shadow-sm` and friends are banned.

## 5. Layout & spacing

4px grid. Page shape comes from primitives, not hand-set containers:
- `PageContainer` — **`max-w-6xl`** (1152px, three tile columns and their gaps),
  gutter steps `px-4 → sm:px-6 → lg:px-8`; `width="narrow"` → `max-w-3xl`
  (768px — forms, detail pages). Centered flows (auth, onboarding) use
  `max-w-md`. It renders the page's one `<main id="main">` — the skip link's
  target — so `AppFrame` renders a plain `<div>` unless a page brings no
  container (the builder, via `ownsMain`).

  **The page has a width and it does not chase the window.** An uncapped
  `default` was tried and reverted the same day: boards ran edge to edge and
  gained columns as the viewport grew, which means no stable picture of your own
  dashboard, tiles that change size depending on which monitor you opened it on,
  and a grid re-laying out across 2560px on every frame of an unrelated drag.
  Notion is the reference — a fixed content measure with real margin either
  side, where a bigger screen changes how much you SEE and never how big
  anything is. Consistency is the feature; do not re-litigate it without one.
- Card padding: `p-5` default, `p-4` compact, `p-3` dense rows. Nothing else.
- Section rhythm: `mt-8` between page sections.
- Card grids: import **`BOARD_GRID`** from `ui/page` — never spell the classes.
  It is `grid gap-4 sm:grid-cols-2 xl:grid-cols-3`, one rhythm for the
  dashboard's tiles, the flows board, the connector catalogue **and the two
  skeletons that stand in front of them**. A skeleton whose grid disagrees with
  its page is a jump on arrival, which is the one thing a skeleton exists to
  prevent. Three is the ceiling because four inside 1152px is 270px a tile —
  narrower than the numeral each one is built around. Let the cards stretch (no
  `items-start`) wherever they carry a footer, so the row's footers line up; a
  ragged row of footers is the difference between a board and a pile.

**Constants shared across the server/client boundary live in a module with no
directive.** A `"use client"` file's exports are not values on the server: the
flight loader swaps each one for a client reference, and interpolating that into
a `className` does not throw — it stringifies a function into the attribute.
`day-cell.ts` (`DAY_CELL_H`) and `flow/panel-chrome.tsx` (`PANEL_SHELL`) are
both shaped this way, each for a server component that has to read the string.

## 6. Components (`src/components/ui/`)

`Button` (12 variants × 6 sizes — every clickable; `xs` is the dense row's
geometry, for a tile footline where `sm` would crowd out the timestamp),
`Card` (card/surface/**tile** × none/dense/compact/default),
`MetricCard` (`src/components/metric-card.tsx` — the board's one tile shell),
`Input`/`Textarea`/`NativeSelect`,
`FieldLabel`/`FieldHint`/`FieldError`, `StatusPill` (5 tones, optional dot) /
`Badge`, `Switch` (2 sizes), `Chip` (filter pill + count), `Modal`/`ModalTitle`
(one scrim: `bg-neutral-950/40 backdrop-blur-sm`; focus-trapped, scroll-locked), `TableShell`/`Table`/`THead`/
`TH`/`TBody`/`TR`/`TD`, `Toast` (dark, bottom-center, optional action),
`EmptyState`, `Skeleton`, `PageContainer`/`PageHeader`/`SectionHeading`,
`LegalPage`/`LegalSection`/`LegalLink`/`LegalList` (privacy + terms).

Hand-rolling any of these is a defect. Links dressed as buttons use
`buttonVariants()` — never a re-typed class string.

## 7. Interaction

- **Focus is declared once, in `globals.css`.** A zero-specificity
  `:where(a, button, summary, [role="button"], [role="switch"], [tabindex])
  :focus-visible` outline covers every control in the product. Components must
  **not** re-spell a ring and must **not** set `outline-none` — that switches
  the shared rule off. There were 122 hand-written copies of this one idea
  before it was centralised, at four different alphas, with four controls
  carrying no focus state at all. Dark surfaces add `.focus-ring-light`.
  Text fields are the one exception, and keep border-plus-halo (`ui/input.tsx`):
  a field is a place you are *in*, not a thing you pressed.
- **A filter answers on the press, not on the response.** Anything that
  re-renders the page from the URL (the dashboard's range and source) goes
  through `board-controls.tsx`: the pressed control goes active immediately,
  the content it governs swaps to **content-shaped skeletons**, and the URL
  still updates inside a `useTransition` so back and shared links keep working.
  Controls stay real `<a href>`s — middle-click and the pre-hydration paint
  depend on it. Never dim the old numbers instead: a legible figure under a
  pill that now says something else is a wrong answer shown confidently.
- **Nothing here is a login, and the browser must be told four times.** Fields
  default to `autocomplete="off"` and `spellcheck="false"` (`ui/input.tsx`) —
  almost every field in this app asks for something no browser has stored. A
  **masked** field goes further, automatically: `autocomplete="new-password"`
  plus `NO_AUTOFILL`, one opt-out attribute per manager (LastPass, 1Password,
  Bitwarden, Dashlane). `autocomplete="off"` is the one value browsers
  deliberately ignore on a `type="password"` field, so passing it there is a
  no-op that *looks* like a fix — never re-pass it at a call site. Any text
  field sitting directly above a masked one spreads `NO_AUTOFILL` too: that
  shape reads as "username, password" and gets filled with someone's email.
- **Skeletons hold the real shape.** `Skeleton` is `neutral-200` (it has to
  read on the warm canvas *and* on a white card) and is sized at the call site
  to the thing it stands in for — a route's `loading.tsx` should be its page's
  own layout in grey, not three bars. A skeleton that doesn't match its content
  moves the jank later instead of removing it.
- **Hover:** neutral hovers are `hover:bg-muted` (rows `hover:bg-muted/40`);
  primary walks **down** the ramp — `hover:bg-brand-700`, `active:bg-brand-800`.
  Never `hover:brightness-110` on the accent: it lightens toward the background,
  so the label's contrast *falls* at the one moment it is under a pointer.
- **Disabled:** `disabled:pointer-events-none disabled:opacity-50`, only.
- **Motion tokens, not one-offs:** durations `--duration-fast|base|slow`
  (120/180/280ms) and curves `--ease-standard|spring|exit`. `spring` is only
  for things that appear or that the user just did; `exit` is faster than entry
  on purpose, because a slow dismissal reads as lag. Plus the global 0.5px press
  dip, `flow-pop-in/out` for floating surfaces, `.rise-in` for page entrances,
  `.lift` for interactive cards. A global `prefers-reduced-motion: reduce` rule
  zeroes **all** animation, including React Flow's own.
- **Dialogs trap focus.** `Modal` moves focus in on open, wraps Tab at both
  ends, locks body scroll, and returns focus to the opener on close — which is
  what makes its `aria-modal="true"` true rather than a claim.
- **Destructive ceremony:** two tiers — inline confirm (`destructiveOutline` +
  `destructive` pair) for reversible-ish acts; `Modal` with typed confirmation
  for permanent ones. Nothing destructive fires on first click.

## 8. Iconography

lucide-react only. Sizes: **14** inline/dense · **16** default · **18**
toolbar · **24** rail. `strokeWidth` 2 (2.25 only at ≤14px). Text glyphs
(`✕ ▾ ✓ › ★ ⚠ ⚙ →`) are banned — `X`, `ChevronDown`, `Check`,
`ChevronRight`, `Star`, `AlertTriangle`, `Settings`, `ArrowRight`.

## 9. Data visualization

Marks are `brand-600` (ultramarine); target-met `success`; bottleneck `danger`; tracks
`bg-muted`. Bars never `bg-neutral-800`. Headline numbers per §3. One
`Sparkbars`/`TargetBar`/`GroupBars`/`Delta` implementation in
`src/components/charts.tsx`, shared by every tile.

**A number alone is half a fact.** Where a comparison exists, tiles show a
`Delta` beside the value — but only a real one: "Today" reads against the
stored "Yesterday", and a bucketed series reads its newest *complete* bucket
against the one before. Every other range has no stored predecessor, so it
shows nothing. A fabricated comparison is worse than no comparison.

**Deltas are never green or red.** Up is good for Booked Leads and bad for
Speed to Lead, and nothing stored on a tile says which — so a coloured delta
would confidently report a regression as a win. It states direction and size
and leaves the judgement to the reader. Percentages move in *points*
(20% → 22% is "+2 pts", not "+10%").

**Status is quiet when fine.** A healthy tile carries a 6px `success` dot;
only a tile that needs something wears a full `StatusPill`. A board where every
card shows a green badge is furniture reporting no news, and it buries the one
card that matters.

**One card, and it wears its column on its leading edge.** Every tile on the
groups board — a materialized flow Output and a legacy `metrics` row alike —
renders through `MetricCard`. It had been three components that drifted into
three different cards in one grid, one of them carrying a comment claiming it
was "kept in step with FlowTile's shape on purpose" while disagreeing on the
shell, the padding, the title recipe and the footer. The reader cannot tell
which table a number came from, and should not be able to.

The card is one block of padding with a 4px leading edge in its group's colour,
borrowed from the builder's step card. The colour arrives as `--tile-edge`, set
by the lane in `board-column.tsx` and read by inheritance — so a tile dragged to
another column changes allegiance on the frame it lands, with nothing threaded
through a server-rendered node, and the ungrouped row falls back to `--border`
rather than claiming a group. Content takes the slack (`flex-1 justify-center`,
so a bare scalar centres instead of hanging off the top of a stretched card) and
the footline is welded to the bottom, because a ragged row of footers is §5's
difference between a board and a pile.

**The tile is a LIGHT ISLAND in the dark theme.** `Card variant="tile"` carries
`tile-surface`, which re-points the whole role block at its light values for
that subtree. Turning the card white and stopping was a real bug: every muted
label inside it measured **2.52:1** on the white it now sat on, because
`--muted-foreground` under `.dark` is a grey solved for a near-black background.
Both themes now measure identically — 5.33:1 for the name, 4.97:1 for the
timestamp, 17.4:1 for the numeral.

**Heat is magnitude, never judgement.** The calendar tints each day by its
share of the month's largest day, in the one accent — `color-mix(in srgb,
var(--color-brand-600) 8–38%, white)`, which keeps the numeral past 9:1 at
every step of the ramp. Green-good/red-bad is the same mistake a coloured
delta would be. A **negative** value is the single exception and takes the
danger tint: below zero is a fact about the number, not an opinion about it.
Days with nothing are recessed (`bg-muted/50`), not white — inside a white card
an empty white square is the same material as the sheet, so the days that have
something must be the figure and the rest the ground.

## 10. Voice & formatting

Sentence case everywhere (buttons, titles, labels). Plain-English status
labels ("Active", "Needs attention") — never raw enums. Sources and event
types are humanized via `catalogEntry`/`eventTypeLabel`. Dates:
`formatDate` ("Aug 21, 2026") / `formatTime` / `formatDateTime` — never bare
`toLocale*()`. Empty values are "—".

## 11. Enforcement

`pnpm check:ui` (`scripts/check-ui.ts`) gates eleven rules: stock
type/radius/shadow classes, the nine retired type aliases, `font-bold`, raw
chromatic palette classes, `bg-neutral-900` as a primary, hex literals outside
the three sanctioned files, bare `toLocale*()` outside `format.ts`, text glyphs
used as icons, and raw `<button>` outside the primitives and the builder's
bespoke chrome. Each rule carries a per-path allowlist with a stated reason —
"it's fine" is how the next drift gets waved through.

The last two rules are there because the gate was PASSING while the drift it
exists to stop was in the tree: two legal spellings of 12px, and a fourth font
weight in the newest file in the product. A rule that only bans what nobody was
doing reports health it has not checked.

**The landing and legal exemptions are gone.** `/`, `/privacy` and `/terms`
were carved out as "out of scope this pass"; they now render through the kit
and the primitives like everything else, so the allowlists that covered them
have been deleted rather than left lying around for the next thing to hide
under.

`tests/design-swatches.test.ts` closes the last gap between the three sources
of truth: `/design` prints hex captions beside token-rendered swatches, and
that test fails if any caption disagrees with `globals.css`. It exists because
the re-theme moved fifteen values and, for one render, the kit page showed
ultramarine tiles labelled with the old indigo hexes — correct swatches,
confidently wrong documentation, and nothing anywhere to catch it.

Belt and braces: the stock namespaces are also **cleared** from the theme
(`--text-*`, `--radius-*`, `--shadow-*` set to `initial` in `globals.css`), so
a banned size, radius or shadow does not merely fail review — it compiles to
nothing and is visible on the page.
