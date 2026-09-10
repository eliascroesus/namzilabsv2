# Namzilabs Brand Kit & UI Guide

The single source of truth for how Namzilabs looks and behaves. Tokens live in
`src/app/globals.css` (`@theme`), primitives in `src/components/ui/`, and the
living render of everything here is `/design`. If this document, the tokens,
and `/design` ever disagree, the tokens win and the other two are bugs.

Benchmarked against Linear, Stripe, Notion, Vercel, Miro and Zapier, and drawn
from the **8 September 2026 Figma** (file `NlTjQFMQPUDLstdmzseeJl`, node
49:5268): **one dark surface and one card above it**, one neutral ramp, one
lime that fills under near-black ink and draws on dark, a **14px** UI base
(`--text-sm`), and a state for everything — hover, focus, empty, loading,
error.

**The thesis: quiet chrome, loud numbers.** This is a reconciliation product —
six tools disagree and the app's job is to answer in one figure you can defend.
So the number and the canvas carry all the presence, and everything around them
is furniture. Furniture that shouts is why most operational tools are
exhausting by 4pm.

---

## 1. Principles

1. **One dark, one card, one hairline.** The page, the top bar, the rail and
   the content area are all `#121214`. The only surface that steps away is the
   card, at `#191919` — and that step measures **1.06:1**, which is to say it
   is not visible on its own.

   This is the SECOND reversal of this principle in four days: one surface,
   then three, and one again. Each followed the Figma in front of it, and each
   was deliberate. What changed is the hairline's job, and it narrowed rather
   than shrank — there is no page/chrome or chrome/panel edge left to draw,
   because a rule between two identical surfaces draws nothing. `#343434` now
   carries the single card edge alone, and a card without its border is not a
   flatter card, it is an invisible one.
2. **Roles, not ramps.** Components say `bg-card`, `border-border`,
   `text-muted-foreground` — never `bg-neutral-800` or `border-neutral-600`.
   Roles are what make a surface change a one-file edit.
3. **Depth is a mirror, not a recess.** On dark, a control (`--control`
   `#202020`, 1.08:1) is a step UP from the card it sits on (`#191919`) and its
   hover (`--accent` `#3A3A3A`, 1.55:1) is a further step up; on light both
   steps go DOWN (`#F4F4F4`, then `#ECECEC`). Getting a surface's own direction
   backwards is depth pointing the wrong way, not a slightly-wrong colour.

   `--muted` shares `--control`'s step in BOTH themes. It used to take the
   panel's value on dark; that value is the CARD now, and a fill equal to the
   card it sits on is a card painted onto itself — the collapse that broke six
   hovers into invisibility the last time these two roles met.
4. **Every interactive element has all five states**: rest, hover, focus-visible,
   active, disabled. No exceptions — including icon buttons, tabs, and nav. And
   **colour never carries state alone.**
5. **Numbers are typeset.** Every metric wears `.tnum` and goes through
   `formatMetricValue`; every date goes through `formatDate`/`formatDateTime`.
   Users never see raw storage keys (`gsheets`) or raw enums (`error`).
6. **Two themes, one vocabulary.** Light and dark are two blocks of the SAME
   role names — `tests/design-swatches.test.ts` fails if a role is declared in
   one and not the other, which is how the metric card once ended up carrying
   ink solved for the opposite surface. `dark:` at a call site is still a build
   failure (§11): a value that differs between themes is a role.

## 2. Color

### The brand ramp — one blue, and the split that finally retired

The kit ran **"yellow FILLS, violet DRAWS"** for one reason: `#EECF00` measures
1.55:1 as a stroke on white and 11.24:1 as a fill under near-black — an *absent*
line and a superb box, so one colour could never do both jobs. The 2024 blue
retired that split by clearing its bar both ways. **The lime brought it back**,
springing the same trap halfway: 1.20:1 on white is not a dim line, it is no
line, so the light theme had to carry a second value (`#4F7A00`) that shared
nothing with the brand but a hue.

**The 10 September 2026 Figma supplies `#568CFF`** (nodes 35:5917 / 35:6331 /
35:6745), and it clears every bar the lime failed:

| | measured | |
|---|---|---|
| `#568CFF` under `#1F1F1F` ink | **5.18:1** | a legal fill |
| `#568CFF` as a stroke on `#121214` | **6.29:1** | a line on dark |
| `#568CFF` as a stroke on WHITE | **3.18:1** | **a line on light** |
| `#568CFF` under WHITE ink | **3.18:1** | not a label — see below |

So the ink **stayed near-black**: `--primary-foreground` is `#1F1F1F` in every
mode, because the reflex answer on a blue fill — white — measures 3.18:1 here
and cannot be read at any size. Node 35:6023 draws `#2E2E2E`; that is 4.27:1 on
this fill, a hair under what a 13px label owes, so the shipped ink is one count
deeper and visually identical.

And the split **retired**: `--marker` is `brand-400` in BOTH themes now, where
the lime forced a fork. `brand-800` survives for the one job 3.18:1 cannot do —
brand-coloured **text** on white — and nothing in the kit spells that yet.

| Step | Hex | Role | Measured |
|---|---|---|---|
| 50 | `#EEF4FF` | wash on light | — |
| 100 | `#DCE8FF` | | — |
| 200 | `#C0D5FF` | | — |
| 300 | `#8FB2FF` | hover of the fill — LIGHTER, because on near-black raised means lighter | — |
| 400 | `#568CFF` | **THE BRAND**: the fill (`--primary`), the stroke (`--marker`) in BOTH themes, and the default chart series | 6.29:1 on `#121214`; 5.18:1 under its own ink; 3.18:1 on white |
| 500 | `#3F73E6` | pressed | — |
| 600 | `#3767D6` | reserved | — |
| 700 | `#3462CF` | reserved | — |
| 800 | `#2F5FD8` | **BRAND-COLOURED TEXT ON WHITE** — the one thing `brand-400` may not be | 5.60:1 on white, where the brand itself is 3.18:1 |
| 900 | `#24489F` | reserved — light hover of a stroke | 8.36:1 on white |

`--brand-soft` is `rgb(86 140 255 / 0.10)`; `--brand-soft-line` is
`rgb(86 140 255 / 0.25)` on dark and `0.30` on light — a 10% wash needs more
ring on the lighter ground to keep an edge.

**Hover now walks UP in BOTH themes**, and losing that asymmetry is a
consequence of the ink rather than a simplification. Blue hovered up on dark
and DOWN on light because the fill carried WHITE ink: brightening it on a light
ground moved it toward the white behind it and the label's contrast fell at the
moment of the press. The lime fill carries near-black, so brightening RAISES the
label's contrast — 12.02:1 at `brand-300` against 11.59:1 at `brand-400`. Both
themes hover to 300 and press to 500, and because a component may not spell
`dark:`, those are roles: `--primary-hover` and `--primary-active`, bridged as
`bg-primary-hover` / `bg-primary-active`.

`--tab-rule` is **not** the stroke above — it is the active tab's 1px bottom
rule, grey in both themes: `--muted-foreground` in `.dark`, `--heading` in
`:root`, bridged as `border-tab-rule`. The tab's TEXT carries the emphasis; the
rule anchors the row, it does not repeat the colour.

| Role | Dark | Light | Bridged as |
|---|---|---|---|
| `--tab-rule` | `--muted-foreground` | `--heading` | `border-tab-rule` |
| `--primary-hover` | brand-300 `#C9FF7D` | brand-300 `#C9FF7D` | `bg-primary-hover` |
| `--primary-active` | brand-500 `#A2E844` | brand-500 `#A2E844` | `bg-primary-active` |

### Contrast substitutions — where the Figma was not followed

Two of the Figma's own greys fail their bar on the ground it draws them on.
Both are substituted, and both are recorded here rather than quietly fixed,
because a value that came from the comp and a value that was solved are
different kinds of fact.

| Figma | Measured | Ships as | Why |
|---|---|---|---|
| `#7E7E7E` — every card title and axis label | **4.33:1** on the `#191919` card those titles sit on | `#828282` (`--muted-foreground`) | Under the 4.5:1 a 14px label owes. Four values brighter, indistinguishable beside it, and legal on both the page (4.87:1) and the card (4.58:1). |
| `#4A4A4A` — the inactive tabs | **2.11:1** on `#121214` | `--muted-foreground` | Below even the 3:1 a non-text *graphic* owes, on a control you are meant to click. An inactive tab nobody can read is a functional bug, not a quiet aesthetic. |

`#4A4A4A` is still used exactly as drawn where it sits on WHITE — the "Today"
and "Refresh All" ink — where it measures 8.86:1.

**And one deviation that ran the OTHER WAY has now RETIRED, which is worth
recording as carefully as it was worth recording when it was live.** The chart
marks were `#B6FF56` in both themes, and on a white card that measures
**1.20:1** — far under the 3:1 a meaningful graphic owes. It was not a
substitution and not an oversight: node 58:5824, the LIGHT frame, drew its bars
and its legend dot at that exact value on white and it was asked for directly.

The 10 September blue closes it without anybody having to argue the point
again: the same `brand-400` measures **3.18:1** on white, so the mark the
Figma draws and the mark the guideline allows are finally the same value. This
row stays in the table because a deviation that quietly disappears reads as one
that was never real.

What makes it a different case from the two greys above is what the colour is
doing. Those carry TEXT, which has to be *read*; a 46px bar or a 3px series line
is *identified*, and it is identified against a white card by shape and position
as much as by contrast. Nothing on a chart carries meaning by colour alone here:
every value goes through `formatMetricValue` into both a tooltip and a headline,
the axis labels are `--muted-foreground`, and the legend names the series beside
its own swatch.

The honest summary is that this one is followed because the design and the owner
both chose it, and it is written down so nobody re-derives it as a bug.

**The white buttons are NOT a substitution, and are worth naming here so they
are not mistaken for one.** Nodes 49:5429 and 49:5439 draw those two controls as
white pills, adjacent and unambiguous. On a `#121214` console a white fill is the
loudest object on screen after the brand, which argues against this kit's own
"quiet chrome" thesis. They ship as drawn.

### The neutral ramp (dark), re-cut for one ground and one card

| Token | Hex | Job |
|---|---|---|
| `neutral-950` | `#121214` | `--background` — **the page ground**, and `--panel` with it |
| `neutral-925` | `#121214` | `--chrome` — top bar and rail. The SAME hex here; a real step in `:root` |
| `neutral-900` | `#191919` | `--card` — the one surface that steps away, at **1.06:1** |
| `neutral-850` (new) | `#202020` | `--control` — fields, the search box, the active nav row |
| `neutral-800` | `#333333` | `--secondary` — grey buttons |
| `neutral-700` | `#3A3A3A` | avatar / icon circles (`--avatar`); `--accent` hover step |
| `neutral-600` | `#343434` | `--border` — every hairline |
| `neutral-500` | `#4A4A4A` | `--rule` — the heavier control edge (switch track, checkbox, table divider); the Figma's own "Main Menu" and inactive-tab grey measures **2.11:1** here and is not text-safe |
| `neutral-450` | `#6E6E6E` | `--faint` — the caps section label only ("Main Menu"), **3.67:1** on `#121214`; never body copy |
| `neutral-400` | `#828282` | `--muted-foreground` — the Figma's own `#7E7E7E` measures **4.33:1** on a card; `#828282` clears **4.87:1** on the page and **4.58:1** on a card |
| `neutral-200` | `#FFFFFF` | `--foreground`, `--heading`, `--card-foreground` — the Figma sets body *and* titles in white |

Step numbers stay labels for the ladder, not a promise of visual distance —
**925 and 950 hold the same hex**, and **900 on 950 measures 1.06:1**, which is
tighter than any step this kit has run. 925 is kept as a token because `:root`
still has a real chrome/page step (white on `#F7F8F9`), and a role declared in
one theme must be declared in both. **500 is still the last step a LINE may be drawn in
and 450 a caps-label-only step; 400 is the first that TEXT may be set in.**
The gap that used to run 500→400 now runs 500→450→400, and 450 is
deliberately narrow: a section label reads at it, a sentence must not.

`neutral-300` (`#B5B5B5`), `neutral-100` (`#E5E5E5`) and `neutral-50`
(`#FAFAFA`) keep their definitions and are re-cut with the rest of the
ladder. No ROLE reads them any more — the Figma's own ink is two values, so
`--muted-foreground` sits at 400 and nothing needs a third — but four files
still spell them directly: `ui/scroll-area.tsx`'s thumb, `ui/switch.tsx`'s off
track, `ui/button.tsx`'s `white` variant, and the flow builder's
`node-meta.ts`, which is out of scope. Deleting a colour token out from under
a live class is the "renders with no colour at all" failure §11's retired-token
rule exists to punish, so they stay — orphaned by the roles, not retired.

**Depth, and the sentence this kit no longer says.** "A control recesses from
a card" was true of one theme and stated as a rule about both. What actually
holds is that the two directions MIRROR: on dark, a field on the `#191919`
card is a step UP (`--control` `#202020`, 1.08:1) and its hover a further step
up (`--accent` `#3A3A3A`, 1.55:1); on light a field on white is a step DOWN
(`#F4F4F4`) and its hover a further step down (`#ECECEC`). Neither is "recessed", and the
Figma contradicts the old wording outright on the dark side.

Shadows: `--shadow-card` is `0 1px 2px rgb(0 0 0 / .20), 0 0 3px rgb(0 0 0 /
.10)` — the Figma's own card shadow, unchanged by theme. Card radius stays
10px; controls 8px (§4); `--radius-frame` comes back at 8px — the panel's
top-RIGHT corner, under the top bar at the end of the row away from the rail,
now that the panel and the chrome are genuinely different colours again,
which is exactly the condition the frame token existed for and lost two days
ago when the whole shell became one surface. **That condition is a dark-theme
fact, not a universal one:** in light, `--panel` is `--background` (`#F7F8F9`)
— the same value the page already is — so the corner it cuts still reveals
nothing there, exactly as it did not two days ago. The frame token is back
because dark has three surfaces again; light never stopped having two.

### The light theme (`:root`), from the Figma's light export

| Role | Hex | Measured |
|---|---|---|
| `--background` (page) and `--panel` | `#F7F8F9` | — |
| `--chrome` (top bar, rail) and `--card` | `#FFFFFF` | — |
| `--border` (hairline) | `#E1E1E1` | — |
| control outline (`--input`) | `#E4E4E4` | — |
| `--control` (search box, active nav row) | `#F4F4F4` | — |
| `--secondary` | `#FFFFFF` with a `--input` outline — the Figma's own grey buttons are white with an `#E4E4E4` edge | — |
| `--secondary-foreground` (that button's TEXT) | `#303030` | **13.2:1** on white |
| icon ink, where a glyph sets its own | `#4A4A4A` | **8.86:1** on white, measured directly — the Figma export's own figure of 8.4:1 is a hair off, most likely a rounding pass on their side. It is a per-glyph choice, not the `--secondary-foreground` role: a label and its icon are two decisions and the export makes them differently |
| `--foreground` / `--heading` | `#000000` / `#313131` (page title, workspace name) | — |
| `--muted-foreground` | `#6B6B6B` — the Figma's own `#8E8E8E` measures **3.28:1** on white, short of the 4.5:1 body text owes; `#6B6B6B` clears **5.33:1** on white and **5.01:1** on `#F7F8F9` |
| `--faint` (caps label) | `#8E8E8E` — the Figma's own `#BABABA` measures **1.94:1**, unreadable at any size | 3.28:1, caps label only |
| `--avatar` (the bell and avatar circles) | `#FFFFFF` with the `--input` outline — the light export finds these by their edge, where dark finds them by a `#3A3A3A` fill | — |
| `--muted` (fill) | `#F4F4F4` — the same step as `--control` | — |
| `--accent` (hover) | `#ECECEC` — one further step down; see the depth note above | — |
| `--rule` (heavier control edge) | `#CFCFCF` — one clear step darker than `--border`, the relationship `#4A4A4A` has to `#343434` in dark | — |
| `--popover` / `--popover-foreground` | `= --card` / `= --card-foreground`, in BOTH themes — a menu is a card that floats, and pointing rather than repeating is what stops the two drifting | — |
| `--primary` / `--marker` | `#568CFF` / `#568CFF` | see the brand ramp above — ONE value in both themes since 10 Sep 2026; `#2F5FD8` (`brand-800`) is kept for brand-coloured text on white |
| `--success` etc. | unchanged (`#00734B` trio) | 5.91:1 on white |
| `--freshness-dot` | `#34C759` on `rgb(0 212 146 / .15)` | 8.36:1 on `#121214` — the one Figma variable actually bound in the file (`Accents/Green`), and untouched by this re-theme. On white the dot keeps its halo: flat `#34C759` alone measures **2.22:1** there, so the halo is load-bearing, not decorative |

### Retired token families

All of these still PARSE as classes; most compile to NOTHING, which is why
they are a build failure rather than a review comment (§11, `retired
token`). The last three rows are a different case, flagged as such:

| retired | use instead | why it existed |
|---|---|---|
| `--ground`, `--ground-ink`, `--ground-ink-muted` | `background`, `foreground`, `muted-foreground` | the page was a different surface from the app's background while a band wrapped it |
| nine `--chrome-*` roles | `border`, `card`, `primary`, `muted-foreground` | the band did not invert with the theme, so it could not use the roles |
| `--period-bg`, `--period-line`, `--period-ink` | `control`, `border`, `muted-foreground` | the period track was the one control that followed the page rather than the band |
| `--tab-underline` | `marker` | — |
| `--marker-ink` | `marker` | see above |
| the `marker-*` ramp | `brand-*` | one ramp; the violet's steps had no twin to keep in step with |
| the `ink-*` ramp | `neutral-*` | it was the dark-surface ladder in a light app; every surface is that surface now |
| `--rail`, `--sidebar`, `--sidebar-accent` | `background`, `neutral-700` | — |
| `--accent-yellow` | `primary` | two yellows four counts apart under two names |
| `.focus-ring-light` | the global ring | the product's ring was invisible on the one dark surface |
| blue `brand-400`/`brand-600` (`#3D9BFF`/`#0070E8`) | `brand-400` at `#568CFF`, with 600 reserved | **not a dead class** — and now a row that has been re-cut TWICE under one name. The 8 September 2026 Figma named a lime and collapsed fill and stroke onto ONE step; the 10 September Figma named a blue and kept that collapse while retiring the light/dark fork as well. `bg-brand-600` has compiled throughout and has painted a mid-blue, then a mid-olive, then a mid-blue again, with nothing reading any of them. A value that changes under a name that does not is exactly the "plausible and wrong" case this table exists to catch in the DOCS, not the code |
| `rounded-full` on `buttonVariants`'s base class | `rounded-control` | **not a dead class either** — the shape rule flipped to a pill and back for the second time (§4); `rounded-full` still compiles on purpose (avatars, the bell badge, the freshness dot, the active-count numeral), so this row is a paper trail for the next flip rather than a dead-class warning |

`neutral-300`, `neutral-100` and `neutral-50` are deliberately NOT in that
table. No role reads them any longer, which is a different thing from being
retired: four files still spell them as classes, so the tokens keep their
definitions and were re-cut with the rest of the ladder. A row here would
invite exactly the deletion §11 exists to prevent.

### State

`--success` / `--warn` / `--danger` are unchanged hex values in both themes,
but they sit on new dark surfaces now and are re-measured rather than carried
over on faith: `#00D492` clears **9.83:1** on the page, **9.74:1** on the
chrome, **9.16:1** on the panel; `#F5A524` clears **9.33:1** / **9.25:1** /
**8.70:1** across the same three; `#FB2C36` clears **5.00:1** / **4.96:1** /
**4.66:1** — the tightest of the three, and still comfortably past 4.5.
Light-theme success is unchanged at **5.91:1** on white.

A new `--freshness-dot: #34C759` (both themes) and `--freshness-halo:
rgb(0 212 146 / 0.15)` replace the tile's re-use of `--success` /
`--success-soft` for the "healthy" dot — the state vocabulary stays separate
from a colour that used to double as the metric card's own "everything is
fine" tint. `--success` itself keeps doing status work everywhere else
(badges, pills); only the tile's freshness dot moves to its own pair.

## 3. Typography

**Inter first**, in both `--font-sans` and `--font-display` (`globals.css`),
with `system-ui`, `-apple-system`, `BlinkMacSystemFont` and `"Segoe UI"`
behind it as the fallback chain.

Inter was **fifth** in both roles until 6 September 2026, behind four keywords
that resolve everywhere in practice — so `next/font`'s self-hosted Inter was
never reached and the product drew in the platform's own UI face, while
`.stat-numeral` and `.wordmark` named Inter directly and so rendered in a
different face from everything around them. `var(--font-inter)` expands to the
hashed face plus a metric-matched `Inter Fallback` cut from Arial, so the
system keywords behind it are only reached where the variable is undefined.

**The display face is deleted.** Instrument Sans ran page titles, the landing
hero and the metric numeral. The distinction this interface draws is between the
chrome and the NUMBER, and a tile's headline dropped from 36px to **28px** in
this pass — the Figma draws it smaller than the console did — but the
separation still does not need a second family: 28px Inter 600 against a 14px
interface still reads as the loudest thing on the tile. `.font-display`
survives as a tracking utility (-0.022em) and `.stat-numeral` is now `28px /
40px`, `font-family: var(--font-inter, "Inter"), var(--font-sans)` — Inter
named explicitly, because the numeral is the one place the Figma names a face
rather than asking for the platform's own.

| token | px | job |
|---|---|---|
| `text-2xs` | 11 | **the micro badge** — ALL CAPS, `tracking-label`, and never prose |
| `text-xs` | 13 | labels, captions, dense controls |
| `text-sm` | 15 | **the interface default** — body, menu rows, table cells, card titles |
| `text-md` | 17 | long-form reading prose only — legal pages, marketing |
| `text-lg` | 18 | — |
| `text-xl` | 20 | the step above a card title |
| `text-display-xs` | 26 | **page titles** (`PageHeader`) |
| `text-display-sm` | 30 | — |
| `text-display-md` | 28 | the tile's headline number — Inter 600, 40px line, via `.stat-numeral` |
| `text-display-lg` | 48 | the landing hero |
| `text-banner` | fluid | the landing's one oversized moment |

**The wordmark is a new, standalone class — not a scale step.** `.wordmark`
sets "Namzilabs" at Inter, 24px, weight **900**, 22px line: the only weight
above 600 anywhere in the kit, and it earns the exemption for one reason —
the Figma names Inter 900 for exactly one string in the whole export, and a
kit that has never bent its own never-700 rule does not get to bend it
quietly now. The weight is declared in the CSS class, never as a
`font-black` utility at a call site, which is what keeps the exception
contained: `scripts/check-ui.ts` reads `.ts`/`.tsx` and never `.css`, so its
`font-bold` rule — which matches the literal class `font-bold` (`\bfont-bold\b`)
and nothing else — still fails the build on that one spelling anywhere in
the app and needs no allow-list entry for the wordmark. `font-black` and
`font-extrabold` are a different spelling of the same idea and the rule
does not catch either; that gap is unrelated to this exception; closing it,
if it is ever closed, is a job for a later pass, not this one. It sits
in the top bar's left slot now; the rail's mark moved out with it (§5).

**No new caption step.** The Figma's header actions ("+ Add", "Today",
"Refresh All" — set in sentence case in the shipped kit, "Refresh all") set
12px/550, and its own body copy's inspector reports
12.11px — both round to the kit's existing `text-xs` (13px) rather than
earning a new named size: the header actions map to the kit's `xs` button
size, and captions stay 13px, the closed scale's nearest step. A 12px step
was considered and rejected for exactly this reason.

**The micro-label voice**, as `.label-micro`: 11px, ALL CAPS,
`--tracking-label`, muted. A status pill, a section heading, a table head and a
group's sort marker all share it. It was four utilities spelled slightly
differently in eleven files.

**A chip is the one small object that is NOT caps.** A badge carries a status —
a word you scan. A chip carries a source or metric name the customer chose, and
setting somebody's workspace name in caps is the product shouting a word it did
not write.

**One name per size**, enforced (§11). Weights are **400 / 500 / 600 — plus
exactly ONE named exception.** `.wordmark` is it, at 900 (above), and it is
one because the Figma names a face and a weight for that single string and
for nothing else. The rail's workspace-switcher badge was considered as a
second and refused: its initial ships at 13px/**600** (`font-semibold`),
because "a one-character badge is not prose" is an argument that would let
every badge in the product off, and the kit's top weight already reads as a
badge at 13px. Every other request for 700 or 900 either Figma export made —
and both made several — ships at 500 or 600 regardless.

## 4. Shape & elevation

**Everything that contains something is 10px** — `--radius-card` and
`--radius-surface` are still the same value, and still true of a card, a
popover and a menu under this Figma as much as the last one.

**Everything you press is 8px. There is no pill, and this is recorded as
the final word on the question.** The shape rule has flipped between a
pill and a rounded rectangle more than once now (see the retired-token
table in §2), and each flip changed the argument along with the answer.
This one does not leave room for a third: the 4 September 2026 Figma is
named here as the reference, and the rule is that a button, a chip's
container, an input, a select, a tab, a nav row and the period switch are
ALL `rounded-control` (8px), full stop. `buttonVariants`' base class drops
`rounded-full` for `rounded-control`; `ui/page.tsx`'s `PERIOD_TRACK` and
`PERIOD_PILL` do the same; `tests/console-theme.test.ts`'s pin flips from
asserting a pill to asserting `rounded-control`. **Circles are reserved for
four things only: an avatar, the bell's unread badge, the freshness dot,
and the tile's "active count" numeral** — nothing that reads as an action
is ever fully round again. The WRAP exception the last pill era needed —
`rounded-control` on a two-line box, because a full radius there renders as
a circle around the words — is no longer an exception to anything: 8px is
simply what every button already is.

**A badge is 4px.** `--radius-frame` is **8px** again — not the 0 it was
cut to two days ago, and not because that reasoning was wrong: it argued
that a notch drawn into a colour identical to what sits behind it draws
nothing, which was true of a single-surface shell. The panel this Figma
drew was `#181818`, meeting a top bar and a rail that were genuinely
`#111111` — a real, if narrow, colour change. The 8 September Figma removes
that surface: page, bar, rail and panel are all `#121214`, so the cut reveals
nothing again and `--radius-frame` is back to **0**. The token has
somewhere to point again. It rounds the panel's **top-RIGHT** corner, under
the bar at the end of the row away from the rail; the rail-side corner stays
square, and nothing about the top bar's own corners changes. That reverses
the convention every earlier era of this shell used (`rounded-tl-frame`, the
corner nearest the rail) and it is the export read literally rather than
corrected toward habit. See Layout (§5). **The corner is a dark-theme
device.** In light, `--panel` is `--background` (`#F7F8F9`) — the page's
own colour — so the same 8px cut reveals nothing there, exactly as the
notch revealed nothing anywhere two days ago; only dark has grown a third
surface for the frame to point at.

**Shadows barely exist here, still.** `--shadow-card` is now the Figma's
own card shadow — `0 1px 2px rgb(0 0 0 / .20), 0 0 3px rgb(0 0 0 / .10)` —
the same value in both themes rather than a dark-only rule with nothing to
floor it on light. The ladder keeps its other rungs so vendored components
compile, and the same two are ever chosen on purpose: `shadow-card` in the
page flow, `shadow-pop` for anything floating, with the floating rungs
keeping their white inset ring on dark — a hairline of light is still the
only thing that reads as height on a near-black surface.

## 5. Layout & spacing

**24px, flat, at every width.** Page gutter, grid gap, and the top bar's own
inset are one number. The gutter used to step (`px-5 / sm:px-8 / lg:px-10`) on
the argument that a 390px window and a 27" display should not ask for the same
margin — right for prose, wrong for a console: the bar's inset cannot step, so
every rung was a width at which the page's content and the bar's content stood
on two different vertical lines, 16px apart at `lg`.

**16px inside a card.** Header band and body alike, closed by a hairline between
them. 24 / 24 / 16 is a rhythm; 24 / 24 / 24 is a page where the space inside a
card and the space between two cards are the same measurement and the cards stop
reading as separate objects.

**And 24 BETWEEN cards, on every grid.** The board's `BOARD_GRID` and the custom
view's `.board-canvas` both gap at 24 now — the canvas was 16, which made it the
one grid in the product whose tiles sat closer to each other than the page sits
to its own edges. Its row pitch moved with it: `ROW_UNIT_PX` 40 → 48, since the
pitch is the 24px row plus the gutter beneath it.

**32px is the control height — every button, select, input, chip, the period
track and the source picker.** The ladder came down from 28/36/44/52.

Measured across a rendered page, the app was running EIGHT control heights
(48/40/36/32/28/26/24/18). The worst was **28-beside-32**: four pixels apart is
a near-miss, and it reads as a rendering fault rather than as a size choice. So
`sm` resolves to `default`'s 32, fields follow the button (they are stacked in
every form, which is where the mismatch is unmissable), chips match, and the
period track is 32 with its segments filling it edge to edge, so the
whole control stands at the height of the buttons either side of it.

**16px inside every card, including the metric tile.** It ran `p-5`; one tile
padded four pixels wider than every other card on the same board is the
near-miss that makes a row of tiles look hand-placed.

**The shell's geometry is tokenised**: `--spacing-rail` (56), `--spacing-rail-open`
(260) and `--spacing-topbar` (44 content, 60 with padding). Those numbers appear
in four files including the loading skeleton, and `tests/page-width.test.ts`
pins them — including **both hairlines**, which now take real pixels, so a ghost
without them jumps the page 1px in each axis at hydration.

**The top bar now carries the wordmark, and the rail does not.** Full
width, 60px, `--chrome` fill, `--border` bottom rule. Left: `.wordmark` —
moved out of the rail, because a name that only appears once per session
should not live inside a column that is 56px wide most of the time.
Centre: "Welcome back{, name}!". Right: Invite members and New flow as
`secondary` 32px buttons with 16px icons, the bell (a 32px `--avatar`
circle with its badge count), the avatar circle (initials, 13px/600).
**No metrics-setup ring.** The export has none, and the progress it
reported is already on the dashboard's own setup checklist with room to say
what to do next — a 24px arc in the chrome was the same claim with no room
for the second half. The arc, its `METRIC_GOAL` cap and the whole
`metricCount` chain that fed it (page → `AppShell` → `AppFrame` → `TopBar`)
came out together. `#topbar-slot` and `#topbar-status` — the two portals the
flow builder's own chrome uses — are unchanged; the builder's toolbar still
lands in the same bar, it is just a bluer, three-surfaced bar underneath it
now.

**The rail's dressing changed; its behaviour did not (decision 3).** It is
still a hover rail: 56px of icons at rest on `--chrome`, opening in place
to 260px. What used to be a bare icon column now expands into, top to
bottom: a workspace switcher row (a 28px `rounded-control` square tinted
`rgb(0 123 255 / .75)` carrying the initial in white at 13px/**600** — the
kit's own top weight; the export's 700 here is one of the several §3 does
not follow — the workspace name at 15px/600, and a chevron), a
search field that IS a real `Input` (`--control` fill, `--border` outline, a
magnifier, "Search") — you type into it, and the column below swaps its rows
for the matches: pages, the workspace's views, and the theme trio. ⌘K focuses
it. It was a Button styled as a field, opening a palette nobody had built, a "Main Menu" caps label in
`--faint` at 13px (`text-xs` — the scale has no 12px step, per §3), nav
rows at 36px with 18px icons (the active row takes a `--control` fill
UNDER its glyph, which keeps `text-marker` on top — two signals, not the
Figma's one; see §2), Dashboard's sub-items at 32px indented under an 8px dash
marker, and at the foot a full-width `primary` "New flow" button above a
"Get Free Access" row (a bell icon carrying a small blue dot, the label
muted). The collapse/pin cookie behaviour — what actually opens and
closes the column — is untouched; only what is drawn inside it changed.

**The panel takes the corner, not the frame.** `AppFrame` renders the top
bar above a row of `[rail | panel]`; the panel is `--panel` with an 8px
**top-right** corner under the bar, and a square top-left where it butts
against the rail behind a hairline. Every earlier era cut the rail-side
corner instead; this one follows the export, which softens the far end.
`shell-skeleton.tsx` mirrors the geometry by hand, same as it always has,
and `tests/page-width.test.ts` is the pin that keeps the mirror honest —
including a negative assertion on `rounded-tl-frame`, because a convention
that old comes back on its own otherwise.

**Phones.** Below `md` (768px) the rail does not render at all —
`Sidebar`'s `<aside>` is `hidden md:block` — because a hover surface has
no equivalent under a finger; a permanently-open 56px column would be a
worse answer than no rail. In its place the top bar grows a 32px menu
button (`ghost` `icon`, `bg-avatar`, the hamburger glyph) ahead of the
wordmark, and pressing it opens a 280px left drawer (`ui/sheet.tsx`,
`--chrome` fill, `--border` edge) rendering `RailContent` — the same
export the expanded rail renders, not a copy — end to end: the workspace
switcher, the search field, the "Main Menu" label, the nav with
Dashboard's sub-items, and a foot of New flow, Get Free Access and, only
here, Invite members (a top-bar control above `md`; below it the bar has
room for the menu button, the mark and the avatar and nothing else, so it
rides down into the drawer's foot instead of being dropped). The drawer
closes on any navigation and, separately, the instant the viewport
crosses `md` — a `matchMedia` listener actually calls `setOpen(false)`
rather than leaving `md:hidden` to paint over a dialog whose overlay,
scroll lock and focus trap all stay attached regardless of what a class
hides. Its rows are 44px (`min-h-11`) against the rail's 36; the greeting
drops below `sm` (`max-sm:hidden`); the bell keeps every width, the one
circle that does. Below `md` the board itself renders one column
(`BOARD_GRID`: `md:grid-cols-2 xl:grid-cols-3`) and the page header stacks
— Task 20's own shipped rule, folded in here for completeness.

## 6. Components (`src/components/ui/`)

`Button` (**12** variants × 6 sizes — every clickable. There is ONE height for
a button with a label, 32px at 14px type, spelled either `sm` or `default`
(they are the same rung); `lg` is 40 for the landing's hero; the three icon
rungs are icon-only affordances in dense rows. The `xs` rung — 24px at 12px —
was deleted on 6 September 2026: it had ended up on the dashboard header's
three buttons, which left them visibly shorter and quieter than the
identical-looking buttons in the top bar above them. The **workhorse is a
bordered card chip**, not a
solid fill — which is what a console's ordinary act looks like, and which is why
the PRIMARY act has to say so: `SubmitButton` defaults to `accent`, because a
submit is the primary act by definition and "Save" rendering as the same object
as "Cancel" is a form with no primary),
`Card` (card/surface/**tile** × none/dense/compact/default) with
**`CardHeader`/`CardTitle`/`CardDescription`/`CardBody`** — the ruled head, which
is what makes a card's name a title without spending a size step or a weight on
it, and why every card title is the same 15px/500 as the body under it,
`MetricCard` (`src/components/metric-card.tsx` — the board's one tile shell),
`Input`/`Textarea`/`NativeSelect`,
`FieldLabel`/`FieldHint`/`FieldError`, `StatusPill` (5 tones, optional dot) /
`Badge`, `Switch` (2 sizes), `Chip` (filter chip + count, 8px `rounded-control`), `Modal`/`ModalTitle`
(one scrim: `bg-neutral-950/40 backdrop-blur-sm`; focus-trapped, scroll-locked), `TableShell`/`Table`/`THead`/
`TH`/`TBody`/`TR`/`TD`, `Toast` (dark, bottom-center, optional action),
`EmptyState`, `Skeleton`, `PageContainer`/`PageHeader`/`SectionHeading`,
`LegalPage`/`LegalSection`/`LegalLink`/`LegalList` (privacy + terms).

Hand-rolling any of these is a defect. Links dressed as buttons use
`buttonVariants()` — never a re-typed class string.

**What this pass actually touches in these files, without changing what any
of them mean:** `Button`'s base class carries `rounded-control` rather than
`rounded-full` (§4); its `secondary` variant paints `bg-secondary
text-secondary-foreground` with an `--input` outline — the Figma's own grey
buttons are white with a hairline edge in light, a `#333333` fill in dark,
and `--input` aliases `--border` there so the one spelling covers both. The
brand fill is the `accent` variant (`bg-primary` under
`text-primary-foreground`); there is no variant literally named `primary`,
and prose that says "primary button" means this one. Sizes are untouched —
32px is still the default height in both themes — and `xs` (24px, 13px
type, 14px glyphs) is the header row's rung, with a `[&_svg]:size-4`
override wherever the export draws 16px icons on it. `Card` fills with
`--card`, edges with `--border`, and floats on `--shadow-card`, all three
carrying new values from §2 without a line of the component changing.
`Tabs`' line variant draws its active rule from `--tab-rule` — grey in both
themes (`--muted-foreground` on dark, `--heading` on light), not the blue
stroke — and keeps 8px corners; the active tab's own text carries the
emphasis, at 15px/600 in `--heading`.
`Avatar`'s fallback initials and its group-count overflow chip both fill
with `--avatar` now, the same token, so a stack of avatars and the "+3"
that follows it are one material. `Input`'s `Textarea` takes
`rounded-control`, and its two stale `9999px` comments (left over from the
pill era before this one) are corrected to say what the class actually
renders. `ui/page.tsx`'s `PERIOD_TRACK` and `PERIOD_PILL` both move to 8px
corners — the calendar's month stepper is what still wears them, and its
two arrows drop the `rounded-full` override that would have left circles
inside a rectangle. `Select` was already `rounded-control` on both its
trigger and its items: verified, not changed.

`PageHeader`'s title is centred whenever a caller passes the new `tabs`
slot — tab strip left (an active tab at 15px/600 in `--heading` with a 1px
`border-tab-rule` bottom rule — grey in both themes, never the blue stroke —
and a "…" menu; inactive tabs 15px/500, muted; a 28px `secondary` "+"
square), the title itself centred at 26px/600
with its pencil, and the actions right. The dashboard is the one caller,
and its three actions are the export's: a **"Today ▾" dropdown** (`secondary`
`xs`, a 16px calendar glyph, the selected preset's label, a chevron — a
`Popover` holding a month grid) in place of the old six-segment period track.
It lists no presets as of 7 Sep 2026 — it opens a CALENDAR, and a window is two
clicks (or the same day twice). The window still rides in `?range=`, spelled
`YYYY-MM-DD..YYYY-MM-DD`; a picked pair that happens to equal one of the six
precomputed windows is canonicalised back to that preset, so the common cases
stay instant and two URLs never cache one answer twice; **"+ Add"** on
the brand fill at `xs` with a 16px plus; and **"Refresh all"** `secondary`
`xs` with a 16px refresh glyph. Blue is spent on "+ Add" and "New flow",
and on nothing else in the header.

## 7. Interaction

- **Focus is declared once, in `globals.css`.** A zero-specificity
  `:where(a, button, summary, [role="button"], [role="switch"], [tabindex])
  :focus-visible` outline covers every control in the product. Components must
  **not** re-spell a ring and must **not** set `outline-none` — that switches
  the shared rule off. There were 122 hand-written copies of this one idea
  before it was centralised, at four different alphas, with four controls
  carrying no focus state at all. There is no `.focus-ring-light` any more —
  it existed when the ring was violet and one surface was charcoal; every
  surface is that surface now.
- **The pointer does not ring.** `input-modality.tsx` stamps the last input
  device on `<html>`, and a twin rule beside the outline silences it under
  `html[data-modality="pointer"]`. This is not a softening of the rule above:
  after a Tab, an arrow or any typed key the ring returns in full. It exists
  because `:focus-visible` fires under a pointer in two cases this app hits
  constantly — Radix moves real DOM focus onto a menu row on `pointermove` and
  back to the trigger on close, and a clicked control keeps focus until the
  next keydown re-tests it. The two selectors are pinned equal by
  `tests/focus-modality.test.ts`; a control that rings must be able to stop.
  Text fields are the one exception, and keep border-plus-halo (`ui/input.tsx`):
  a field is a place you are *in*, not a thing you pressed.
- **A filter answers on the press, not on the response.** Anything that
  re-renders the page from the URL (the dashboard's range and source) goes
  through `board-controls.tsx`: the pressed control goes active immediately,
  the content it governs swaps to **content-shaped skeletons**, and the URL
  still updates inside a `useTransition` so back and shared links keep working.
  Controls stay real `<a href>`s — middle-click and the pre-hydration paint
  depend on it. Never dim the old numbers instead: a legible figure under a
  chip that now says something else is a wrong answer shown confidently.
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
- **Skeletons hold the real shape.** `Skeleton` is `foreground/15` (an alpha, so
  it reads on the ground *and* on a card) and is sized at the call site
  to the thing it stands in for — a route's `loading.tsx` should be its page's
  own layout in grey, not three bars. A skeleton that doesn't match its content
  moves the jank later instead of removing it.
- **Hover:** neutral hovers are `hover:bg-accent` — depth's mirror rule (§1,
  §2): on dark a field is a step UP from the surface (`--control` `#202020`
  on `#191919`) and its hover a further step up (`--accent` `#3A3A3A`); on
  light a field is a step DOWN (`--control` `#F4F4F4` on white) and its hover
  a further step down (`--accent` `#ECECEC`). Never `hover:bg-muted`, which
  was briefly the same value as `--card`, so six controls had an invisible
  hover. Primary hovers through a
  role rather than a literal, because a component may not spell `dark:`:
  `hover:bg-primary-hover` walks the fill **UP** on dark (600 → 500) and
  **DOWN** on light (600 → 700); `active:bg-primary-active` presses to 700 on
  both. That inverted with the surface — on a light page the brand had to
  darken, because brightening it moved it toward the white behind it and the
  label's contrast fell at the moment of the press (white clears 5.22:1 at
  light's hover step; dark's hover trades down to 3.98:1 for the same "raised
  means lighter" feel). Never `hover:brightness-*` on the brand either way.
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

**Marks are the BRAND, and since 10 Sep 2026 the brand and the marker are the
same value anyway.** The Figma's own chart draws its series in the same blue as
its buttons: `--color-brand-400` (`#568CFF`, node 35:7208) is the default
series colour, an area fill under a line is `rgb(0 123 255 / .12)` — which
`Sparkbars` spells `bg-brand-500/12`, up from the 5% it had inherited, keeping
its 25% border — and a bar is `#568CFF` flat.

**The comparison series is the one mark that had to be RE-CUT rather than
re-pointed.** It was `#5AA9E6`, a blue, chosen because the series beside it was
lime — two hues a reader can tell apart. Both are blue now, so hue is no longer
available and the separation moved to **lightness**, which is also the one
channel every kind of colour-blind reader keeps: `--series-compare` is a
desaturated slate (`#7A90B8`, 3.23:1 on white; `#7F93B5` on the dark card),
unmistakably behind the subject and never competing with it. Node 35:7212 draws
it `rgba(10,151,213,0.5)`, which flattens to `#84CBEA` on white and measures
**1.79:1** — an absent line, and one of this pass's two substitutions. Target-met
stays `success`; bottleneck stays `danger`; tracks stay `bg-muted`.
Headline numbers per §3 — 28px now, not 36, and inked with `--heading`
rather than inherited, which is the same white in dark and `#313131` in
light. One `Sparkbars`/`TargetBar`/`GroupBars`/`Delta` implementation in
`src/components/charts.tsx`, shared by every tile.

**A comparison series steps down to the ramp's 300 (`#66B2FF`)** — one
series at two strengths, not two hues competing. *This row is documentation
and nothing else today*: nothing in the product plots a second series, so
there is no consumer to point at the token and none was invented to give
the line something to do. It is written here so the first chart that needs
one does not pick a colour.

*Why the series left the marker.* The marker argument two days ago was
that a bar is a shape read by its edge, with no ink of its own to carry
contrast — true when the brand was a stroke colour with nothing to spare
for a second job. This blue already carries two jobs (§2: a stroke *and*
a fill), and the Figma's own chart uses the fill job for its series, so
the marker no longer needs to cover for it. `GROUP_ACCENT` in the flow
builder is untouched — the canvas is out of scope regardless of which
token wins here.

**`TargetBar` drew two states in one colour**, back when success WAS the brand:
"met" in `--success` and "in progress" in `--marker` rendered identically, so it
stopped reporting the only thing it exists to report. The two are different
colours again, but the fix stands on its own: the unmet meter is **greyscale**
and colour ARRIVES when the goal lands. A bar at 40% is not good, it is 40%.

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

**One card. It does NOT wear its column on its leading edge any more — on
the default board.** Every tile on the groups board — a materialized flow
Output and a legacy `metrics` row alike — renders through `MetricCard`. The
Figma draws no coloured edge on a metric tile at all, and the kit follows
it: the 4px `--tile-edge` strip is removed from the default board's
rendering. The property went with it on 6 September 2026. It was kept for
two days on the belief that the canvas board still read it — that turned
out to be false, so the lane in `board-column.tsx` was publishing a custom
property with no reader anywhere in the app, and the one-child flex wrapper
in `MetricCard` that used to hold the strip went at the same time. It had
been three components that drifted
into three different cards in one grid, one of them carrying a comment
claiming it was "kept in step with FlowTile's shape on purpose" while
disagreeing on the shell, the padding, the title recipe and the footer.
The reader cannot tell which table a number came from, and should not be
able to.

The card is one block of padding, `p-4`, with no coloured edge. The
leading-edge idea survives only in the builder, where a step card draws its
group's colour directly and needs no inherited property to do it. Content
still takes the slack (`flex-1
justify-center`, so a bare scalar centres instead of hanging off the top
of a stretched card) and the footline is still welded to the bottom,
because a ragged row of footers is §5's difference between a board and a
pile — losing the coloured edge does not mean losing the discipline that
made the tile readable without it.

**The tile FOLLOWS the theme, and the light island it used to be is gone.** It
was pinned white in dark by `dark:bg-white`, which changed the surface and not
the ink, so every muted label on it measured **2.52:1** against 4.5 required.
That was patched with a `tile-surface` class that re-pointed the whole role block
at its light values for one subtree. Both the pin and the patch are gone, and
with both themes reading the same role tokens — no per-subtree override left —
the whole class of bug is unreachable: there is no second set of
role values for a surface to be pinned against.

**Heat is magnitude, never judgement.** The calendar tints each day by its
share of the month's largest day, in the brand — `color-mix(in srgb,
var(--color-brand-600) 12–56%, var(--card))`, one ramp in both themes: white
on the deepest dark cell (`#3767D6` at 56% over `#121214`) is 9.62:1, black on
the deepest light cell is 9.14:1 — re-measured for the blue, and both still
clear of the bar the old lime numbers cleared. It is a tint under a numeral, the shape
`--accent` already takes behind a selected row — a SURFACE, not a verdict.
Green-good/red-bad is the same mistake a coloured delta would be, which is why
this stays the same hue as the fill rather than borrowing `--success`'s: HOW
MUCH, never HOW WELL. A **negative** value is the single exception and takes
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

`pnpm check:ui` (`scripts/check-ui.ts`) gates **fourteen** rules: stock
type/radius/shadow classes, the nine retired type aliases, `font-bold`, raw
chromatic palette classes, **`retired accent-yellow`**, **`retired token`**,
**`dark: variant`**, **`re-spelled icon weight`**, hex literals outside the
five sanctioned paths, bare `toLocale*()` outside `format.ts`, text glyphs
used as icons, and raw `<button>` outside the primitives and the builder's
bespoke chrome. Each rule carries a per-path allowlist with a stated reason
— "it's fine" is how the next drift gets waved through.

**`retired token` is the rule this re-theme earned the hard way.** Retiring a
COLOUR token is not like retiring a size token. An unresolved `text-micro`
renders at the inherited size — wrong, and visible. An unresolved
`border-marker-300` renders with **no border at all**, so the selected step in
the flow builder stopped having an edge; an unresolved `text-marker-ink` renders
in whatever colour its parent happened to be. Both look plausible, neither
throws, and the build passed. Twenty-seven ramp classes and three ink classes
survived the sweep that deleted their tokens and were found by grepping. The
rule carries the full substitution table in its own comment (and §2 above).

**This pass adds two more rows to §2's table rather than a new mechanism.**
The cyan ramp's own values (`#00CDF5`/`#00C0E8`) are retired now that the
ramp holds `#568CFF` instead — a class name that keeps compiling
under a new value is not the same failure a dead class is, but it earns a
row for the same reason: a value that changed under a name that did not is
exactly the kind of fact a comment forgets and a table does not.
`rounded-full` on `buttonVariants`' base class is the second row, and it is
the one to read carefully — the CLASS still compiles (avatars, the bell
badge, the freshness dot and the active-count numeral all keep using
`rounded-full` on purpose), so nothing here is a dead-class failure either.
The row exists because this is the shape rule's second flip (§4), and a
rule that has flipped twice with no paper trail is a rule a third flip will
not bother explaining either.

**AND `scripts/check-ui.ts` GAINS NOTHING, WHICH IS THE FINDING.** The
obvious move — "add the cyan names to the retired-token rule" — does not
apply, and it is worth writing down why so nobody adds them later. That rule
matches deleted TOKEN NAMES rendered as classes (`bg-ink-400`,
`text-marker-ink`), because an unresolved colour utility renders with no
colour at all and looks plausible. No name is retired here: `brand-500` and
`brand-600` both still exist and still compile — only their VALUES moved, and
a value cannot be caught by a rule that reads class names. The old cyan
HEXES, meanwhile, are already a build failure anywhere in a component under
the generic `hex literal` rule, which bans every `#xxxxxx` in `.ts`/`.tsx`
outside five sanctioned paths. The `font-bold` ban needs no widening either:
`.wordmark` declares its 900 in CSS and `check-ui.ts` reads `.ts`/`.tsx` only
(§3). The radius
set already keeps `full` for avatars, badges and dots (§4). So the cyan's
retirement is recorded in the table above — where a value that changed under
a name that did not actually belongs — and the gate is left alone.

**`dark: variant`** exists because `@custom-variant dark` is deliberately
KEPT in `globals.css`. Deleting it hands `dark:` back to Tailwind's default
`prefers-color-scheme` binding, where a stray class would fire on half the
machines loading the page with nobody here able to see it. So the variant
compiles, matches nothing, and this rule stops the dead spelling accumulating.

**Two rules retired with the design they policed.** `yellow-as-stroke` failed
the build on `text-primary`, `border-primary`, `ring-primary` and their kin,
because those classes point at a live token — they COMPILE, the build passes,
and the link renders at 1.55:1 on white. It was the best rule in the file and
its measurement is gone: the blue clears **6.65:1** on the page, **6.59:1** on
the chrome and every card, **6.20:1** on the panel, and **5.80:1** on white —
a stroke that clears its bar on every surface in both themes, which is the
exact finding the retired rule existed to force. `black-as-primary` banned
`bg-neutral-900` as a near-black frozen at one exposure; there is one
exposure, and that value is now the CONTROL surface every select legitimately
names.

**`retired accent-yellow` is a third rule, and it is not one of the two
above.** It is still active, unrelated to either retirement, and unrelated to
the blue re-theme: `--color-accent-yellow` was deleted when yellow stopped
being the brand, two re-themes ago, and the class survives compiling to
NOTHING — exactly the "renders with no colour at all" failure this whole
family of rules exists to catch. It does not fold into `retired token`; it
predates it and still runs beside it.

Three of these rules exist because the gate was PASSING while the drift it exists
to stop was in the tree: two legal spellings of 12px, a fourth font weight in the
newest file in the product, and thirty classes rendering as nothing. A rule that
only bans what nobody was doing reports health it has not checked. Every rule
added here is sabotage-verified — introduce the violation, watch it fail, put it
back.

`tests/design-swatches.test.ts` closes the last gap between the three sources of
truth: `/design` prints hex captions beside token-rendered swatches, and that
test fails if any caption disagrees with `globals.css`. It exists because a
re-theme moved fifteen values and, for one render, the kit page showed
ultramarine tiles labelled with the old indigo hexes — correct swatches,
confidently wrong documentation, and nothing anywhere to catch it. It now also
asserts that **no `.dark` block has reappeared** in `globals.css`: a second role
block means either the light theme came back without this document hearing
about it, or forty roles are being kept in step by hand again.

`tests/page-width.test.ts` pins the shell's three bands and both of its
hairlines, class for class, across `top-bar.tsx`, `sidebar.tsx` and the
hand-copied `shell-skeleton.tsx`.

Belt and braces: the stock namespaces are also **cleared** from the theme
(`--text-*`, `--radius-*`, `--shadow-*` set to `initial` in `globals.css`), so
a banned size, radius or shadow does not merely fail review — it compiles to
nothing and is visible on the page.
