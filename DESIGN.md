---
version: alpha
name: Namzilabs-design-system
description: "A reconciliation instrument typeset like a printed statement: warm bone paper #f7f6f3 carrying pure-white plates, cool near-black ink #14161a, and a single scarce ledger blue #1e3f9c that is licensed to four uses and forbidden from every fill in the product. Every figure the product emits is set in Geist Mono at weight 450 — a different species from the Inter that carries every sentence — so a machine's answer and a human's prose are never confusable, and the reconciliation table aligns to its decimal column without a layout doing the work. Beneath every figure runs THE RULE: a 1px line, the width of the number, that is continuous when the sources agree, segmented by source when you need to know where the number came from, and hatched when they disagree. Depth runs downward — the flow builder is a near-black well #0d0f12 milled into the page rather than a panel floating above it — and the entire system ships exactly one shadow definition. No weight above 500 exists anywhere; the numbers are loud because they are large, tabular and alone, never because they are bold."

colors:
  primary: "#14161a"
  primary-pressed: "#0a0c0f"
  primary-disabled: "#d5d1c9"
  on-primary: "#ffffff"
  ink: "#14161a"
  body: "#2b2f36"
  ink-muted: "#4d525b"
  ink-subtle: "#686d77"
  canvas: "#f7f6f3"
  surface-1: "#ffffff"
  surface-2: "#fbfaf8"
  surface-sunken: "#f2f0ec"
  hairline: "#e6e3dd"
  hairline-strong: "#d5d1c9"
  accent: "#1e3f9c"
  accent-pressed: "#16307a"
  accent-wash: "#eef1fa"
  semantic-up: "#1a6b4c"
  semantic-down: "#a02a1e"
  semantic-variance: "#8a6414"
  semantic-stale: "#a8a49c"
  source-calendly: "#0d6e73"
  source-sheets: "#31693c"
  source-crm: "#6b3fae"
  source-webhook: "#8f5d06"
  source-telegram: "#ab2f63"
  source-empty: "#d5d1c9"
  well: "#0d0f12"
  well-surface-1: "#15181d"
  well-surface-2: "#1c2027"
  well-hairline: "#23272f"
  well-hairline-strong: "#30353e"
  well-grid-dot: "#22262e"
  well-edge: "#3a4049"
  well-ink: "#f2f3f4"
  well-ink-muted: "#9aa0a9"
  well-accent: "#8aa0f0"
  well-up: "#3fb98a"
  well-down: "#f0736a"
  chart-1: "#14161a"
  chart-2: "#5b7a8c"
  chart-3: "#9a6f3c"
  chart-4: "#4f6b4a"
  chart-5: "#8a5a6b"
  scrim: "rgba(20,22,26,0.44)"
  focus: "#1e3f9c"
  selection: "rgba(30,63,156,0.10)"

typography:
  display-xl:
    fontFamily: Inter
    fontSize: 76px
    fontWeight: 450
    lineHeight: 1.02
    letterSpacing: -2.28px
  display-lg:
    fontFamily: Inter
    fontSize: 56px
    fontWeight: 450
    lineHeight: 1.06
    letterSpacing: -1.68px
  display-md:
    fontFamily: Inter
    fontSize: 40px
    fontWeight: 450
    lineHeight: 1.10
    letterSpacing: -1.20px
  title:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: 500
    lineHeight: 1.20
    letterSpacing: -0.84px
  heading:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: 500
    lineHeight: 1.30
    letterSpacing: -0.40px
  subheading:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 500
    lineHeight: 1.40
    letterSpacing: -0.16px
  body:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: -0.09px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.50
    letterSpacing: 0px
  button:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.00
    letterSpacing: -0.07px
  eyebrow:
    fontFamily: Geist Mono
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.20
    letterSpacing: 0.88px
  figure-hero:
    fontFamily: Geist Mono
    fontSize: 56px
    fontWeight: 450
    lineHeight: 1.00
    letterSpacing: -1.68px
  figure-lg:
    fontFamily: Geist Mono
    fontSize: 40px
    fontWeight: 450
    lineHeight: 1.00
    letterSpacing: -1.20px
  figure-md:
    fontFamily: Geist Mono
    fontSize: 28px
    fontWeight: 450
    lineHeight: 1.05
    letterSpacing: -0.84px
  figure-sm:
    fontFamily: Geist Mono
    fontSize: 18px
    fontWeight: 450
    lineHeight: 1.20
    letterSpacing: -0.36px
  mono:
    fontFamily: Geist Mono
    fontSize: 13px
    fontWeight: 450
    lineHeight: 1.45
    letterSpacing: 0px
  mono-sm:
    fontFamily: Geist Mono
    fontSize: 11px
    fontWeight: 450
    lineHeight: 1.40
    letterSpacing: 0.11px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 80px

rounded:
  none: 0px
  sm: 4px
  md: 12px
  lg: 20px
  full: 9999px

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: 10px 16px
  button-primary-pressed:
    backgroundColor: "{colors.primary-pressed}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
  button-secondary:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    border: "1px solid {colors.hairline-strong}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: 10px 16px
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: 10px 12px
  button-destructive:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.semantic-down}"
    border: "1px solid {colors.hairline-strong}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
  metric-tile:
    backgroundColor: "{colors.surface-1}"
    border: "1px solid {colors.hairline}"
    rounded: "{rounded.md}"
    padding: 20px
    gap: "{spacing.sm}"
  metric-label:
    textColor: "{colors.ink-subtle}"
    typography: "{typography.eyebrow}"
    textTransform: uppercase
  metric-figure:
    textColor: "{colors.ink}"
    typography: "{typography.figure-lg}"
    fontVariantNumeric: tabular-nums
  provenance-rule:
    height: 2px
    rounded: "{rounded.none}"
    marginTop: "{spacing.xs}"
    settledColor: "{colors.hairline-strong}"
    varianceHatch: "{colors.ink-subtle}"
  delta-chip:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    typography: "{typography.mono-sm}"
    rounded: "{rounded.none}"
  card:
    backgroundColor: "{colors.surface-1}"
    border: "1px solid {colors.hairline}"
    rounded: "{rounded.md}"
    padding: "{spacing.lg}"
  panel:
    backgroundColor: "{colors.surface-1}"
    border: "1px solid {colors.hairline}"
    rounded: "{rounded.md}"
    padding: 0px
  input:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    border: "1px solid {colors.hairline-strong}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: 9px 12px
  input-focus:
    border: "1px solid {colors.focus}"
    outline: "2px solid {colors.selection}"
  table-header:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-subtle}"
    typography: "{typography.eyebrow}"
    rounded: "{rounded.none}"
    borderBottom: "1px solid {colors.hairline-strong}"
  table-cell:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.body}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.none}"
    borderBottom: "1px solid {colors.hairline}"
    padding: 10px 16px
  table-cell-numeric:
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    textAlign: right
    fontVariantNumeric: tabular-nums
  badge:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.mono-sm}"
    rounded: "{rounded.sm}"
    padding: 3px 7px
  canvas-well:
    backgroundColor: "{colors.well}"
    dotColor: "{colors.well-grid-dot}"
    rounded: "{rounded.lg}"
    inset: true
  node-card:
    backgroundColor: "{colors.well-surface-1}"
    textColor: "{colors.well-ink}"
    border: "1px solid {colors.well-hairline}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
    leadingSpine: 3px
  node-edge:
    stroke: "{colors.well-edge}"
    strokeWidth: 1.5px
  config-panel:
    backgroundColor: "{colors.surface-1}"
    border: "1px solid {colors.hairline}"
    rounded: "{rounded.md}"
    width: 360px
  sidebar:
    backgroundColor: "{colors.canvas}"
    borderRight: "1px solid {colors.hairline}"
    width: 248px
    rounded: "{rounded.none}"
  sidebar-item-active:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    border: "1px solid {colors.hairline}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
  top-bar:
    backgroundColor: "{colors.canvas}"
    borderBottom: "1px solid {colors.hairline}"
    height: 56px
    rounded: "{rounded.none}"
  dialog:
    backgroundColor: "{colors.surface-1}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
    shadow: "0 24px 48px -12px rgba(20,22,26,0.18)"
  menu:
    backgroundColor: "{colors.surface-1}"
    border: "1px solid {colors.hairline}"
    rounded: "{rounded.md}"
    padding: "{spacing.xxs}"
    shadow: "0 24px 48px -12px rgba(20,22,26,0.18)"
  menu-item:
    textColor: "{colors.body}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: 7px 10px
  empty-state:
    backgroundColor: "{colors.surface-2}"
    border: "1px dashed {colors.hairline-strong}"
    rounded: "{rounded.md}"
    padding: "{spacing.xxl}"
  toast:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: 12px 16px
---

## Overview

Namzilabs answers a question six other tools disagree about: how many calls were booked, how fast leads were called, what closed. The design language exists to make that answer look like a **document rather than an opinion** — which is why the register is a printed financial statement and not a dashboard.

The canvas is warm bone `{colors.canvas}` #f7f6f3 and every card is pure white `{colors.surface-1}` #ffffff, so surfaces lift by going *lighter* than the page and the card-shadow question never arises. Ink is a cool near-black `{colors.ink}` #14161a at 18.11:1 on white. The primary action colour is that same near-black — not a brand hue — which keeps the entire chromatic budget available for data. One scarce blue, `{colors.accent}` #1e3f9c, is licensed to exactly four uses and appears in no fill anywhere in the product.

Two faces, both open-licensed, with no overlap in their jobs. **Inter** carries every sentence a human wrote, capped at weight 500 — there is no bold in this system. **Geist Mono** carries every string a machine produced: metric figures, deltas, targets, timestamps, record IDs, node port names and section eyebrows. The consequence is that on any screen the largest element is a monospaced figure, and a figure is never confusable with a heading.

Beneath every figure runs **the rule** — the system's one signature. Depth runs downward: the flow builder is a near-black well `{colors.well}` #0d0f12 milled into the page, not a panel floating above it.

**Key Characteristics:**
- Bone canvas #f7f6f3 with pure-white plates; elevation by brightness, not by shadow
- Achromatic primary #14161a; ledger blue #1e3f9c forbidden from every fill
- Every figure in Geist Mono 450, tabular by construction, right-aligned on a decimal spine
- The rule: a 2px line under every figure that encodes settlement and provenance
- No weight above 500 anywhere in the system
- The flow canvas is a recessed dark well, the only dark surface in the product
- Exactly one shadow definition, reserved for overlays

## Colors

### The rule of scarcity

`{colors.accent}` #1e3f9c is permitted on exactly four things: the focus ring, an inline text link, the active-source segment of a provenance rule, and the brand mark. It is **forbidden** as a button fill, a card background, a chart series, a badge, a nav highlight, a chip, or a hover state. If a screen has more than two blue elements on it, the screen is wrong.

### Surface ladder

| Token | Hex | Use |
|---|---|---|
| `{colors.canvas}` | #f7f6f3 | The page. Also the sidebar and top bar — chrome is the page, not an object on it. |
| `{colors.surface-1}` | #ffffff | Every card, tile, panel, menu, dialog, table body. |
| `{colors.surface-2}` | #fbfaf8 | Table headers, empty-state grounds, the one-step-back surface. |
| `{colors.surface-sunken}` | #f2f0ec | Badges, recessed trays, code wells on light. |
| `{colors.hairline}` | #e6e3dd | Every card and table border. |
| `{colors.hairline-strong}` | #d5d1c9 | Input borders, the settled rule, header underlines. |

Hairlines are set one step from the surface ladder deliberately, so a border reads as an elevation step rather than as drawn ink.

### Text

| Token | Hex | On white | Use |
|---|---|---|---|
| `{colors.ink}` | #14161a | 18.11:1 | Figures, headings, primary text. |
| `{colors.body}` | #2b2f36 | 13.44:1 | Body prose, table cells. |
| `{colors.ink-muted}` | #4d525b | 7.85:1 | Secondary text, ghost buttons, deltas. |
| `{colors.ink-subtle}` | #686d77 | 5.19:1 | Eyebrows, captions, placeholders. 4.81:1 on canvas. |

Nothing carrying text falls below 4.5:1 in either theme.

### Semantic

| Token | Hex | On white | Use |
|---|---|---|---|
| `{colors.semantic-up}` | #1a6b4c | 6.46:1 | A genuine directional increase. |
| `{colors.semantic-down}` | #a02a1e | 7.38:1 | A genuine directional decrease. |
| `{colors.semantic-variance}` | #8a6414 | 5.37:1 | Sources disagree. |
| `{colors.semantic-stale}` | #a8a49c | — | Freshness dot only, never text. |

**A decline and a disagreement are different facts and never share a colour.** A number going down is news; a number nobody agrees on is a bug. Variance is additionally rendered in parentheses — `(−14)` — following accounting convention, and is never coloured red.

### Source taxonomy

Five hues, one per connected tool, used in exactly one place: the segments of a provenance rule and the 3px leading spine of a flow node.

| Token | Hex | Source |
|---|---|---|
| `{colors.source-calendly}` | #0d6e73 | Calendly |
| `{colors.source-sheets}` | #31693c | Google Sheets |
| `{colors.source-crm}` | #6b3fae | CRM |
| `{colors.source-webhook}` | #8f5d06 | Webhook |
| `{colors.source-telegram}` | #ab2f63 | Telegram |
| `{colors.source-empty}` | #d5d1c9 | Contributed nothing |

These hues appear nowhere else. Not on a button, not as a card fill, not as text, not as a chart series, not on a flow edge. In a resting dashboard the only chroma on screen is a handful of rule segments and the focus ring.

### The well (flow builder)

The canvas is the product's only dark surface, and it is dark because it is *recessed*, not because it is a theme.

| Token | Hex | Use |
|---|---|---|
| `{colors.well}` | #0d0f12 | The canvas ground. |
| `{colors.well-surface-1}` | #15181d | Node cards. |
| `{colors.well-surface-2}` | #1c2027 | Node hover / selected fill. |
| `{colors.well-hairline}` | #23272f | Node borders. |
| `{colors.well-grid-dot}` | #22262e | The dot grid. |
| `{colors.well-edge}` | #3a4049 | Connector strokes. |
| `{colors.well-ink}` | #f2f3f4 | Node text — 16.01:1 on #15181d. |
| `{colors.well-ink-muted}` | #9aa0a9 | Node secondary — 6.76:1. |

## Typography

### Font Family

**Inter** (variable, OFL) — every word a human wrote. Permitted weights: **400, 450, 500**. Weights 600 and 700 do not exist in this system. Enable `cv05` globally: an untailed `l` collides with `1` and `I` in field-mapping paths, which is the one place a misread costs a wrong metric.

**Geist Mono** (OFL) — every string a machine produced: figures, deltas, targets, timestamps, record IDs, port names, eyebrows, JSON. Inherently tabular. The face must render a slashed or dotted zero — an unslashed `0` beside an `O` in a record ID is a support ticket.

No third face. No serif, no condensed, no italic display.

### Hierarchy

Tracking is computed as **−3% of font size** on every step above 28px, easing to 0 by 14px, and flipping **positive** on the eyebrow.

| Token | Face | Size | Weight | Leading | Tracking |
|---|---|---|---|---|---|
| `display-xl` | Inter | 76px | 450 | 1.02 | −2.28px |
| `display-lg` | Inter | 56px | 450 | 1.06 | −1.68px |
| `display-md` | Inter | 40px | 450 | 1.10 | −1.20px |
| `title` | Inter | 28px | 500 | 1.20 | −0.84px |
| `heading` | Inter | 20px | 500 | 1.30 | −0.40px |
| `subheading` | Inter | 16px | 500 | 1.40 | −0.16px |
| `body` | Inter | 15px | 400 | 1.55 | −0.09px |
| `body-sm` | Inter | 13px | 400 | 1.50 | 0px |
| `button` | Inter | 14px | 500 | 1.00 | −0.07px |
| `eyebrow` | Geist Mono | 11px | 500 | 1.20 | **+0.88px** |
| `figure-hero` | Geist Mono | 56px | 450 | 1.00 | −1.68px |
| `figure-lg` | Geist Mono | 40px | 450 | 1.00 | −1.20px |
| `figure-md` | Geist Mono | 28px | 450 | 1.05 | −0.84px |
| `figure-sm` | Geist Mono | 18px | 450 | 1.20 | −0.36px |
| `mono` | Geist Mono | 13px | 450 | 1.45 | 0px |
| `mono-sm` | Geist Mono | 11px | 450 | 1.40 | +0.11px |

### Principles

- **There is no bold.** Emphasis comes from a face switch, a size step, uppercase, or a surface change — never from `font-weight`. A totals row earns its emphasis with a hairline above it and a switch to `figure-sm`.
- **A figure is never set in Inter, and prose is never set in Geist Mono.** The split is the system's clearest signal and it must not leak.
- **The leading gap is deliberate:** 1.00–1.20 on display and figures against 1.50–1.55 on body. Display is carved; prose breathes.
- In-product text caps at `title` 28px. `display-*` belongs to marketing and empty states only, so nothing in the product can out-shout a figure.

### Note on Font Substitutes

Inter and Geist Mono are both open-licensed and self-hosted; there is no fallback plan that changes the design. If Geist Mono is unavailable, substitute **JetBrains Mono 500** and step figure sizes down 2px — its lowercase is wider and a 40px figure will otherwise overrun a tile.

## Layout

### Spacing System

A strict 4px base. `xxs` 4 · `xs` 8 · `sm` 12 · `md` 16 · `lg` 24 · `xl` 32 · `xxl` 48 · `section` 80.

Card padding is `20px` — a deliberate off-scale value, and the only one. A 16px card reads cramped under a 40px figure and a 24px card wastes a row of tiles at 1280px.

### Grid & Container

- Product container: **1280px** max, `lg` 24px gutters.
- Marketing container: **1120px** max, centred.
- Dashboard grid: 12 columns, 16px gap, 24px row unit.
- Sidebar: **248px**, fixed. Top bar: **56px**, fixed.
- Config panel: **360px**, docked right.

### Whitespace Philosophy

Chrome is the page. The sidebar and top bar are both `{colors.canvas}` with a single hairline separating them from the white plates — there is no third chrome colour and no chrome shadow. Vertical rhythm between page sections is `xl` 32px in-product and `section` 80px on marketing. A dashboard is allowed to be dense; the marketing page is not.

## Elevation & Depth

Depth is a **brightness ladder**, and the product's most important surface goes **down**.

| Level | Treatment | Use |
|---|---|---|
| −1 · Recessed | `{colors.well}` #0d0f12, `{rounded.lg}`, no shadow, no border | The flow canvas; JSON wells |
| 0 · Page | `{colors.canvas}` #f7f6f3 | The page, sidebar, top bar |
| 1 · Plate | `{colors.surface-1}` #ffffff + 1px `{colors.hairline}` | Every card, tile, panel, table |
| 2 · Overlay | `{colors.surface-1}` + the one shadow | Menus, dialogs, popovers only |

**There is exactly one shadow in this system:** `0 24px 48px -12px rgba(20,22,26,0.18)`. It is permitted on menus, dialogs and popovers. It is forbidden on cards, tiles, buttons, inputs, the sidebar, the top bar and anything on the canvas.

### Decorative Depth

None. There are no gradients, no glows, no inner highlights, no blurred backdrops. A surface is a brightness and a hairline. **Remove the recessed well and the mono figures and this system is gone** — those two moves, plus the rule, are the entire identity.

## Shapes

### Border Radius Scale

A gapped scale. **8px is deliberately absent**, and its absence is what stops every element converging on one soft blur.

| Token | Value | Use |
|---|---|---|
| `{rounded.none}` | 0px | The rule, table cells, sparkline plots, calendar heat cells, the dot grid |
| `{rounded.sm}` | 4px | Everything clickable: buttons, inputs, selects, tabs, chips, badges, menu items, sidebar rows |
| `{rounded.md}` | 12px | Cards, tiles, panels, node cards, menus |
| `{rounded.lg}` | 20px | Dialogs and the canvas well |
| `{rounded.full}` | 9999px | Avatars and status dots **only** |

**Nothing is a pill.** A pill button reads consumer, and this product's claim is that its numbers are auditable.

### Data Geometry

Sparklines are 2px strokes with no fill and no dots. Bar charts are `{rounded.none}`. Chart series use `{colors.chart-1}` through `{colors.chart-5}` in order, never the source taxonomy and never the accent.

## Components

**`metric-tile`** — The product. A white plate on bone.
- `{colors.surface-1}` + 1px `{colors.hairline}`, `{rounded.md}`, 20px padding
- Eyebrow label in `{typography.eyebrow}` uppercase `{colors.ink-subtle}`
- Figure in `{typography.figure-lg}` `{colors.ink}`, tabular
- The rule directly beneath the figure, 8px gap
- Delta in `{typography.mono-sm}` `{colors.ink-muted}` — never green, never red, unless it is a genuine direction

**`provenance-rule`** — The signature. A 2px line, `{rounded.none}`, the exact width of the figure above it, 8px below its baseline.
- **Settled** — every connected source agrees: one continuous `{colors.hairline-strong}` line.
- **Provenance** — segmented, one segment per contributing source, width proportional to contribution, filled in that source's taxonomy hue. A source that contributed nothing is `{colors.source-empty}`.
- **Variance** — sources disagree: the segment becomes `{colors.surface-sunken}` under a 1px 45° `{colors.ink-subtle}` hatch at 3px pitch, with the conflict count in `{typography.mono-sm}` at the rule's right end.
- The rule never appears under a heading, a button, or a figure whose freshness has expired. It never animates in.

**`data-table`** — The densest surface, and the one that must be provably right.
- Header `{colors.surface-2}`, `{typography.eyebrow}`, 1px `{colors.hairline-strong}` beneath
- Cells `{typography.body-sm}` `{colors.body}`, 10px/16px padding, `{rounded.none}`
- **Every numeric cell is `{typography.mono}`, right-aligned, tabular.** Text cells are Inter, left-aligned. There is no third alignment.
- Row separator 1px `{colors.hairline}`. No zebra striping — the hairline does that job.

**`node-card`** — Inside the well.
- `{colors.well-surface-1}` + 1px `{colors.well-hairline}`, `{rounded.md}`, 16px padding
- A 3px leading spine in the step's source hue — the same physical object as a provenance segment, so the dashboard and the canvas are visibly the same machine from two ends
- Title `{typography.subheading}` `{colors.well-ink}`; port names `{typography.mono-sm}` `{colors.well-ink-muted}`
- Selected: fill lifts to `{colors.well-surface-2}`, border to `{colors.well-hairline-strong}`. No glow.

**`node-edge`** — 1.5px `{colors.well-edge}`, always. Edges are drawn, not operated: no hover state, no selected state, and never a taxonomy hue, so the canvas never becomes coloured spaghetti.

**`button-primary`** — `{colors.primary}` fill, white text, `{rounded.sm}`, 10px/16px. The only filled button in the product.

**`button-secondary`** — White fill, `{colors.ink}` text, 1px `{colors.hairline-strong}`.

**`button-ghost`** — Transparent, `{colors.ink-muted}`. For tertiary actions and icon buttons.

**`input`** — White, 1px `{colors.hairline-strong}`, `{rounded.sm}`, 9px/12px, `{typography.body-sm}`. Focus adds a 1px `{colors.focus}` border and a 2px `{colors.selection}` outline. Invalid swaps the border to `{colors.semantic-down}`.

**`menu`** — White, 1px `{colors.hairline}`, `{rounded.md}`, 4px padding, the one shadow. Rows are `{rounded.sm}` — a 12px panel holding 4px rows, and no third shape.

**`dialog`** — White, `{rounded.lg}`, 24px padding, the one shadow, over `{colors.scrim}`.

**`badge`** — `{colors.surface-sunken}`, `{typography.mono-sm}`, `{rounded.sm}`, 3px/7px. Status badges carry a `{rounded.full}` 6px dot in the semantic colour; the badge itself never takes the hue.

**`sidebar`** — 248px, `{colors.canvas}`, 1px `{colors.hairline}` on the right. The active row is a **white plate with a hairline** — the same object as a card, so "where I am" uses the system's existing vocabulary rather than a new colour.

**`top-bar`** — 56px, `{colors.canvas}`, hairline beneath. Holds the mark, the workspace, and at most two actions.

**`empty-state`** — `{colors.surface-2}` ground, 1px dashed `{colors.hairline-strong}`, `{rounded.md}`, 48px padding. One `{typography.subheading}` line, one `{typography.body-sm}` line, one `button-primary`. No illustration.

**`toast`** — `{colors.primary}` fill, white text, `{rounded.sm}`. Bottom-centre. One at a time.

## Do's and Don'ts

### Do
- Set every figure, delta, target, timestamp and ID in Geist Mono; set every sentence in Inter
- Right-align every numeric column and left-align every text column, with no exceptions
- Draw the rule under every figure, in all three of its states, from day one
- Reserve `{colors.accent}` for the focus ring, inline links, the active provenance segment and the brand mark
- Lift surfaces by making them lighter than the page, never by adding a shadow
- Use the source taxonomy hues only on provenance segments and node spines
- Render a source disagreement in parentheses and `{colors.semantic-variance}`, never in red
- Cap every weight at 500 and reach for a face switch when you need emphasis

### Don't
- Don't use `{colors.accent}` as a fill — a blue button next to a ruled figure competes for the eye that is supposed to land on the number
- Don't colour a numeral to show state; state lives in the rule, the parentheses and the dot
- Don't pill-round anything but avatars and status dots — the pill reads consumer and this product is audited
- Don't put a shadow on a card, tile, button or anything inside the well
- Don't let a taxonomy hue become a button, a chart series, a badge fill or an edge stroke
- Don't introduce an 8px radius; the gap between 4 and 12 is what keeps controls and containers distinguishable
- Don't set a figure in Inter or a paragraph in Geist Mono
- Don't document or design hover states — specify default and pressed only

## Responsive Behavior

### Breakpoints

| Name | Width | Key changes |
|---|---|---|
| `sm` | < 640px | Sidebar becomes a sheet; dashboard grid collapses to 1 column; figures step to `figure-md` |
| `md` | 640–1023px | 6-column grid; config panel becomes a bottom sheet |
| `lg` | 1024–1279px | 12-column grid; sidebar collapses to icons at 64px |
| `xl` | ≥ 1280px | Full 1280px container, 248px sidebar, docked config panel |

### Touch Targets

Minimum 44×44px for every control. Buttons at 10px/16px reach 38px and must gain 3px vertical padding below `md`. Table rows go to 14px vertical padding on touch.

### Collapsing Strategy

The rule never collapses — it is the last thing to go, and if a tile is too narrow to show segments it falls back to the settled/variance binary rather than disappearing. Tables scroll horizontally inside their own container with the first column pinned; the page body never scrolls sideways.

### Image Behavior

There is no photography in this product. Marketing surfaces use product screenshots framed in a `{rounded.md}` white plate with a hairline — never a drop shadow, never a device mockup, never a gradient backdrop.

## Iteration Guide

1. Focus on ONE component at a time; resolve it fully against its tokens before moving on.
2. Use `{token.refs}` everywhere — never an inline hex.
3. Variants live as separate entries inside `components:`, not as prose notes.
4. Hover state is never documented; specify default and pressed only.
5. Run `npx @google/design.md lint DESIGN.md` after edits.
6. Before adding a colour, try a surface step or a face switch first — the answer is almost always one of those two.
7. The three non-negotiables: **figures are mono**, **the rule is always drawn**, **the accent never fills**.

## Known Gaps

- Form validation copy and multi-error field states are not specified.
- Animation and transition timings are undefined; no motion system exists yet.
- The provenance rule's behaviour above six contributing sources is undecided — segments below 4px are unreadable.
- Chart types beyond sparkline, bar and the calendar heat grid are unspecified.
- No print stylesheet, though a product that argues it produces documents should probably have one.
- Onboarding, sign-in and marketing surfaces reuse product tokens but have no layout specification of their own.
