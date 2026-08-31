# The dark console re-theme

Namzilabs moves from a charcoal band wrapping a light ground to a single
near-black surface separated entirely by hairlines. The reference is a
VoltAgent-style observability console, supplied as a Figma JSX export plus a
screenshot. This document is the decision record; `docs/BRAND_KIT.md` is the
mechanical half and `DESIGN.md` is the prose half, both rewritten to match.

---

## 1. What is changing, in one paragraph

The product's identity was **a `#2E2E2E` band around a `#F5F5F5` page**, with no
hairline inside the band because a 40-point luminance step finds its own edge.
The reference inverts that: **rail, top bar and page are all `#0F1011`**, and
every separation in the product is a 1px `#2B2D2F` rule. Cards step *up* to
`#1A1B1E` rather than down to white. Light mode is deleted. Yellow and violet
retire in favour of one green that both fills and strokes.

## 2. Decisions taken

| | decision |
|---|---|
| Themes | **Dark only.** The light `:root` is deleted, `.dark` folds into `:root`, `next-themes` and `ThemeToggle` are removed. `dark:` appears only 9 times in `src`. |
| Accent | **Green.** `#00D492` strokes/inks, `#00BC7D` fills. `--primary` (yellow) and `--marker` (violet) retire. |
| Builder | Canvas, nodes and edges frozen byte-identical. Toolbar, config panel, modals and controls re-themed as a **separately reviewed stage**. |
| Surfaces | 12 console pages + landing are designed. Legal/onboarding/auth-error follow automatically — they are role-token-only. |
| Kit page | `/design` rewritten as the new reference. |
| Rail | 48px at rest, **hover expansion retained** (the reference's unlabelled icon column is its weakness, not a feature). |
| Type | `-apple-system` first, Inter fallback. Real SF Pro on Apple hardware; no font files shipped. |

## 3. The token layer

### Surfaces

    --background / --ground   #0F1011   rail, top bar and page — one colour
    --card / --popover        #1A1B1E   1.11:1 step; the hairline does the work
    --control                 #141518   selects, date pickers, inputs
    --border                  #2B2D2F   the only separator in the product

### Accent

    --primary                 #00BC7D   fills — 7.70:1 under #0F1011 ink
    --accent                  #00D492   strokes, links, ink — 9.83:1 on the ground
    --accent-soft             rgb(0 188 125 / 0.10)
    --accent-soft-line        rgb(0 188 125 / 0.20)

Because green measures 9.83:1 as a stroke on this ground, **the fill/stroke
split stops being necessary**. It existed because `#EECF00` measures 1.55:1 as a
line on white and 11.24:1 as a fill — one colour that could only safely do one
of the two jobs. Green does both. The `yellow-as-stroke` gate rule retires with
the token it policed.

### Ink — four values, not the reference's seven

The reference ships `#DCDCDC`, `#E5E7EB`, `#A1A1A1`, `#9CA3AF`, `#99A1AF`,
`#6A7282` and white. Three of those are within three counts of each other. That
is the "twelve names over nine sizes" failure the type scale was closed to
prevent, arriving in the colour layer instead.

    --ink-0     #FFFFFF   page titles, the headline numeral
    --ink-100   #DCDCDC   body, card titles, primary UI       12.55:1 on card
    --ink-300   #9CA3AF   descriptions, subtitles, captions    6.78:1 on card
    --ink-500   #7D8593   placeholders, empty states           4.63:1 on card

**`--ink-500` is deliberately not the reference's `#6A7282`.** That value
measures **3.56:1 on its own `#1A1B1E` card** — under the 4.5:1 body text owes,
and the reference sets its empty-state copy in it. Raised four steps in the same
hue family to clear AA.

### State, and the collision

Green is now both the brand and success. The old rule — "state is a separate
vocabulary and never borrows from these" — cannot survive, so it is replaced:

> Green means good-or-brand. Warn and danger are the only separate state hues.
> **Status is quiet when fine:** a healthy thing carries a 6px dot; only a thing
> that needs you wears a full pill.

The second sentence was already in the kit and is the half doing real work. A
board where every card shows a green badge is furniture reporting no news.

### Shape

Radius collapses to **4 / 8 / 10 / full**. The reference has no 12px or 16px
radius anywhere, so `--radius-surface` drops from 16 to 10: everything that
contains something is one radius, everything pressable stays a pill, and
multi-line pressables keep the 8px control radius.

Shadows collapse from four rungs to two — `card` (`0 1px 2px -1px`, `0 1px 3px`)
and `pop` (`0 4px 6px -4px`, `0 10px 15px -3px`). On a near-black ground the
border separates and elevation barely reads; four rungs was three more than the
surface can express.

### Type

The scale gains `--text-2xs` (10px, the micro badge) and keeps the display steps.
**The metric tile is not taken from the reference** — the reference has no
numbers on it, and `DESIGN.md` §10 already holds that surface open.

Weights stay 400/500/600. The reference sets its badge numerals at 700; the gate
fails on `font-bold` and this export gets no more exemption than the last one.

## 4. Geometry

| | before | after |
|---|---|---|
| Rail | 70px → 240px hover | **48px** → 240px hover |
| Top bar | 70px | **40px** content, 24/8 padding |
| Page padding | varies | **24px** |
| Grid gap | varies | **24px** |
| Card padding | 24px (`p-6`) | **16px** |
| Card header | none | **16px + `border-b`** |
| Control height | 36/44px | **32px** |

## 5. Deliberate departures from the reference

1. **Four greys, not seven** — three of the reference's are mutually indistinguishable.
2. **`--ink-500` raised to `#7D8593`** — the reference's dimmest ink fails AA on its own card.
3. **No `font-bold`** — the kit runs three weights and `check:ui` enforces it.
4. **The rail keeps its hover expansion** — 12 unlabelled icons is the reference's weakness.
5. **The metric and chart cards are not derived from it** — it has no numbers on it to derive from.

## 6. Frozen files

Byte-identical through this work:

    src/components/flow/flow-canvas.tsx
    src/components/flow/FlowNodeCard.tsx
    src/components/flow/InsertEdge.tsx
    src/components/flow/drop-slot.tsx
    src/components/flow/node-accent.ts
    src/components/flow/node-meta.ts
    src/components/flow/flow-canvas-preview.tsx
    src/components/flow/empty-canvas-preview.tsx

**Consequence:** `--canvas-bg` keeps its current dark value `#1B191A` rather than
moving to `#0F1011`, so the canvas sits six counts off the chrome around it.
Frozen means frozen; this is flagged for the stage 5 review rather than changed
unilaterally.

## 7. Stages

Each ends green on `pnpm typecheck && pnpm test && pnpm check:ui`.

1. **Token layer** — `globals.css`, `layout.tsx`, delete `theme.tsx`
2. **Chrome** — `sidebar`, `top-bar`, `app-frame`, `shell-skeleton`, `ui/page`
3. **Primitives** — ~20 files in `src/components/ui`
4. **Pages** — 12 console pages + landing
5. **Builder chrome** — toolbar, panel, modals, controls (reviewed before applying)
6. **Gate + docs** — `check-ui.ts`, `DESIGN.md`, `BRAND_KIT.md`, `/design`

## 8. Tests that move with the work

- `design-swatches` — pins `/design`'s printed hexes to the tokens
- `design-index` — pins its table of contents to real section ids
- `page-width` — pins `PageContainer` against `ShellSkeleton`
- `chrome-band` — pins `--spacing-chrome-band` to the builder's panel inset; the top bar's 70px → 40px moves it
- `canvas-tokens` — the canvas reads tokens rather than copying them
- `vendored-primitives` — what a shadcn component gives up at the door

## 9. Gate changes

Retired: `yellow-as-stroke`, `retired accent-yellow`.
Added: `retired-marker` (the violet ramp is gone and its classes would compile to
nothing), `retired-dark-variant` (a `dark:` in a one-theme app is a no-op that
reads as intent), `off-ramp grey` (the four inks are a closed set for the same
reason the type scale is).
