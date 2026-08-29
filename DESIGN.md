---
version: alpha
name: Namzilabs-the-board
description: Namzilabs presents itself as the place six arguing tools finally agree, through a loud, board-shaped language borrowed from the playful camp — Miro, Figma, Notion, Clay — and organised around a single object: a whole-card pastel sticky note at 28px with no border, carrying one tabular sans figure big enough to read across a room. The chromatic budget goes entirely into those fills; every primary button on every surface is near-black ({colors.primary}), which is precisely what frees six note pastels to classify metric families and their six saturated twins to mark dots, spines and sparkbars. Violet ({colors.violet}) is identity and selection only — wordmark, active nav row, focus ring, selected node — and canary yellow ({colors.yellow}) is the hero, spent at most once per screen. Sections alternate white → warm band → white → dark and never repeat a white, because two whites in a row collapse the page into a typography blog. Inter carries every human word up to weight 700; the mono is reserved for strings a machine produced. The system covers a marketing/specimen page, a metrics dashboard, a dark-canvas flow builder and a dense activity table.

colors:
  canvas: "#ffffff"
  band: "#f6f5f3"
  surface: "#ffffff"
  sunken: "#efedea"
  hairline: "#e7e4e0"
  hairline-strong: "#d6d2cc"
  ink: "#1a1a1a"
  body: "#3d3d3d"
  muted: "#6b6b6b"
  subtle: "#6f6f6f"
  on-dark: "#fafafa"
  primary: "#1a1a1a"
  primary-hover: "#333333"
  violet: "#7c4dff"
  violet-ink: "#5b21e0"
  violet-wash: "#f1ebff"
  yellow: "#ffd94a"
  yellow-wash: "#fff7d6"
  yellow-chip-ink: "#7a5c00"
  note-lilac: "#ece7ff"
  note-mint: "#d6f2e3"
  note-peach: "#ffe4d1"
  note-rose: "#ffe0ec"
  note-sky: "#ddebff"
  note-butter: "#fff2c2"
  mark-lilac: "#7c4dff"
  mark-mint: "#12a06a"
  mark-peach: "#f2761f"
  mark-rose: "#e0417c"
  mark-sky: "#2563eb"
  mark-butter: "#d19c00"
  up: "#0f7c45"
  up-on-note: "#0d6f3e"
  up-wash: "#dff5e9"
  down: "#c0342a"
  down-wash: "#ffe4e0"
  warn: "#8a6414"
  warn-wash: "#fdf0cf"
  dark: "#17161c"
  dark-2: "#211f28"
  dark-3: "#2b2833"
  dark-hairline: "#322e3c"
  dark-dot: "#302c3a"
  dark-edge: "#4a4458"
  dark-mono: "#9b95a8"

typography:
  hero:
    fontFamily: Inter
    fontSize: 68px
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: -0.035em
  display:
    fontFamily: Inter
    fontSize: 46px
    fontWeight: 700
    lineHeight: 1.06
    letterSpacing: -0.032em
  title:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: -0.028em
  heading:
    fontFamily: Inter
    fontSize: 21px
    fontWeight: 600
    lineHeight: 1.28
    letterSpacing: -0.022em
  sub:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: -0.014em
  body:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 0.02em
    textTransform: uppercase
  mono:
    fontFamily: ui-monospace
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: 0
  figure:
    fontFamily: Inter
    fontSize: 52px
    fontWeight: 680
    lineHeight: 1.0
    letterSpacing: -0.04em
    fontVariantNumeric: tabular-nums
  figure-sm:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: 680
    lineHeight: 1.05
    letterSpacing: -0.032em
    fontVariantNumeric: tabular-nums
  button:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1
    letterSpacing: -0.014em
  button-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1
    letterSpacing: -0.014em
  button-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1
    letterSpacing: -0.014em
  chip:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1
    letterSpacing: -0.006em
  input:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.4
  nav-row:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: -0.011em
  table-cell:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.5

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 96px

rounded:
  sm: 10px
  md: 16px
  lg: 28px
  xl: 36px
  full: 9999px

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-dark}"
    typography: "{typography.button}"
    rounded: "{rounded.full}"
    padding: "11px 20px"
    border: "1.5px solid transparent"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-dark}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.full}"
    padding: "11px 20px"
    border: "1.5px solid {colors.hairline-strong}"
  button-violet:
    backgroundColor: "{colors.violet}"
    textColor: "#ffffff"
    typography: "{typography.button}"
    rounded: "{rounded.full}"
    padding: "11px 20px"
  button-yellow:
    backgroundColor: "{colors.yellow}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.full}"
    padding: "11px 20px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.button}"
    rounded: "{rounded.full}"
    padding: "11px 20px"
  button-lg:
    typography: "{typography.button-lg}"
    rounded: "{rounded.full}"
    padding: "15px 26px"
  button-sm:
    typography: "{typography.button-sm}"
    rounded: "{rounded.full}"
    padding: "8px 15px"
  button-disabled:
    opacity: 0.4
  note-card:
    backgroundColor: "{colors.note-lilac}"
    textColor: "{colors.ink}"
    typography: "{typography.figure}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
    border: "0"
  note-card-mint:
    backgroundColor: "{colors.note-mint}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
    border: "0"
  note-card-peach:
    backgroundColor: "{colors.note-peach}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
    border: "0"
  note-card-rose:
    backgroundColor: "{colors.note-rose}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
    border: "0"
  note-card-sky:
    backgroundColor: "{colors.note-sky}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
    border: "0"
  note-card-butter:
    backgroundColor: "{colors.note-butter}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
    border: "0"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.body}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    border: "1px solid {colors.hairline}"
    shadow: "0 1px 2px rgba(26, 26, 26, 0.04), 0 6px 16px -6px rgba(26, 26, 26, 0.10)"
  band:
    backgroundColor: "{colors.band}"
    textColor: "{colors.body}"
    padding: "{spacing.section} {spacing.xl}"
  band-dark:
    backgroundColor: "{colors.dark}"
    textColor: "{colors.on-dark}"
    padding: "{spacing.section} {spacing.xl}"
  empty-state:
    backgroundColor: "{colors.band}"
    textColor: "{colors.body}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xxl}"
  chip:
    backgroundColor: "{colors.sunken}"
    textColor: "{colors.body}"
    typography: "{typography.chip}"
    rounded: "{rounded.full}"
    padding: "6px 13px"
    border: "1.5px solid transparent"
  chip-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-dark}"
    typography: "{typography.chip}"
    rounded: "{rounded.full}"
    padding: "6px 13px"
  chip-violet:
    backgroundColor: "{colors.violet-wash}"
    textColor: "{colors.violet-ink}"
    typography: "{typography.chip}"
    rounded: "{rounded.full}"
    padding: "6px 13px"
  chip-yellow:
    backgroundColor: "{colors.yellow-wash}"
    textColor: "{colors.yellow-chip-ink}"
    typography: "{typography.chip}"
    rounded: "{rounded.full}"
    padding: "6px 13px"
  chip-outline:
    backgroundColor: "transparent"
    textColor: "{colors.body}"
    typography: "{typography.chip}"
    rounded: "{rounded.full}"
    padding: "6px 13px"
    border: "1.5px solid {colors.hairline-strong}"
  chip-up:
    backgroundColor: "{colors.up-wash}"
    textColor: "{colors.up}"
    typography: "{typography.chip}"
    rounded: "{rounded.full}"
    padding: "6px 13px"
  chip-warn:
    backgroundColor: "{colors.warn-wash}"
    textColor: "{colors.warn}"
    typography: "{typography.chip}"
    rounded: "{rounded.full}"
    padding: "6px 13px"
  chip-down:
    backgroundColor: "{colors.down-wash}"
    textColor: "{colors.down}"
    typography: "{typography.chip}"
    rounded: "{rounded.full}"
    padding: "6px 13px"
  dot:
    backgroundColor: "{colors.mark-sky}"
    rounded: "{rounded.full}"
    size: 9px
  text-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.input}"
    rounded: "{rounded.sm}"
    padding: "11px 14px"
    border: "1.5px solid {colors.hairline-strong}"
  text-input-focused:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    border: "1.5px solid {colors.violet}"
    outline: "3px solid {colors.violet-wash}"
  focus-ring:
    outline: "3px solid {colors.violet}"
    outlineOffset: "2px"
  data-table:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.body}"
    typography: "{typography.table-cell}"
    rounded: "{rounded.md}"
    border: "1px solid {colors.hairline}"
  data-table-header:
    backgroundColor: "{colors.band}"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    padding: "12px 18px"
  data-table-cell:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.body}"
    typography: "{typography.table-cell}"
    padding: "14px 18px"
    border: "0 0 1px {colors.hairline} solid"
  data-table-cell-numeric:
    textColor: "{colors.ink}"
    typography: "{typography.table-cell}"
    fontWeight: 600
    fontVariantNumeric: tabular-nums
    textAlign: right
  sparkbars:
    backgroundColor: "transparent"
    height: 40px
    gap: 3px
  sparkbar:
    backgroundColor: "{colors.ink}"
    rounded: "3px"
    width: 7px
    opacity: 0.18
  sparkbar-latest:
    backgroundColor: "{colors.ink}"
    rounded: "3px"
    width: 7px
    opacity: 1
  canvas-well:
    backgroundColor: "{colors.dark}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.xl}"
    backgroundImage: "radial-gradient({colors.dark-dot} 1.5px, transparent 1.5px)"
    backgroundSize: "22px 22px"
  node-card:
    backgroundColor: "{colors.dark-2}"
    textColor: "{colors.on-dark}"
    typography: "{typography.sub}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
    border: "1px solid {colors.dark-hairline}"
  node-card-selected:
    backgroundColor: "{colors.dark-3}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.md}"
    border: "1px solid {colors.violet}"
    shadow: "0 0 0 4px rgba(124, 77, 255, 0.22)"
  node-mark:
    backgroundColor: "{colors.mark-sky}"
    textColor: "{colors.on-dark}"
    rounded: "9px"
    size: 32px
  node-edge:
    strokeColor: "{colors.dark-edge}"
    strokeWidth: "1.5px"
  sidebar:
    backgroundColor: "{colors.canvas}"
    width: 260px
    border: "0 1px 0 0 {colors.hairline} solid"
    padding: "{spacing.md}"
  topbar:
    backgroundColor: "{colors.canvas}"
    height: 64px
    border: "0 0 1px 0 {colors.hairline} solid"
    padding: "0 {spacing.lg}"
  nav-row:
    backgroundColor: "transparent"
    textColor: "{colors.body}"
    typography: "{typography.nav-row}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
  nav-row-active:
    backgroundColor: "{colors.violet-wash}"
    textColor: "{colors.violet-ink}"
    typography: "{typography.nav-row}"
    fontWeight: 600
    rounded: "{rounded.sm}"
    padding: "10px 12px"
  nav-icon:
    backgroundColor: "{colors.note-sky}"
    textColor: "{colors.mark-sky}"
    rounded: "8px"
    size: 28px
  swatch:
    backgroundColor: "{colors.note-lilac}"
    rounded: "{rounded.md}"
    height: 72px
---

## Overview

Namzilabs reconciles six systems that each count the same month differently and puts the settled number on a card. The design language is built around that card. It belongs to the playful camp — Miro, Figma, Notion, Clay, Webflow — which is loud in one specific, disciplined way, and the whole system reduces to four moves.

**1. Colour classifies; black acts.** Every primary button on every surface is `{colors.primary}` — a near-black pill. Nothing else fills a default CTA. That single restriction is what frees the entire chromatic budget to go into *card fills*, where colour stops being decoration and starts being the mechanism by which you tell one metric family from another on a wall of thirty numbers.

**2. The note card at `{rounded.lg}` (28px) is the signature.** A whole-card pastel fill, no border, one tabular sans figure. Six of them side by side are a dashboard. The radius is doing work: the gap between a 10px control and a 28px note tells you instantly whether you are looking at something you operate or something you read.

**3. Section rhythm — never two whites in a row.** Pages alternate `{colors.canvas}` → `{colors.band}` → `{colors.canvas}` → `{colors.dark}`. Two white sections touching collapses a product page into a typography blog, and that is the failure mode this rule exists to prevent.

**4. The product is its own illustration.** No stock art, no abstract gradient blobs, no icon-in-a-circle filler. Where a page needs a picture it shows a note wall, a dotted flow canvas or a real data table. The specimen page's hero is four note cards rotated a degree or two on a `{colors.band}` plate — the product, in miniature.

### The three-way ratio

The brand is three colours with three jobs and no overlap:

| Colour | Job | Budget |
|---|---|---|
| **BLACK** `{colors.primary}` | Does the work. Every primary CTA, every active chip, every sparkbar at rest. | Unlimited — it is the default. |
| **VIOLET** `{colors.violet}` | Marks identity and selection. The wordmark, the active nav row, the focus ring, the ring on a selected node, the "you are here" chip. | Two to four appearances per screen. Never a workhorse, never "primary", never "good". |
| **YELLOW** `{colors.yellow}` | The hero. The one thing on the screen that is allowed to shout. | **At most once per screen.** Spend it twice and the system reads as a toy. |

Everything else — the six note pastels and their six saturated twins — is *taxonomy*, not brand. It says which family a number belongs to, and it never says whether the number is good.

**Key characteristics:**
- Whole-card pastel note fills at 28px, no border, `{typography.figure}` inside
- Near-black pills for every primary action; `{rounded.full}` on every button, chip, avatar and dot
- Six note/mark pairs where the pastel is always a fill and the saturate is always a mark
- Inter to weight 700 for anything a human wrote; mono only for strings a machine produced
- Warm neutral ground (`{colors.band}` is a warm off-white, not a grey) with one dark surface
- A single dotted near-black well for the flow canvas, milled into white paper at `{rounded.xl}`

---

## Colors

> Source of truth: `src/app/design/next/design-next.css`, scoped under `.dn`. Every value below is copied from it verbatim. The scope is deliberate — `globals.css` already owns `--background` and `--primary` at `:root`, and a second system declaring those names would silently re-theme the shipping product the moment this route was opened.

### Ground

Warm, not neutral-grey. The band is a paper tint, which is what keeps a page of pastels from looking like a children's toy.

- **Canvas** ({colors.canvas}) — the page, the cards, the chrome
- **Band** ({colors.band}) — every other section, table headers, the empty state
- **Surface** ({colors.surface}) — card fill; identical to canvas, named separately so cards can be re-grounded without touching the page
- **Sunken** ({colors.sunken}) — chips at rest, trays, recessed rows
- **Hairline** ({colors.hairline}) — card and table borders, 1px
- **Hairline Strong** ({colors.hairline-strong}) — inputs and secondary buttons, 1.5px

### Ink

- **Ink** ({colors.ink}) — headlines, figures, anything on a note card
- **Body** ({colors.body}) — prose, table cells, nav rows, chip labels
- **Muted** ({colors.muted}) — secondary prose, labels, column heads, mono strings
- **Subtle** ({colors.subtle}) — placeholders and the quietest captions. Solved rather than picked: `#8f8f8f` measures **3.23:1** on canvas and fails AA outright; this value clears **5.02:1** on canvas and **4.61:1** on the band, so the quietest text in the system is legible on *both* grounds it ever sits on.
- **On Dark** ({colors.on-dark}) — text on the dark band, the well, the node cards and every filled black control
- **Dark Mono** ({colors.dark-mono}) — the mono line inside a node card, on `{colors.dark-2}`

### The three that carry the brand

- **Primary** ({colors.primary}) — black acts. Every primary button in the product.
- **Primary Hover** ({colors.primary-hover}) — the only hover shift documented in the system.
- **Violet** ({colors.violet}) — violet marks. Identity and selection.
- **Violet Ink** ({colors.violet-ink}) — violet *as text*, which raw violet cannot be at body size. Used on `{colors.violet-wash}`.
- **Violet Wash** ({colors.violet-wash}) — the active nav row, the identity chip.
- **Yellow** ({colors.yellow}) — the hero, once. Chosen at this lightness specifically so it can carry ink; the neon it replaced could not.
- **Yellow Wash** ({colors.yellow-wash}) — the tag chip ground.
- **Yellow Chip Ink** ({colors.yellow-chip-ink}) — the only foreground allowed on `{colors.yellow-wash}`.

### The sticky-note family

Six pastels. **These are fills.** They fill a whole card, a nav icon tile, a connection avatar, an empty-state glyph plate. They are never a stroke, never a text colour, never a button.

| Family | Note (fill) | Mark (dot / spine / series) |
|---|---|---|
| Lilac | {colors.note-lilac} | {colors.mark-lilac} |
| Mint | {colors.note-mint} | {colors.mark-mint} |
| Peach | {colors.note-peach} | {colors.mark-peach} |
| Rose | {colors.note-rose} | {colors.mark-rose} |
| Sky | {colors.note-sky} | {colors.mark-sky} |
| Butter | {colors.note-butter} | {colors.mark-butter} |

**The marks are the saturated twins, and they are dots, spines and series — never fills, never buttons, never body text.** A mark is a 9px dot next to a source name, a 7px rounded sparkbar, a 32px `node-mark` square on the dark canvas, a chart series, the icon glyph inside a pastel tile. The moment a mark colour fills a card, the card stops being a note and starts being an alert; the moment a note pastel fills a button, the button stops looking pressable. The two roles do not swap.

One hue belongs to one family for the life of the account. On the dashboard, calls-booked is lilac in the tile, lilac in its sparkbars and lilac on its source dot. On the activity screen, Calendly is sky in the row dot, the connection tile and the nav icon. That consistency is what lets a person read the shape of a day without reading a word of it — and it is the reason hue must never encode severity.

### State

State colours sit outside the taxonomy entirely and are used **only on words and their own washes** — never to repaint a note card.

- **Up** ({colors.up}) / **Up Wash** ({colors.up-wash}) — the rejected value measured 4.35:1 on its own wash, just under AA; darkened to clear it at **4.61:1**
- **Up On Note** ({colors.up-on-note}) — the same green solved against a *second* ground. `{colors.up}` was only ever checked against its wash and measures 4.29–4.43:1 on five of the six note pastels, which is where the dashboard delta actually sits. This clears all six at **≥5.10:1** (rose is the worst) and 6.25:1 on canvas. Use it for an up-delta on a pastel; use `{colors.up}` everywhere else. `{colors.down}` needs no twin — 4.55:1 at worst, on rose.
- **Down** ({colors.down}) / **Down Wash** ({colors.down-wash}) — **4.63:1** on its wash, deliberately matched to the up pair so the two states read at the same weight
- **Warn** ({colors.warn}) / **Warn Wash** ({colors.warn-wash}) — **4.74:1** on its wash

### Dark

One dark surface family, for the flow canvas and the single inverse band.

- **Dark** ({colors.dark}) — the well, the closing band
- **Dark 2** ({colors.dark-2}) — node card at rest
- **Dark 3** ({colors.dark-3}) — node card selected
- **Dark Hairline** ({colors.dark-hairline}) — node border
- **Dark Dot** ({colors.dark-dot}) — the 1.5px dot in the well's 22px grid
- **Dark Edge** ({colors.dark-edge}) — connector strokes, and the border on a secondary button standing on the dark band

### Contrast — measured, not asserted

Every pair below carries real body copy somewhere in the four shipping surfaces. Ink is {colors.ink}. Nothing listed is below **4.5:1**.

**On `{colors.canvas}` (#ffffff)**

| Foreground | Ratio |
|---|---|
| ink {colors.ink} | 17.40:1 |
| body {colors.body} | 10.86:1 |
| muted {colors.muted} | 5.33:1 |
| subtle {colors.subtle} | 5.02:1 |
| violet-ink {colors.violet-ink} | 7.67:1 |
| up {colors.up} | 5.26:1 |
| down {colors.down} | 5.58:1 |
| warn {colors.warn} | 5.37:1 |

**On `{colors.band}` (#f6f5f3)**

| Foreground | Ratio |
|---|---|
| ink {colors.ink} | 15.97:1 |
| body {colors.body} | 9.97:1 |
| muted {colors.muted} | 4.89:1 |
| subtle {colors.subtle} | 4.61:1 |
| violet-ink {colors.violet-ink} | 7.04:1 |
| up {colors.up} | 4.83:1 |
| down {colors.down} | 5.12:1 |

**On `{colors.sunken}` (#efedea — the chip at rest)**

| Foreground | Ratio |
|---|---|
| ink {colors.ink} | 14.89:1 |
| body {colors.body} | 9.30:1 |
| muted {colors.muted} | 4.56:1 |

`{colors.subtle}` measures **4.30:1** on sunken and is therefore **not permitted on a chip**. Chip labels are `{colors.body}`.

**On the six note pastels** — every note carries `{colors.ink}` for headings and figures and `{colors.body}` for its caption. Worst case is rose, the darkest of the six:

| Ground | ink {colors.ink} | body {colors.body} |
|---|---|---|
| lilac {colors.note-lilac} | 14.45:1 | 9.02:1 |
| mint {colors.note-mint} | 14.64:1 | 9.14:1 |
| peach {colors.note-peach} | 14.31:1 | 8.93:1 |
| rose {colors.note-rose} | 14.19:1 | 8.86:1 |
| sky {colors.note-sky} | 14.42:1 | 9.00:1 |
| butter {colors.note-butter} | 15.52:1 | 9.69:1 |

`{colors.muted}` measures **4.35–4.75:1** across the six and **fails AA on five of them**. Body copy on a note card is `{colors.body}`, never `{colors.muted}`. This is the single easiest mistake to make in the system, so the CSS now makes it unmakeable: `.note .muted` and `.note .subtle` both resolve to `{colors.body}`, and the habitual class no longer ships a 4.4:1 caption.

The up-delta is the other half of the same trap. `{colors.up}` on a pastel is 4.29–4.43:1 on five of six; the delta line on a note card takes `{colors.up-on-note}` (≥5.10:1 on all six).

**On washes and filled controls**

| Pair | Ratio |
|---|---|
| violet-ink on violet-wash | 6.60:1 |
| yellow-chip-ink on yellow-wash | 5.81:1 |
| up on up-wash | 4.61:1 |
| down on down-wash | 4.63:1 |
| warn on warn-wash | 4.74:1 |
| on-dark on primary (black pill) | 16.67:1 |
| on-dark on chip-active | 16.67:1 |
| #ffffff on violet (violet pill) | 4.81:1 |
| ink on yellow (the hero pill) | 12.66:1 |

**On the dark family**

| Pair | Ratio |
|---|---|
| on-dark on dark | 17.23:1 |
| on-dark on dark-2 (node) | 15.58:1 |
| on-dark on dark-3 (node selected) | 13.84:1 |
| dark-mono on dark-2 | 5.62:1 |
| dark-mono on dark-3 | 4.99:1 |

---

## Typography

### Font Family

**Inter** (`--dn-sans`) carries everything a human wrote, with `font-feature-settings: "cv05", "ss03"` and a root tracking of `-0.011em`. Fallbacks: `ui-sans-serif, system-ui, sans-serif`.

**`ui-monospace` / SF Mono / Geist Mono** (`--dn-mono`) is reserved for strings a *machine* produced: event ids, run ids, durations, timestamps, node ids, `flw_8ac31d`. It is never used for a figure, a heading or prose.

Weights go to **700**, deliberately. Capping the previous system at 500 is a large part of why it read as furniture — nothing on the page had any punch.

### Hierarchy

| Token | Size | Weight | Line Height | Tracking | Use |
|---|---|---|---|---|---|
| `{typography.hero}` | 68px | 700 | 1.02 | -0.035em | The hero line, once per page |
| `{typography.display}` | 46px | 700 | 1.06 | -0.032em | Section openers, screen titles |
| `{typography.title}` | 30px | 650 | 1.15 | -0.028em | Panel and sub-screen titles |
| `{typography.heading}` | 21px | 600 | 1.28 | -0.022em | Card headings |
| `{typography.sub}` | 16px | 600 | 1.4 | -0.014em | Node titles, list rows, delta text |
| `{typography.body}` | 16px | 400 | 1.6 | root | Prose and ledes |
| `{typography.body-sm}` | 14px | 400 | 1.55 | root | Captions under a figure |
| `{typography.label}` | 12px | 600 | 1.3 | +0.02em, uppercase | Eyebrows, column heads |
| `{typography.mono}` | 12px | 500 | 1.45 | 0 | Machine strings only |
| `{typography.figure}` | 52px | 680 | 1.0 | -0.04em | The number on a note card |
| `{typography.figure-sm}` | 32px | 680 | 1.05 | -0.032em | The number in a dense tile |
| `{typography.button}` | 15px | 600 | 1 | -0.014em | Default pill label |
| `{typography.button-lg}` | 16px | 600 | 1 | -0.014em | Large pill label |
| `{typography.button-sm}` | 14px | 600 | 1 | -0.014em | Small pill label |
| `{typography.chip}` | 13px | 600 | 1 | -0.006em | Chip and pill labels |
| `{typography.input}` | 15px | 400 | 1.4 | root | Field values and placeholders |
| `{typography.nav-row}` | 15px | 500 | 1.4 | -0.011em | Sidebar rows (600 when active) |
| `{typography.table-cell}` | 15px | 400 | 1.5 | root | Table body cells |

### The figure

`{typography.figure}` is the most important token in the system and it is **sans, not mono**. 52px at weight 680, `font-variant-numeric: tabular-nums` so it does not twitch when the value refreshes. Mono figures were the previous system's tell and they made a product look like a log viewer. A figure is the *answer*, not a readout on an instrument.

### Principles

- **Tracking tightens as size grows** — from -0.04em on the figure through -0.035em at the hero, easing to the root -0.011em and reaching exactly 0 at the mono.
- **`{typography.label}` is the only token that tracks positive** (+0.02em), because uppercase at 12px needs it.
- **Weight 650 and 680 are real values**, not typos — Inter is variable, and the half-steps are what let the title sit between a heading and a display without jumping.
- **Numeric table cells** take `font-weight: 600`, `{colors.ink}`, tabular figures and right alignment.

---

## Layout

### Spacing System

Base unit 4px. Tokens: `{spacing.xxs}` (4px) · `{spacing.xs}` (8px) · `{spacing.sm}` (12px) · `{spacing.md}` (16px) · `{spacing.lg}` (24px) · `{spacing.xl}` (32px) · `{spacing.xxl}` (48px) · `{spacing.section}` (96px).

- **Marketing section rhythm**: `{spacing.section}` (96px) top and bottom
- **App section rhythm**: `{spacing.section} {spacing.xl}` on band and dark sections; `{spacing.xxl} {spacing.xl}` where the surfaces stack tightly
- **Note card padding**: `{spacing.lg}` (24px) default, `{spacing.xl}` (32px) when the card carries a figure plus a sparkline plus a caption
- **Empty state padding**: `{spacing.xxl}` (48px)
- **Grid gaps**: `{spacing.md}` (16px) inside a note wall, `{spacing.lg}` (24px) between panels

### Grid & Container

- Specimen/marketing page: **1180px** max-width, `{spacing.lg}` gutters
- Dashboard content: **1240px** max-width inside the rail
- Activity content: **1320px** max-width inside the rail
- App chrome: **260px** sidebar, **64px** topbar, both `{colors.canvas}` with a `{colors.hairline}` edge
- Note walls: `repeat(3, minmax(0, 1fr))` on the dashboard; `repeat(auto-fit, minmax(280px, 1fr))` everywhere the count is not fixed
- Flow builder: a `flex: 1 1 640px` canvas well beside a fixed **380px** config panel

### Whitespace Philosophy

Generous between sections, tight inside a note. The 96px section gap is what makes the colour changes read as *rhythm* rather than as stripes. Inside a card the figure gets `margin-top: auto` so the number always sits on the same baseline across a row of tiles regardless of caption length.

---

## Elevation & Depth

Soft and low-contrast, because things on a board float rather than stack. Three levels, all tinted with the ink colour rather than pure black.

| Level | Token | Value | Use |
|---|---|---|---|
| 0 (flat) | — | no shadow | Note cards inside a wall, chips, inputs, table rows |
| 1 (lift) | `--dn-lift` | `0 1px 2px rgba(26,26,26,0.04), 0 6px 16px -6px rgba(26,26,26,0.10)` | Cards, the fixed back-link, notes that need to float off a band |
| 2 (lift-hover) | `--dn-lift-hover` | `0 2px 4px rgba(26,26,26,0.05), 0 14px 32px -10px rgba(26,26,26,0.16)` | Raised/hovered card, the signature radius specimen |
| 3 (pop) | `--dn-pop` | `0 24px 56px -16px rgba(26,26,26,0.24)` | Menus, popovers, modals |

### Selection depth

A selected node uses a **ring**, not a shadow: `box-shadow: 0 0 0 4px rgba(124, 77, 255, 0.22)` plus a `{colors.violet}` border and a lift from `{colors.dark-2}` to `{colors.dark-3}`. Focus-visible is `outline: 3px solid {colors.violet}` at `outlineOffset: 2px` — the same violet, doing the same identity-and-selection job.

### Decorative depth

Depth on this system comes from **colour and rotation**, not from shadow. The specimen hero rotates its four note cards between `-1.2deg` and `+1deg` on a `{colors.band}` plate at `{rounded.xl}`; the flow canvas is a dotted well *milled into* the white page rather than a panel floating on it. Do not reach for `--dn-pop` to make something feel important — reach for a bigger radius and a fill.

---

## Shapes

### Border Radius Scale

Four steps plus the pill, and **the big one is the point**. A single small radius everywhere is what makes an interface read as a form.

| Token | Value | Use |
|---|---|---|
| `{rounded.sm}` | 10px | Inputs, chips with square corners, menu rows, nav rows |
| `{rounded.md}` | 16px | Ordinary cards, panels, node cards, table containers, swatches |
| `{rounded.lg}` | 28px | **The note cards and feature blocks — the signature** |
| `{rounded.xl}` | 36px | Hero panels, full-bleed bands, the canvas well |
| `{rounded.full}` | 9999px | Buttons, pills, chips, avatars, dots |

### Sub-radii

A handful of small square tiles carry their own radius because they are glyph plates, not cards:

- `nav-icon` — 28×28px at **8px**
- `node-mark` — 32×32px at **9px** (40×40px at **12px** in the config panel header)
- Connection avatar — 44×44px at **14px**
- Empty-state glyph plate — 56×56px at **18px**
- Sparkbar — 7px wide at **3px**
- Brand mark tile — 26–28px at **9px**

### Geometry rules

- **Buttons, chips, avatars and dots are fully round. Nothing else is.** A pill-shaped container would compete with the controls, and the controls have to win.
- **Note cards have no border, ever.** A sticky note does not have one. The fill separates the card from the band; adding a hairline on top of a pastel fill is the exact move that turns a board back into a spreadsheet.
- **Cards do have a border** — 1px `{colors.hairline}` — because a white card on white paper has nothing else to separate it.

---

## Components

> Hover states are not documented except `button-primary-hover`, which is the one shift the system commits to. All transitions are `140ms ease` on background-color, box-shadow and transform; `:active` on a button is `translateY(1px)`. `prefers-reduced-motion: reduce` clamps every duration to 0.01ms.

### Buttons

Every button is a pill at `{rounded.full}` with a `1.5px solid transparent` border, so the outlined variant does not shift layout.

**`button-primary`** — the action on the screen. Background `{colors.primary}`, text `{colors.on-dark}`, `{typography.button}`, padding `11px 20px`. Hover moves to `{colors.primary-hover}`.

**`button-secondary`** — Background `{colors.surface}`, text `{colors.ink}`, border `1.5px solid {colors.hairline-strong}`. On the dark band, the border is overridden to `{colors.dark-edge}`.

**`button-violet`** — Background `{colors.violet}`, text `#ffffff` (4.81:1). Only for actions genuinely about identity: "Invite teammate".

**`button-yellow`** — the hero. Background `{colors.yellow}`, text `{colors.ink}` (12.66:1). **One per screen.** On the dashboard it is "New flow" in the topbar and nothing else.

**`button-ghost`** — Background transparent, text `{colors.muted}`. On the dark band it takes `{colors.on-dark}`.

**Sizes** — `button-lg` `15px 26px` at 16px; default `11px 20px` at 15px; `button-sm` `8px 15px` at 14px. Disabled is `opacity: 0.4` with `cursor: not-allowed`.

### The note card — the signature component

**`note-card`** — Background one of the six note pastels, text `{colors.ink}`, rounded `{rounded.lg}` (28px), padding `{spacing.lg}`, **`border: 0`**.

Anatomy, top to bottom:
1. A `{typography.label}` in `{colors.ink}` (the default label colour `{colors.muted}` must be overridden here), with a 9–11px `dot` in the family's mark colour on the opposite end
2. `{typography.figure}` — the settled number, pushed down with `margin-top: auto` so a row of tiles shares a baseline
3. A delta in `{typography.sub}` tinted `{colors.up-on-note}` or `{colors.down}`, with an arrow glyph
4. A `{typography.body-sm}` caption in `{colors.body}`
5. Optionally a `sparkbars` group in the family's mark colour, bottom-right

Six of these in a grid are the dashboard. That wall of colour *is* the design — it is not a decoration applied on top of one.

**Variants** — `note-card-mint`, `note-card-peach`, `note-card-rose`, `note-card-sky`, `note-card-butter`. Also used at smaller sizes for a sidebar summary tile, a conflict row and a step-kind explainer.

### Cards & containers

**`card`** — Background `{colors.surface}`, border `1px solid {colors.hairline}`, rounded `{rounded.md}`, shadow `--dn-lift`. The neutral container: table wrappers, config panels, connection rows, colour-documentation tiles.

**`band`** — Background `{colors.band}`. A full-bleed section.

**`band-dark`** — Background `{colors.dark}`, text `{colors.on-dark}`; every heading token inside it is re-coloured to `{colors.on-dark}`. Exactly one per page, at the end.

**`empty-state`** — Background `{colors.band}`, rounded `{rounded.lg}`, padding `{spacing.xxl}`, centred. Carries a pastel glyph plate, a `{typography.heading}`, a `{typography.body}` explanation and a `button-primary`. The copy states that nothing is wrong: *"The webhook was verified four minutes ago and is waiting on its first delivery."*

### Chips & pills

**`chip`** — Background `{colors.sunken}`, text `{colors.body}`, `{typography.chip}`, padding `6px 13px`, gap 7px, rounded `{rounded.full}`, `1.5px solid transparent`.

**`chip-active`** — Background `{colors.ink}`, text `{colors.on-dark}`. The selected filter.

**`chip-violet`** — Background `{colors.violet-wash}`, text `{colors.violet-ink}`. Identity and selection: the workspace switcher, the "Today" filter, the draft-version badge.

**`chip-yellow`** — Background `{colors.yellow-wash}`, text `{colors.yellow-chip-ink}`. Tags and soft warnings ("Beta", "Stale · 34m"). Note this is the *wash*, not `{colors.yellow}` — it does not spend the once-per-screen hero.

**`chip-outline`** — Transparent with a `{colors.hairline-strong}` 1.5px border. Additive actions and counts.

**`chip-up` / `chip-warn` / `chip-down`** — state washes with their matching state ink, used for row status in the activity table and connection list.

**`dot`** — 9px circle at `{rounded.full}`. The mark colour's primary job. Prefixes a source name in a table row, a nav entry, a chip.

### Inputs & forms

**`text-input`** — Background `{colors.surface}`, text `{colors.ink}`, border `1.5px solid {colors.hairline-strong}`, rounded `{rounded.sm}`, padding `11px 14px`, `{typography.input}`, full width. Placeholder is `{colors.subtle}`.

**`text-input-focused`** — Border becomes `{colors.violet}` with `outline: 3px solid {colors.violet-wash}` at zero offset. This is the only place violet touches an ordinary control, and it is justified because focus *is* selection.

**`focus-ring`** — Everywhere else: `outline: 3px solid {colors.violet}`, `outline-offset: 2px`, applied to every link, button and tabbable element on `:focus-visible`.

Labels above a field are `{typography.label}` with `{spacing.xs}` beneath; helper text below is `{typography.body-sm}` in `{colors.muted}`.

### Tables

**`data-table`** — Full width, `border-collapse: collapse`, wrapped in a `card` with `overflow: hidden` (or `overflow-x: auto` when it must scroll).

**`data-table-header`** — Background `{colors.band}`, text `{colors.muted}`, `{typography.label}`, padding `12px 18px`, left-aligned by default. First and last cells inherit `{rounded.md}` on their outer top corners so the header meets the card edge cleanly.

**`data-table-cell`** — Padding `14px 18px`, `{typography.table-cell}`, `{colors.body}`, bottom border `1px solid {colors.hairline}`; the last row drops its border.

**`data-table-cell-numeric`** — `font-variant-numeric: tabular-nums`, weight 600, `{colors.ink}`, right-aligned.

A mono cell inside a table takes `{typography.mono}` in `{colors.muted}`.

**No zebra striping.** The hairline already separates rows, and stripes plus source dots plus tabular figures is three systems fighting over the same row. The table is the one place the wall of colour would be noise, so the pastels retreat to a single 9px dot per row.

### Sparkbars

**`sparkbars`** — A flex row, `align-items: flex-end`, 40px tall (44–56px in practice), 3px gap.

**`sparkbar`** — 7px wide, 3px radius, `{colors.ink}` at `opacity: 0.18`; **`sparkbar-latest`** is the same bar at `opacity: 1`. When a spark sits inside a note card the bars take the family's mark colour instead, with the trailing bar at full opacity and the rest around 0.42.

Chunky and rounded, never hairline. A one-pixel line chart is an instrument readout; this is a board.

### The canvas

**`canvas-well`** — Background `{colors.dark}` with `radial-gradient({colors.dark-dot} 1.5px, transparent 1.5px)` at `22px 22px`, rounded `{rounded.xl}`, text `{colors.on-dark}`. The **only** dark surface in the product, because the flow builder is a workspace rather than a document. It is milled into the white page beside an ordinary white config panel — light plate, dark well, one row, no shadow doing the work.

**`node-card`** — Background `{colors.dark-2}`, border `1px solid {colors.dark-hairline}`, rounded `{rounded.md}`, padding `{spacing.md}`. Title in `{typography.sub}` at `{colors.on-dark}`; the port/meta line in `{typography.mono}` at `{colors.dark-mono}`.

**`node-card-selected`** — Background `{colors.dark-3}`, border `{colors.violet}`, ring `0 0 0 4px rgba(124, 77, 255, 0.22)`.

**`node-mark`** — 32×32px at 9px radius, filled with the step family's mark colour, holding a white glyph. The same trick the note card plays, one size down and one saturation up: sky for a source, peach for a transform, rose for a delivery.

**`node-edge`** — `{colors.dark-edge}` at 1.5px, orthogonal with an 8px knee, drawn under the cards in **one grey** — never a mark hue, or the canvas becomes coloured spaghetti.

### Chrome

**`sidebar`** — 260px, `{colors.canvas}`, right border `1px solid {colors.hairline}`, padding `{spacing.md}`. Sticky, full height. It ends with a note card so the colour does not stop at the content edge.

**`topbar`** — 64px, `{colors.canvas}`, bottom border `1px solid {colors.hairline}`, padding `0 {spacing.lg}`. Sticky. Carries the brand mark on the left and at most one hero on the right.

**`nav-row`** — `{typography.nav-row}`, `{colors.body}`, padding `10px 12px`, gap 11px, rounded `{rounded.sm}`.

**`nav-row-active`** — Background `{colors.violet-wash}`, text `{colors.violet-ink}`, weight 600, `aria-current="page"`.

**`nav-icon`** — 28×28px at 8px radius. Each row's tile wears its section's pastel with the matching mark as the glyph colour, so the chrome is part of the colour system rather than a grey frame around it. The active row's tile inverts to solid `{colors.violet}` with an `{colors.on-dark}` glyph.

### Shipping surfaces

| Route | What it proves |
|---|---|
| `/design/next` | The specimen. Seven numbered sections alternating band/white, hero note wall, full swatch, type and shape documentation. |
| `/design/next/dashboard` | Six note tiles in a 3-up wall, a source table, three conflict notes, a dark closing band. Rhythm: notes → band → white → dark. |
| `/design/next/builder` | The dotted well beside a white config panel, five node cards, three step-kind notes on a band. One yellow, on the wordmark. |
| `/design/next/activity` | The dense test: a 12-row table with status chips, four connection cards, a three-note summary, a tinted empty state. Rhythm: band → white → band → white → tinted empty. |

---

## Do's and Don'ts

### Do

- **Do** put `{colors.primary}` on every primary CTA. It is the default, and it is what buys the rest of the palette its meaning.
- **Do** give each metric family one note pastel and keep it — tile fill, sparkbar tint, row dot, nav icon — for the life of the account.
- **Do** use `{colors.body}` for body copy on a note card. `{colors.muted}` measures as low as 4.35:1 on the pastels and fails AA on five of six.
- **Do** carry direction in the delta text with `{colors.up}` / `{colors.down}`, and in nothing else — swapping to `{colors.up-on-note}` when the text stands on a pastel.
- **Do** alternate section grounds: `{colors.canvas}` → `{colors.band}` → `{colors.canvas}` → `{colors.dark}`.
- **Do** apply `{rounded.full}` to every button, chip, avatar and dot, and `{rounded.lg}` to every note card.
- **Do** override `{typography.label}`'s default `{colors.muted}` to `{colors.ink}` whenever the label sits on a pastel.
- **Do** spend the one yellow on the highest-value thing on the screen — the wordmark, or the single hero CTA. Not both.
- **Do** show the product as its own illustration: a note wall, a dotted canvas, a real table.
- **Do** use `{typography.mono}` for machine strings and only machine strings.

### Don't

- **Don't put two white sections in a row.** The page collapses into a typography blog, and this is the single most common way to lose the language.
- **Don't use a note pastel as a button.** A `{colors.note-mint}` fill on a pill reads as disabled, not as pressable. Buttons are black, white-outlined, violet or the one yellow.
- **Don't use a mark colour as a card fill**, and don't use a note pastel as a stroke, a dot or a chart series. Fills and marks do not swap.
- **Don't put a border on a note card.** No hairline, no ring, no outline. The fill is the separation.
- **Don't let hue mean severity.** Rose is revenue whether revenue is up or down. Repainting a card to signal "bad" destroys the taxonomy for every other card on the wall.
- **Don't spend `{colors.yellow}` twice on one screen**, and never as a large background surface.
- **Don't use `{colors.violet}` to mean "primary" or "good."** It marks identity and selection: wordmark, active nav, focus ring, selected node.
- **Don't use `{colors.subtle}` on `{colors.sunken}`** (4.30:1) or on any note pastel. It is cleared for `{colors.canvas}` and `{colors.band}` only.
- **Don't colour the flow-canvas edges** with mark hues — one `{colors.dark-edge}` grey, always.
- **Don't set a figure in mono.** `{typography.figure}` is sans at weight 680; mono figures made the previous system look like a log viewer.
- **Don't cap weight at 500.** The previous system did, and that is most of why it read as furniture.
- **Don't zebra-stripe a table.** Hairline plus dots plus tabular figures is already enough structure.
- **Don't reach for `--dn-pop` to make something feel important.** Reach for a bigger radius and a fill.
- **Don't declare these tokens at `:root`.** They live under `.dn`; `globals.css` already owns `--background` and `--primary` and would be silently re-themed.

---

## Responsive Behavior

### Breakpoints

| Name | Width | Key changes |
|---|---|---|
| Mobile (small) | < 480px | Single column. Note walls stack 1-up. Sidebar becomes a sheet. Hero drops to ~36px. |
| Mobile (large) | 480–767px | Note walls 1-up; chips wrap to two rows. Display drops to ~32px. |
| Tablet | 768–1023px | Note walls 2-up via `minmax(280px, 1fr)`. The builder's canvas and config panel stack (`flex-wrap: wrap` at the 640px canvas basis). |
| Desktop | 1024–1279px | Sidebar returns at 260px. Dashboard note wall goes 3-up. |
| Wide | ≥ 1280px | Full presentation: 1180/1240/1320px shells, `{typography.hero}` at 68px. |

### Collapsing strategy

- **Note walls** are `repeat(auto-fit, minmax(280px, 1fr))` almost everywhere and reflow without a media query. The dashboard's fixed `repeat(3, minmax(0, 1fr))` is the exception and needs one.
- **Tables** scroll horizontally inside `overflow-x: auto` on the wrapping `card`; they never reflow into stacked key/value rows, because the tabular alignment is the point.
- **The builder** wraps the 380px config panel below the well rather than shrinking it.
- **Section padding** relaxes from `{spacing.section}` to `{spacing.xxl}` on mobile.
- **Chip rows** wrap; they are never made horizontally scrollable.

### Touch targets

- Default pill: 11px + 15px line + 11px + 3px border = **40px** — below the 44px floor, and bumped to `button-lg` on touch surfaces.
- `button-lg`: **49px** — clears AAA. `button-sm`: **33px**, desktop-only.
- `text-input`: 11px + 21px line + 11px + 3px border = **46px**.
- `nav-row`: 10px + 21px line + 10px = **41px**.
- `chip`: **28px** — a filter affordance, not a primary control; give it a padded hit area on touch.

---

## Iteration Guide

1. Focus on ONE component at a time.
2. Reference component names and tokens directly — `note-card`, `{colors.mark-sky}`, `{rounded.lg}` — never raw hex in a prompt.
3. Before changing a colour, run the contrast check against **both** grounds it can sit on (`{colors.canvas}` and `{colors.band}`, or all six note pastels). Nothing that carries body copy ships below 4.5:1.
4. Add new variants as separate `components:` entries rather than widening an existing one.
5. Default to `{typography.body}` for prose, `{typography.body-sm}` for captions, `{typography.figure}` for the number.
6. Keep `{colors.yellow}` confined to the wordmark or the single hero CTA, and keep `{colors.violet}` confined to identity and selection.
7. New taxonomy hue? Add it as a **pair** — a note pastel *and* its saturated mark — or don't add it. A pastel with no twin cannot draw a chart; a mark with no twin cannot fill a card.
8. When a screen needs a picture, build the picture out of the product.
9. `src/app/design/next/design-next.css` is the authority for values; the four pages under `src/app/design/next/` are the authority for composition. If a page and this document disagree, **the document wins and the page is the bug.**

---

## Known Gaps

Honest list. These are real and unresolved, not hedges.

- **White glyphs on mark tiles are low-contrast.** `{colors.on-dark}` on `{colors.mark-butter}` is 2.38:1, on `{colors.mark-peach}` 2.72:1, on `{colors.mark-mint}` 3.21:1 — under the 3:1 non-text floor. Every one of these is `aria-hidden` beside a text label, so nothing is lost, but the icons are decorative rather than informative and should not be relied on alone.
- **Only two of the four pages end on `band-dark`.** `band-dark` is specified as "exactly one per page, at the end", and the specimen and dashboard have one. The builder ends on a `{colors.band}` strip and activity ends on a white section holding a tinted empty state, so neither page ever reaches the dark. The rhythm is still legal — no two whites touch — but the closing beat the language is built around is missing on half the surfaces.
- **Activity's last two sections are both white.** The note wall and the empty state are separate `<section>`s with no ground between them. They read as one white region because the second has zero top padding and the empty state is itself `{colors.band}`-filled, but nothing in the markup enforces that, and adding padding to the second section would silently produce the two-whites failure.
- **State colours are used as dot fills.** `{colors.up}`, `{colors.down}` and `{colors.warn}` fill 9px `dot`s in the activity filter row, the activity topbar and the builder's status chip. The rule says state lives "only on words and their own washes"; a dot is neither. Small, but it is the crack through which hue starts meaning severity.
- **The dashboard's active nav icon does not invert.** `nav-icon` specifies that the active row's tile goes solid `{colors.violet}` with an `{colors.on-dark}` glyph. The builder and the specimen do this; the dashboard leaves its active tile on `{colors.note-lilac}`, so "you are here" is carried by the row wash alone.
- **The activity note wall's sparkbars are ink, not mark.** `sparkbar` says a spark inside a note card takes the family's mark colour. The "Events" tile on `/design/next/activity` uses the default `{colors.ink}` at 0.18, so the one spark on that screen is grey on mint.
- **No dark mode.** `{colors.dark}` and its family exist for the flow canvas and one inverse band, not as an inverted theme. A full dark scheme would need six dark-ground note equivalents and six re-tuned marks, and none of that has been derived.
- **Hover states are undocumented** beyond `button-primary-hover` and the `translateY(1px)` press. Chips, nav rows, note cards and table rows have no specified hover.
- **No motion system.** The only timing in the CSS is the button's `140ms ease`. Entrance, list reorder, number-ticker and canvas-pan behaviour are all unspecified.
- **`{typography.hero}` at 68px has no responsive step in the CSS.** The breakpoint table above describes intent, not shipped media queries — the pages currently rely entirely on `auto-fit` grids and `flex-wrap`.
- **The default pill computes to 40px tall**, under the 44px touch floor. Handled today by using `button-lg` where touch matters, but there is no `button-touch` token — and `button-sm` at 33px is used in the topbars of all three app screens.
- **Chart tokens stop at the sparkbar.** Six mark hues exist and are ordered, but there is no axis colour, no gridline, no tooltip surface, no sequential or diverging ramp for a heatmap.
- **Icon library is unstated as a token.** All four pages use `lucide-react` at `strokeWidth` 2–2.4 and sizes 13–26px, but stroke weight and size are not tokenised.
- **`{colors.surface}` and `{colors.canvas}` are the same value** (`#ffffff`). They are named separately on purpose, but nothing today distinguishes them, so the distinction is untested.
