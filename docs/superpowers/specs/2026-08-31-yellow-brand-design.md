# The yellow brand

The product's chrome goes from near-black-and-violet to **charcoal-and-yellow**,
against a Figma export of the empty dashboard. This is not a repaint: it inverts
the rule DESIGN.md §4 was built on, so the doctrine, the gate and the kit page
move with the tokens.

Source of truth: the Figma export in the request that opened this work. Where
this spec and that export disagree, the disagreement is written down below with
its reason — there are five, and no others.

---

## 1. The rule that replaces "yellow is scarce"

DESIGN.md §4 said yellow was the hero, **at most once per screen**, and that
violet marked selection. The export spends yellow eight times on one screen (the
mark, the active nav chip, the notification badge, New flow, three step numerals,
the card's cap, the CTA) and gives violet exactly one job: the workspace avatar.

The replacement rule is not a taste call. It is contrast:

| | on `#FFFFFF` | on `#F5F5F5` ground | on `#2E2E2E` band |
|---|---|---|---|
| `#EECF00` as a **stroke or text** | **1.55:1** | **1.42:1** | 8.77:1 |
| `#EECF00` as a **fill**, ink `#1A1A1A` | **11.24:1** | — | — |

> **Yellow fills. Violet draws.**

Every yellow object in the export is a filled shape carrying dark ink. Nothing in
it is yellow text or a yellow line. On a dark surface yellow *can* stroke (8.77:1),
which is why the top bar's progress arc is allowed to be yellow and a link is not.

This rule is enforceable, which the scarcity rule never was: see §6.

## 2. The token split

`--primary` is doing two incompatible jobs today — 36 sites fill with it, ~23
stroke or ink with it. One token cannot be both once it is yellow.

```
--primary            #EECF00   every FILLED object: buttons, active rail chip,
--primary-foreground #1A1A1A   badges, step markers, the card's cap
--marker             #7C4DFF   every LINE and every coloured GLYPH: focus ring,
                               hover borders, selection rings, the today ring
--marker-ink         #6229F0   link text — 6.79:1, where marker-500's 4.41:1
                               is short of AA for body copy
```

The ramps are renamed to match, because a ramp called `brand-*` that is not the
brand colour is a lie waiting to be believed:

- `--color-brand-50…800` → the **yellow** ramp (`600` = `#EECF00`)
- `--color-marker-50…800` → the **violet** ramp (`500` = `#7C4DFF`, unchanged values)

Every existing `brand-N` call site is audited individually: a fill becomes
`brand-*` (yellow), a stroke or ink becomes `marker-*` (violet). There is no
mechanical find-and-replace, because the whole point is that the two cases were
indistinguishable by spelling.

**Free repair.** `--tab-underline` is green `#00d492`, and globals.css already
confesses it measures **1.78:1** on the light ground — "well under the 3:1 an
indicator that carries state is meant to hold… this token needs a light answer of
its own." Under the new rule an underline is a stroke, so it becomes `--marker`:
**4.41:1**. The admitted bug closes as a side effect of the doctrine.

## 3. The band lightens, so elevation inverts

`#0F0F0F → #2E2E2E`. This is the change with the most consequences, and none of
them are the colour itself.

The ink ladder was built to go **down** from the band: `ink-900 #1a1a1a` and
`ink-800 #2b2b2b` are both *darker* than `#2E2E2E`. Leave them and every rail
hover and active row moves the wrong way — a raised surface that recedes.

On a `#2E2E2E` band, **raised means lighter**:

```
--color-ink-950  #2E2E2E   the band itself (rail + top bar), both themes
--color-ink-900  #3A3A3A   rail hover                     1.31:1 on the band
--color-ink-800  #434343   rail raised / active row       1.45:1
--color-ink-700  #5E5E5E   hairline on dark               2.10:1  ← re-solved
--color-ink-400  #A1A1A1   muted text on dark             5.26:1
--color-ink-100  #E8E8E8   body text on dark
--color-ink-50   #FAFAFA   headings on dark
```

`--chrome-line` moves `#48494B → #5E5E5E`. At the old value it measures 1.51:1 on
the new band — it does not disappear, but it stops being the 2.10:1 seam the kit
solved for. `#5E5E5E` restores exactly that ratio.

**The band has no internal seams.** The export draws the rail and the top bar as
one continuous `#2E2E2E` with no line between them, and closes the top bar with
`#2D2D2D` — **1.005:1**, which is no line at all. So the rail's `border-r` and the
top bar's `border-b` both come off. This is DESIGN.md §5's own rule applied
("a rule drawn where two different materials already meet is a rule doing
nothing"): below the bar and right of the rail is `#F5F5F5`, and a 40-point
luminance step needs no help. `--chrome-line` survives for what is genuinely
*inside* the band — the ⌘K keycap, chip outlines on dark.

## 4. One near-black, one hairline

The export carries three near-blacks as ink — `#1A1A1A` (on yellow), `#202020`
(headings), `#2E2E2E` (step numerals) — and two hairlines, `#CFCFCF` (card) and
`#D3D3D3` (buttons, chips). Six counts and four counts apart: indistinguishable on
screen, guaranteed to drift at the first edit. This is the exact near-miss
DESIGN.md opens by arguing against, so they collapse:

- **One near-black: `#1A1A1A`** — already `--color-neutral-900`, already what the
  export sets every button label in. `--foreground` is unchanged; `#202020` and
  `#2E2E2E`-as-ink resolve to it.
- **One hairline: `#D3D3D3`** — `--border`, and `--input` follows it as it already
  does. This is materially harder than today's `#E8E8E8` (1.50:1 vs 1.21:1 on
  white), which is what the export asks for; dividers and table rules harden with
  it. `--color-neutral-200` stays `#E8E8E8` so button press states do not darken.

## 5. Geometry

- `--radius-frame: 0 → 1rem`, applied **top-left only** on the ground, per
  `borderTopLeftRadius: 16`.
- Chrome chips invert: solid `#D3D3D3` fill → **white fill + `#D3D3D3` 1px
  border** (top bar bell, top bar avatar, rail `+`).
- The empty-state card keeps its 6px cap, now `--primary`; `shadow-xl` already
  matches the export's shadow verbatim, and `--radius-2xl` already matches its 16px.

Every measurement in the export is reproduced exactly: 70px rail, 70px bar, 24px
left inset, 40px right inset, 28px chips in 40px slots, 36px chrome controls,
32px card padding, 448px card, 64px title-to-card gap, 20/28px step block,
12px/16px step gaps.

## 6. The three gates move with the tokens

- **`scripts/check-ui.ts`** — the `black-as-primary` rule's rationale literally
  reads *"the product has ONE primary and it is ultramarine"*; rewritten. A new
  **`yellow-as-stroke`** rule fails `text-primary`, `border-primary`,
  `ring-primary`, `stroke-primary`, `fill-primary` and `divide-primary`, so the
  fill/stroke split cannot silently re-merge. This is the rule that makes §1
  enforceable rather than aspirational.
- **`/design`** — swatch captions are pinned to the tokens by
  `tests/design-swatches.test.ts`, so the kit page updates in the same commit or
  the suite fails.
- **`DESIGN.md` / `docs/BRAND_KIT.md`** — §2 (band colour), §4 (the ratio table),
  §7 (furniture) rewritten.

## 7. Where this deviates from the export, and why

Five, all of them deliberate.

1. **`#A3A3A3` micro-label → `#6B6B6B`.** The export's value measures **2.85:1**
   on white, against 4.5:1 required. `--muted-foreground` is 5.68:1.
2. **`font-weight: 700` → `600`.** The kit's ladder is 400/500/600 and
   `check:ui` fails on `font-bold`. The export uses 700 in the top bar only.
3. **`SF Pro` → the shipped `Helvetica Neue`/Inter stack.** SF Pro is not
   licensed for web delivery and renders only on Apple hardware.
4. **The rail keeps six rows, not seven.** The export draws seven icon slots;
   the product has Search plus five destinations. Adding a nav row is a product
   change, not a design one, and inventing a seventh destination is not in scope.
5. **The band's internal seams are removed rather than drawn at `#2D2D2D`.** See §3.

## 8. Scope

Chrome, `ui/` primitives, every app page, and the flow builder. The builder is
**colour only** — no layout, no structure, no interaction changes — per the
standing rule that its design is not to be redesigned.

Dark theme survives and is re-derived from the new palette. The band does not
invert (it is absent from `.dark`, as the `--chrome-*` roles already are); the
ground and the roles get dark answers.

## 9. Verification

`pnpm typecheck` · `pnpm check:ui` · `pnpm test` · `pnpm shot` against the export.
The screenshot is the acceptance test for §5.
