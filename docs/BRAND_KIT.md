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

**Eight sizes in-app, nothing between them** (plus `hero` for marketing only):
`micro` 11 · `tiny` 12 · `small` 13 · `base` 14 (default) · `lead` 15 ·
`title` 17 · `display` 24 · `stat` 36 · (`hero` 40, landing only).
Weights: 400, `font-medium`, `font-semibold`. Never `font-bold`.

**Canonical recipes** (the only spellings):
| Role | Recipe |
|---|---|
| Page title (h1) | `PageHeader` → `font-display text-display font-semibold text-foreground` |
| Section heading (h2) | `SectionHeading` → `text-micro font-semibold uppercase tracking-wide text-muted-foreground` |
| Card/modal title | `text-title font-semibold tracking-tight text-foreground` |
| List-item title | `text-base font-semibold text-foreground` (or `text-lead` for hero rows) |
| Body / secondary / caption | `text-base` / `text-base text-muted-foreground` / `text-tiny text-muted-foreground` |
| Headline number | `.stat-numeral text-stat` + `formatMetricValue` — display face + tabular figures, no other size, ever |
| Field label | `FieldLabel` (`mb-1.5 block text-base font-semibold text-foreground`) |

Stock Tailwind sizes (`text-xs`…`text-9xl`) are banned and will be removed
from the theme.

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
- `PageContainer` — `max-w-6xl`, gutter steps `px-4 → sm:px-6 → lg:px-8`;
  `width="narrow"` → `max-w-3xl` (forms, detail pages). Centered flows (auth,
  onboarding) use `max-w-md`. It renders the page's one `<main id="main">` —
  the skip link's target — so `AppFrame` renders a plain `<div>` unless a page
  brings no container (the builder, via `ownsMain`).
- Card padding: `p-5` default, `p-4` compact, `p-3` dense rows. Nothing else.
- Section rhythm: `mt-8` between page sections.
- Card grids: `gap-4 sm:grid-cols-2 xl:grid-cols-3` — one rhythm for the
  dashboard's tiles, the flows board and the connector catalogue. Let the cards
  stretch (no `items-start`) wherever they carry a footer, so the row's footers
  line up; a ragged row of footers is the difference between a board and a pile.

## 6. Components (`src/components/ui/`)

`Button` (8 variants × 5 sizes — every clickable), `Card` (card/surface ×
none/dense/compact/default), `Input`/`Textarea`/`NativeSelect`,
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

## 10. Voice & formatting

Sentence case everywhere (buttons, titles, labels). Plain-English status
labels ("Active", "Needs attention") — never raw enums. Sources and event
types are humanized via `catalogEntry`/`eventTypeLabel`. Dates:
`formatDate` ("Aug 21, 2026") / `formatTime` / `formatDateTime` — never bare
`toLocale*()`. Empty values are "—".

## 11. Enforcement

`pnpm check:ui` (`scripts/check-ui.ts`) gates nine rules: stock
type/radius/shadow classes, raw chromatic palette classes, `bg-neutral-900`
as a primary, hex literals outside the three sanctioned files, bare
`toLocale*()` outside `format.ts`, text glyphs used as icons, and raw
`<button>` outside the primitives and the builder's bespoke chrome. Each rule
carries a per-path allowlist with a stated reason — "it's fine" is how the
next drift gets waved through.

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
