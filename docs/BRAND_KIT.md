# Namzilabs Brand Kit & UI Guide

The single source of truth for how Namzilabs looks and behaves. Tokens live in
`src/app/globals.css` (`@theme`), primitives in `src/components/ui/`, and the
living render of everything here is `/design`. If this document, the tokens,
and `/design` ever disagree, the tokens win and the other two are bugs.

Benchmarked against Linear, Stripe, Notion, Vercel, Miro and Zapier: one
neutral scale, one brand and one marker split by SHAPE rather than by meaning, a
14px UI base, hairline borders over heavy shadows, and a state for everything —
hover, focus, empty, loading, error.

**The thesis: quiet chrome, loud numbers.** This is a reconciliation product —
six tools disagree and the app's job is to answer in one figure you can defend.
So the number and the canvas carry all the presence, and everything around them
is furniture. Furniture that shouts is why most operational tools are
exhausting by 4pm.

---

## 1. Principles

1. **Yellow fills. Violet draws.** `#EECF00` is **1.55:1** as a stroke or as
   text on white and **11.24:1** as a fill under `#1A1A1A` ink, so the brand is
   every FILLED object and the marker's violet is every line and coloured
   glyph. This is a measurement, not a preference, and `check:ui` enforces it
   (§11, `yellow-as-stroke`). Everything else is neutral or a state color.
2. **Roles, not ramps.** Components say `bg-primary`, `border-marker`,
   `text-muted-foreground` — never `bg-brand-600` or `border-neutral-300`.
   Roles are what make a theme swap a one-file change.
3. **Hairlines carry structure; shadows whisper.** A 1px `border-border` does
   the separating. Shadows (≤ 8% alpha at rest) only say how far a surface
   floats.
4. **Every interactive element has all five states**: rest, hover, focus-visible,
   active, disabled. No exceptions — including icon buttons, tabs, and nav.
5. **Numbers are typeset.** Every metric wears `.tnum` and goes through
   `formatMetricValue`; every date goes through `formatDate`/`formatDateTime`.
   Users never see raw storage keys (`gsheets`) or raw enums (`error`).

## 2. Color

### The one rule: yellow fills, violet draws

| `#EECF00` | on `#FFFFFF` | on the `#F5F5F5` ground | on the `#2E2E2E` band |
|---|---|---|---|
| as a **stroke or text** | **1.55:1** | **1.42:1** | 8.77:1 |
| as a **fill**, ink `#1A1A1A` | **11.24:1** | — | — |

`--primary` was doing two incompatible jobs — 36 sites filled with it, ~23
stroked or inked with it — which a mid-tone violet could survive and a yellow
cannot. So the two jobs are two tokens:

| Role | Value | Job |
|---|---|---|
| `--primary` | `brand-600` `#eecf00` | every FILLED object: buttons, the active rail chip, badges, step markers, the active period pill, the empty card's cap |
| `--primary-foreground` | `#1a1a1a` | the ink ON that fill — a CONSTANT, not `--foreground`: the yellow does not invert and neither may what is written on it |
| `--marker` | `marker-500` `#7c4dff` | every LINE and every coloured GLYPH: focus ring, hover borders, selection rings, the today edge, the tab rule |
| `--marker-ink` | `marker-700` `#6229f0` | link text — 6.79:1, where `marker-500`'s 4.41:1 is short of AA for body copy |

Utilities: `bg-primary` + `text-primary-foreground` for a fill; `border-marker`,
`ring-marker`, `stroke-marker`, `fill-marker`, `text-marker`, `text-marker-ink`
for everything that draws. **`text-primary`, `border-primary`, `ring-primary`,
`stroke-primary`, `fill-primary`, `divide-primary` and `outline-primary` are a
build failure** — see §11. The single exemption is the top bar's progress arc,
which strokes yellow on the charcoal band at 8.77:1.

`--accent` / `--accent-foreground` are the MARKER's tint pair (`marker-50` /
`marker-700`), not the brand's: a selected row is a wash behind ink and a link
is text, and a yellow wash under yellow ink is the one combination the split
forbids. `--ring` is `marker-400` for the same reason — a yellow focus ring
measures 1.55:1 on white, which is the single most important indicator in the
product, invisible.

### Brand — yellow (`brand-*`), what FILLS
| Step | Hex | Job |
|---|---|---|
| 50 | `#fefae6` | wash for a tinted surface that is not a control |
| 100 | `#fdf3bf` | the heavier wash |
| 200–300 | `#fae98a` / `#f7de4d` | decorative tints only |
| 400 | `#f2d519` | — |
| 500 | `#f5d91f` | hover-on-dark |
| 600 | `#eecf00` | **primary** — 11.24:1 under `#1a1a1a` ink, 8.77:1 on the band |
| 700 | `#d4b800` | hover/pressed |
| 800 | `#b89f00` | active (pressed) on primary buttons |

Hover walks **down** the ramp and never brightens: brightening a yellow moves it
toward the white behind it, so the label's contrast *falls* at the moment of the
press.

### Marker — violet (`marker-*`), what DRAWS
| Step | Hex | Job |
|---|---|---|
| 50 | `#f3eeff` | selected-row wash, soft chips (`--accent`) |
| 100 | `#e7dcff` | tint borders, hover wash on soft chips |
| 200–300 | `#d0bcff` / `#b494ff` | decorative tints; 300 is `--marker-ink` in dark |
| 400 | `#9670ff` | focus ring (`--ring`) |
| 500 | `#7c4dff` | the mark itself — 4.41:1 on the ground, past the 3:1 a non-text mark owes |
| 600 | `#6d3aff` | — |
| 700 | `#6229f0` | link ink (`--marker-ink`, `--accent-foreground`) — 6.79:1 |
| 800 | `#5318d1` | — |

**These are the exact values `brand-*` used to hold.** Only the name and the job
changed. A ramp called `brand` that is not the brand colour is a lie a future
edit is entitled to believe, which is why the rename was not optional.

### Neutrals — Untitled UI grey
The ramp is **cool** (a faint blue cast at very low saturation) and Tailwind's
stock `neutral-*` is redefined in place rather than sat beside, so the handful of
raw `neutral-*` classes sanctioned inside `ui/` move with everything else. It was
warm (~40°) for a while on the argument that a cool grey app makes every warm
thing in it look foreign; true, and it cost more than it bought — warm greys read
as parchment beside the products this one is measured against.

Reached through roles: `--background` `#f5f5f5`, `--card`/`--popover` white,
`--foreground` neutral-900 `#1a1a1a`, `--muted` neutral-100 `#f5f5f5`,
`--muted-foreground` neutral-500 `#6b6b6b`.

**One hairline: `--border` = `--input` = `#d3d3d3`.** The export drew two —
`#cfcfcf` around the card and `#d3d3d3` around every button and chip — four
counts apart, indistinguishable on any screen and guaranteed to drift the first
time one of them was edited alone. They collapse to the one the export uses most.
It is materially harder than the `#e8e8e8` that was here (1.50:1 on white against
1.21:1), so dividers and table rules harden with it; `--color-neutral-200`
deliberately stays `#e8e8e8` so the press states built on it do not darken along
with the edges.

### Ink — the band, and every dark surface
**The ladder runs UPWARDS, and that is the whole story of this block.** The band
moved `#0f0f0f → #2e2e2e`, and every step above it had been cut to go *down*
from the old value: `ink-900` was `#1a1a1a` and `ink-800` `#2b2b2b`, both DARKER
than the new base. Left alone, every rail hover and active row would have receded
into the band instead of rising out of it — not a slightly-wrong colour, but
elevation pointing the wrong way. **On a charcoal band, raised means lighter.**

| Token | Hex | Job | on the band |
|---|---|---|---|
| `ink-950` | `#2e2e2e` | THE BAND — rail + top bar, both themes | — |
| `ink-900` | `#3a3a3a` | rail hover | 1.31:1 |
| `ink-800` | `#434343` | rail raised (active row), the toast | 1.45:1 |
| `ink-700` | `#5e5e5e` | hairline on dark | 2.10:1 |
| `ink-400` | `#a1a1a1` | muted text on dark | 5.26:1 |
| `ink-100` | `#e8e8e8` | body text on dark | — |
| `ink-50` | `#fafafa` | headings on dark | — |

### The chrome band's own roles (`--chrome-*`)
Nine roles, declared only in `:root` and deliberately **absent from `.dark`** —
this band is the one part of the app that does not invert, so a `.dark` twin
would be nine values to keep in step for no visible change.

| Role | Value | What it is |
|---|---|---|
| `--chrome-line` | `#5e5e5e` | the hairline *inside* the band — the ⌘K keycap, chip outlines on dark. The band's outer seams are gone; see §4 |
| `--chrome-chip` | `#ffffff` | the 36px chip under the bell, the avatar and the rail's `+`. It INVERTED: a solid `#d3d3d3` disc became a white surface with an edge, 15.4:1 on the band |
| `--chrome-chip-line` | `#d3d3d3` | their hairline, as a CONSTANT — `--border` under the bar's scoped `dark` class answers `#3d3d3d`, a near-invisible edge on a white chip |
| `--chrome-badge` | `brand-600` | the unread count: a fill carrying dark ink, the only shape yellow may take. It was blue `#3859ff` |
| `--chrome-badge-ink` | `#1a1a1a` | 11.24:1 on that badge |
| `--chrome-presence` | `brand-600` | the rail bell's 8px dot. It lost its green — a notification is not a health report |
| `--chrome-avatar` | `marker-500` | the workspace avatar, and the ONE place violet is a fill rather than a line: identity is a fact about your account, not a control competing for a press |
| `--chrome-add-ink` | `#575757` | the `+` in the rail's foot, now ordinary ink on a white chip (7.23:1) |
| `--chrome-ring-track` | `#4a4a4a` | the metrics ring's track; its ARC is `--primary`, the one sanctioned yellow stroke |

### The ground, and content floating on it
Every authenticated page scrolls on `--ground` (`#f5f5f5` light, `#1b191a` dark)
and **everything with content in it is an island**: a `Card`, a `TableShell`, or
a bar wearing `rounded-surface border border-border bg-card shadow-card`. Pages
used to be pure white with white cards on them, so a card was announced only by a
hairline; the builder next door read as objects floating over a surface, and the
same product was made of two materials. Nothing sits flat on the page except a
heading, a caption, or a filter's own label.

`--ground` is the only thing in the chrome redesign that switches, and it has to:
a light theme whose only light surfaces are the cards is not a light theme.
`--ground-ink` and `--ground-ink-muted` come with it. `--tab-underline` is
`marker-500`: it was green `#00d492`, which measured **1.78:1** on the light
ground — under the 3:1 an indicator carrying state owes — and the split repaired
it as a side effect, because an underline is a stroke.

**Pure black is banned as a foreground.** `#000` on `#fff` is 21:1 — a
contrast no printed page has ever asked a reader to sustain. neutral-900 is
16.43:1, still past AAA, and leaves headroom at the top of the scale.
`--muted-foreground` is 5.68:1.

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
Links are `text-marker-ink hover:underline` — never `text-blue-600`, and never
`text-primary`, which is the same link at 1.55:1.

### The decorative accents — three, and there used to be four
`--color-accent-orange` `#ff6b35`, `--color-accent-pink` `#ffa5a5`,
`--color-accent-peri` `#9b9be8`. They say WHICH, never HOW IT IS GOING — the
state trios own meaning, so a decorative chip can never read as a warning.

**`--color-accent-yellow` is DELETED.** It was `#faf63c`, a highlighter neon
that sat here as one decorative colour among four while `--primary` was violet.
Now that yellow *is* the brand, a second yellow four counts off it under a second
name is a pair nobody could keep in step and nobody could tell apart on screen.
Anything wanting the brand asks for `bg-primary` with `text-primary-foreground`.
`check:ui` fails on the class (§11, `retired accent-yellow`) rather than letting
it compile to no background at all.

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

**Radii — four kit tokens + full:** `rounded-control` 8px (buttons, inputs, menu
rows, rail chips) · `rounded-card` 10px (sections, list rows) ·
`rounded-surface` 16px (panels, modals, tables, step cards, dashboard tiles,
flow cards) · `rounded-frame` **16px** (the app's own corner — see below) ·
`rounded-full` (pills, avatars, switches). Untitled UI's `xs/sm/md/lg/xl/2xl/3xl/
4xl` ladder compiles beneath them so a vendored component arrives looking like
itself; bare `rounded` and arbitrary radii not derived from a token are banned.

**The frame is every page's, not the builder's, and it is ONE corner.**
`AppFrame` cuts `rounded-tl-frame` out of the ground on every authenticated
route — top-left only, because that is the single corner where the page meets
both halves of the band at once, the rail to its left and the top bar above it.
The other three run to the viewport; rounding them would float the page inside
the window like a card, which it is not.

`--radius-frame` is **back from zero**: it was 32px while the frame painted a
gradient behind a transparent rail, then 0 when the navigation briefly became a
white column and there was no wash left to cut into. There is again — the band is
charcoal — and 16px is what the export draws. A radius reveals whatever is
BEHIND it, so the column holding the top bar and the page is painted `bg-ink-950`
on purpose: at `#f5f5f5` behind `#f5f5f5` the notch was perfectly invisible.

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

`Button` (**11** variants × 6 sizes — every clickable; `xs` is the dense row's
geometry, for a tile footline where `sm` would crowd out the timestamp; the
`yellow` variant is **deleted**, because it and `accent` were two names for the
loudest button on the screen and yellow *is* the primary now — a call site
choosing between them by feel is the exact drift `cva` exists to prevent),
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
  read on the `#f5f5f5` ground *and* on a white card) and is sized at the call site
  to the thing it stands in for — a route's `loading.tsx` should be its page's
  own layout in grey, not three bars. A skeleton that doesn't match its content
  moves the jank later instead of removing it.
- **Hover:** neutral hovers are `hover:bg-muted` (rows `hover:bg-muted/40`);
  primary walks **down** the ramp — `hover:bg-brand-700`, `active:bg-brand-800`.
  Never `hover:brightness-110` (or `-95`) on the brand: it lightens toward the
  white behind it, so the label's contrast *falls* at the one moment it is under
  a pointer. On a yellow that is not a preference, it is the whole margin.
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

**Marks are the MARKER** (`bg-marker`); target-met `success`; bottleneck
`danger`; tracks `bg-muted`. Bars never `bg-neutral-800`. Headline numbers per
§3. One `Sparkbars`/`TargetBar`/`GroupBars`/`Delta` implementation in
`src/components/charts.tsx`, shared by every tile.

A bar is not a filled object in §2's sense — it is a **shape read by its edge
against the card it sits on**, with no ink of its own to carry the contrast, and
there yellow manages 1.55:1 against the marker's 4.41:1. So the series is violet.
The one place the brand appears on a tile is the 5% wash *behind* the sparkbars,
which is a surface rather than a graphic; its baseline rule is `border-marker/25`,
because a 25% yellow line on a white card measures about 1.1:1 and is not there.

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

**The tile FOLLOWS the theme, and the light island it used to be is gone.** It
was pinned white in dark by `dark:bg-white`, which changed the surface and not
the ink, so every muted label on it measured **2.52:1** against 4.5 required —
`--muted-foreground` under `.dark` is a grey solved for a near-black background.
That was patched with a `tile-surface` class that re-pointed the whole role block
at its light values for one subtree. The patch is deleted along with the pin: a
dark card carries the ink the dark theme already solved for it, and the problem
stops existing instead of needing a second declaration of every role.

**Heat is magnitude, never judgement.** The calendar tints each day by its
share of the month's largest day, in the marker — `color-mix(in srgb,
var(--color-marker-500) 12–56%, var(--card))`, which keeps the numeral past
7.5:1 at every step of the ramp. It is the marker rather than the brand for the
same reason the bars are: a tint under a numeral is a SURFACE, the shape
`--accent` already takes behind a selected row, and a wash of dark yellow is what
`--color-brand-600` would draw here now. Green-good/red-bad is the same mistake a
coloured delta would be. A **negative** value is the single exception and takes
`accent-orange`: below zero is a fact about the number, not an opinion about it.
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

`pnpm check:ui` (`scripts/check-ui.ts`) gates **thirteen** rules: stock
type/radius/shadow classes, the nine retired type aliases, `font-bold`, raw
chromatic palette classes, `bg-neutral-900` as a primary, **`yellow-as-stroke`**,
**`retired accent-yellow`**, hex literals outside the five sanctioned paths, bare
`toLocale*()` outside `format.ts`, text glyphs used as icons, and raw `<button>`
outside the primitives and the builder's bespoke chrome. Each rule carries a
per-path allowlist with a stated reason — "it's fine" is how the next drift gets
waved through.

**`yellow-as-stroke` is what makes §2 a rule rather than an aspiration.** It
fails on `text-primary`, `border-primary`, `ring-primary`, `stroke-primary`,
`fill-primary`, `divide-primary` and `outline-primary`, including `hover:` /
`focus:` / `group-hover:` variants and `/NN` opacity suffixes; `bg-primary` and
`text-primary-foreground` pass, because they are the shape the token is for. The
failure it catches is invisible by construction: those classes point at a live
token, so they COMPILE, the build passes, and the link renders at 1.55:1 on
white. One allowlist entry — `top-bar.tsx`, for the metrics ring's arc, which is
drawn on the `#2e2e2e` band where the brand strokes at 8.77:1. This is also the
rule that replaced an unenforceable one: "yellow is the hero at most once per
screen" could not be checked by anything, so it was enforced by whoever happened
to be reviewing.

`retired accent-yellow` bans the deleted `--color-accent-yellow` for the reason
the retired type aliases got a rule of their own: an unresolved COLOUR utility
does not look broken. `bg-accent-yellow` renders as no background at all, so a
chip that should be the loudest object in its row reads as a plain label —
legible, plausible, and wrong.

Three of these rules exist because the gate was PASSING while the drift it exists
to stop was in the tree: two legal spellings of 12px, a fourth font weight in the
newest file in the product, and a `--primary` doing two jobs that only one hue
could survive. A rule that only bans what nobody was doing reports health it has
not checked.

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
confidently wrong documentation, and nothing anywhere to catch it. It covers
both ramps, which matters most for the rebrand: `brand-*` and `marker-*` swapped
hues under stable names, so a caption left behind is a page insisting the brand
is still violet while rendering it yellow.

Belt and braces: the stock namespaces are also **cleared** from the theme
(`--text-*`, `--radius-*`, `--shadow-*` set to `initial` in `globals.css`), so
a banned size, radius or shadow does not merely fail review — it compiles to
nothing and is visible on the page.
