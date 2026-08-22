# Namzilabs Brand Kit & UI Guide

The single source of truth for how Namzilabs looks and behaves. Tokens live in
`src/app/globals.css` (`@theme`), primitives in `src/components/ui/`, and the
living render of everything here is `/design`. If this document, the tokens,
and `/design` ever disagree, the tokens win and the other two are bugs.

Benchmarked against Linear, Stripe, Notion, Vercel, Miro and Zapier: one
neutral scale, one accent, Inter at a 14px UI base, hairline borders over heavy
shadows, and a state for everything — hover, focus, empty, loading, error.

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

### Accent — indigo (`brand-*`)
| Step | Hex | Job |
|---|---|---|
| 50 | `#eef2ff` | selected-row wash, soft chips (`--accent`) |
| 100 | `#e0e7ff` | tint borders, hover wash on soft chips |
| 200–300 | `#c7d2fe` / `#a5b4fc` | decorative tints only |
| 400 | `#818cf8` | focus ring (`--ring`) |
| 500 | `#6366f1` | hover-on-dark |
| 600 | `#4f46e5` | **primary** — buttons, links, active nav (6.3:1 on white) |
| 700 | `#4338ca` | pressed, `--accent-foreground` |

### Neutrals
Cool `neutral-*`, reached only through roles: `--background`/`--card` white,
`--foreground` black, `--muted` neutral-100, `--muted-foreground` neutral-500,
`--border`/`--input` `#e5e4ed`. Dark surfaces use the `ink-*` ladder
(rail = `ink-950` `#23262d`; toast = `ink-900`).

### State trios (never raw green/amber/red/blue classes)
| State | bg | text | strong |
|---|---|---|---|
| success | `bg-success-soft` | `text-success-ink` | `bg-success` |
| warn | `bg-warn-soft` | `text-warn-ink` | `bg-warn` |
| danger | `bg-danger-soft` | `text-danger-ink` | `bg-danger` |
| pending / transient | `bg-muted` | `text-muted-foreground` | — |

**Blue is dead.** Transient "testing/updating" states are `pending` (neutral).
Links are `text-primary hover:underline` — never `text-blue-600`.

### Sanctioned exceptions
Step-identity hexes (`node-accent.ts`), connector brand hexes
(`source-style.ts`), and canvas tokens are the only raw colors allowed, and
only in those files. `RANK_ACCENTS`-style copies are forbidden — import them.

## 3. Typography

Inter variable (`cv01`, `ss03`, −0.008em body tracking) + `--font-mono`
(system mono) for IDs, keys, URLs, code.

**Eight sizes in-app, nothing between them** (plus `hero` for marketing only):
`micro` 11 · `tiny` 12 · `small` 13 · `base` 14 (default) · `lead` 15 ·
`title` 17 · `display` 24 · `stat` 36 · (`hero` 40, landing only).
Weights: 400, `font-medium`, `font-semibold`. Never `font-bold`.

**Canonical recipes** (the only spellings):
| Role | Recipe |
|---|---|
| Page title (h1) | `PageHeader` → `text-display font-semibold tracking-tight text-foreground` |
| Section heading (h2) | `SectionHeading` → `text-micro font-semibold uppercase tracking-wide text-muted-foreground` |
| Card/modal title | `text-title font-semibold tracking-tight text-foreground` |
| List-item title | `text-base font-semibold text-foreground` (or `text-lead` for hero rows) |
| Body / secondary / caption | `text-base` / `text-base text-muted-foreground` / `text-tiny text-muted-foreground` |
| Headline number | `tnum text-stat font-semibold` + `formatMetricValue` — no other size, ever |
| Field label | `FieldLabel` (`mb-1.5 block text-base font-semibold text-foreground`) |

Stock Tailwind sizes (`text-xs`…`text-9xl`) are banned and will be removed
from the theme.

## 4. Shape & elevation

**Radii — four tokens + full:** `rounded-control` 8px (buttons, inputs, nav
tiles) · `rounded-card` 12px (tiles, sections) · `rounded-surface` 16px
(panels, modals, tables, step cards) · `rounded-frame` 32px (the app shell
notch only) · `rounded-full` (pills, avatars, switches). Stock
`rounded`/`-md`/`-lg`/`-xl` and arbitrary radii are banned.

**Shadows:** surfaces with a border use the ring-free ladder —
`shadow-card` (rest) · `shadow-card-hover` (hover/drag) · `shadow-surface`
(floating over canvas) · `shadow-panel` (modals). The ringed twins exist only
for borderless surfaces. `shadow-sm` and friends are banned.

## 5. Layout & spacing

4px grid. Page shape comes from primitives, not hand-set containers:
- `PageContainer` — `max-w-5xl px-6 py-10`; `width="narrow"` → `max-w-3xl`
  (forms, detail pages). Centered flows (auth, onboarding) use `max-w-md`.
- Card padding: `p-5` default, `p-4` compact, `p-3` dense rows. Nothing else.
- Section rhythm: `mt-8` between page sections.

## 6. Components (`src/components/ui/`)

`Button` (8 variants × 5 sizes — every clickable), `Card` (card/surface ×
none/dense/compact/default), `Input`/`Textarea`/`NativeSelect`,
`FieldLabel`/`FieldHint`/`FieldError`, `StatusPill` (5 tones, optional dot) /
`Badge`, `Switch` (2 sizes), `Chip` (filter pill + count), `Modal`/`ModalTitle`
(one scrim: `bg-neutral-950/30 backdrop-blur-sm`), `TableShell`/`Table`/`THead`/
`TH`/`TBody`/`TR`/`TD`, `Toast` (dark, bottom-center, optional action),
`EmptyState`, `Skeleton`, `PageContainer`/`PageHeader`/`SectionHeading`.

Hand-rolling any of these is a defect. Links dressed as buttons use
`buttonVariants()` — never a re-typed class string.

## 7. Interaction

- **Focus:** `focus-visible:ring-4 ring-ring/40` (fields add
  `focus-visible:border-ring`, ring at `/25`). Never `focus:` rings, never a
  stripped outline without a replacement.
- **Hover:** neutral hovers are `hover:bg-muted` (rows `hover:bg-muted/40`);
  primary is `hover:brightness-110`. Never `hover:bg-neutral-50/100`.
- **Disabled:** `disabled:pointer-events-none disabled:opacity-50`, only.
- **Motion:** 150ms color transitions; the global 0.5px press dip;
  `flow-pop-in/out` for floating surfaces; `.lift` for interactive cards.
  All gated on `prefers-reduced-motion`.
- **Destructive ceremony:** two tiers — inline confirm (`destructiveOutline` +
  `destructive` pair) for reversible-ish acts; `Modal` with typed confirmation
  for permanent ones. Nothing destructive fires on first click.

## 8. Iconography

lucide-react only. Sizes: **14** inline/dense · **16** default · **18**
toolbar · **24** rail. `strokeWidth` 2 (2.25 only at ≤14px). Text glyphs
(`✕ ▾ ✓ › ★ ⚠ ⚙ →`) are banned — `X`, `ChevronDown`, `Check`,
`ChevronRight`, `Star`, `AlertTriangle`, `Settings`, `ArrowRight`.

## 9. Data visualization

Marks are `brand-600`; target-met `success`; bottleneck `danger`; tracks
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

Belt and braces: the stock namespaces are also **cleared** from the theme
(`--text-*`, `--radius-*`, `--shadow-*` set to `initial` in `globals.css`), so
a banned size, radius or shadow does not merely fail review — it compiles to
nothing and is visible on the page.
