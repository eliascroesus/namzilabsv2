# Namzilabs Brand Kit & UI Guide

The single source of truth for how Namzilabs looks and behaves. Tokens live in
`src/app/globals.css` (`@theme`), primitives in `src/components/ui/`, and the
living render of everything here is `/design`. If this document, the tokens,
and `/design` ever disagree, the tokens win and the other two are bugs.

Benchmarked against Linear, Stripe, Notion, Vercel, Miro and Zapier, and drawn
from the 4 September 2026 Figma: **three dark surfaces meeting at one
hairline**, one neutral ramp, one blue doing a stroke's job and a fill's,
a 14px UI base, and a state for everything — hover, focus, empty, loading,
error.

**The thesis: quiet chrome, loud numbers.** This is a reconciliation product —
six tools disagree and the app's job is to answer in one figure you can defend.
So the number and the canvas carry all the presence, and everything around them
is furniture. Furniture that shouts is why most operational tools are
exhausting by 4pm.

---

## 1. Principles

1. **Three darks, one hairline.** The page is `#0F1011`; the top bar, the
   rail and every card share `#111111`; the content panel under the top bar —
   where the board and its tiles actually sit — is `#181818`. That is three
   surfaces where the two-day-old console ran one, and they sit within a hair
   of each other on purpose: `#111111` on `#0F1011` measures **1.01:1**,
   `#181818` on `#0F1011` measures **1.07:1** — both TIGHTER than the 1.14:1
   step the previous scheme ran between its one ground and its cards. `#343434`
   is still the one hairline value that separates them anyway, because a
   surface change nobody can see without its edge is not a flatter surface, it
   is an invisible one — the same argument as two days ago, now covering three
   surfaces instead of one.
2. **Roles, not ramps.** Components say `bg-card`, `border-border`,
   `text-muted-foreground` — never `bg-neutral-800` or `border-neutral-600`.
   Roles are what make a surface change a one-file edit.
3. **A control recesses; a hover raises.** `--control` is a step DOWN from the
   card it sits on and `--accent` is a step UP. Getting this backwards is depth
   pointing the wrong way, not a slightly-wrong colour.
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

### The brand ramp — one blue, two jobs

Two days ago the kit ran cyan in three shapes: a ring for identity, a glyph
for location, a fill for action. The Figma this pass builds from does not
mark location with the brand at all — the rail's active row is a **neutral**
`--control` fill with a `--border` edge, not a coloured glyph — so the "glyph
is location" job retires with the cyan that carried it, and colour is left
doing exactly two things: drawing a **stroke** and painting a **fill**.

| Step | Hex | Role | Measured |
|---|---|---|---|
| 50 | `#E6F2FF` | wash on light | — |
| 100 | `#CCE5FF` | | — |
| 200 | `#99CBFF` | | — |
| 300 | `#66B2FF` | | 8.51:1 on `#0F1011` |
| 400 | `#3D9BFF` | **THE DARK STROKE** (`--marker` in `.dark`): links, focus ring, active tab rule, selected edge | 6.65:1 on `#0F1011`, 6.59:1 on `#111111`, 6.20:1 on `#181818` |
| 500 | `#007BFF` | **THE BRAND**: hover of the fill, the workspace initial tint (`rgb(0 123 255 / .75)`), decorative dots, chart series default | 4.79:1 as a stroke on `#0F1011` |
| 600 | `#0070E8` | **THE FILL** (`--primary`, both themes) under white ink | 4.68:1 white-on-fill — the Figma's own `#007BFF` measures 3.98:1 under white, short of the 4.5:1 a 15px label owes, so the fill sits one step deeper than the brand it is named after |
| 700 | `#0069D9` | pressed | 5.22:1 under white |
| 800 | `#0062CC` | **THE LIGHT STROKE** (`--marker` in `:root`): links, ring, active rule on white | 5.80:1 on white |
| 900 | `#0056B3` | reserved — light hover of a stroke | 7.04:1 on white |

`--primary-foreground` is `#FFFFFF` in both themes now — it was near-black
under cyan, because `#00C0E8` needed a dark ink to clear its bar and `#0070E8`
needs a light one. `--brand-soft` is `rgb(0 123 255 / 0.10)`; `--brand-soft-line`
is `rgb(0 123 255 / 0.25)` on dark and `0.30` on light — a 10% wash needs more
ring on the lighter ground to keep an edge. **Hover still walks UP the ramp on
dark** (600 fill → 500 on hover) **and DOWN on light** (600 → 700): brightening
a fill under the pointer moves it toward the white page behind it on a light
surface, and the label's contrast falls at the exact moment of the press.

### The neutral ramp (dark), re-cut for three surfaces

| Token | Hex | Job |
|---|---|---|
| `neutral-950` | `#0F1011` | `--background` — **the page ground** |
| `neutral-925` (new) | `#111111` | `--chrome` — top bar, rail, **and** `--card` |
| `neutral-900` | `#181818` | `--panel` — the content area under the top bar |
| `neutral-850` (new) | `#202020` | `--control` — fields, the search box, the active nav row |
| `neutral-800` | `#333333` | `--secondary` — grey buttons; `--accent` hover step |
| `neutral-700` | `#3A3A3A` | avatar / icon circles (`--avatar`) |
| `neutral-600` | `#343434` | `--border` — every hairline |
| `neutral-500` | `#4A4A4A` | `--rule` — the heavier control edge (switch track, checkbox, table divider); the Figma's own "Main Menu" grey measures **2.13:1** here and is not text-safe |
| `neutral-450` (new) | `#6E6E6E` | `--faint` — the caps section label only ("Main Menu"), **3.70:1** on `#111111`; never body copy |
| `neutral-400` | `#858585` | `--muted-foreground` — the Figma's own `#7E7E7E` measures **4.37:1** on the panel; `#858585` clears **4.81:1** there and **5.12:1** on a card |
| `neutral-200` | `#FFFFFF` | `--foreground`, `--heading`, `--card-foreground` — the Figma sets body *and* titles in white |

Step numbers stay labels for the ladder, not a promise of visual distance —
**925 on 950 measures 1.01:1** and **900 on 950 measures 1.07:1**, both
tighter than the single 1.14:1 step the cyan console ran between its one
surface and its cards. **500 is still the last step a LINE may be drawn in
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
holds is that the two directions MIRROR: on dark, a field on the `#111111`
chrome is a step UP (`--control` `#202020`) and its hover a further step up
(`--accent` `#3A3A3A`); on light a field on white is a step DOWN (`#F4F4F4`)
and its hover a further step down (`#ECECEC`). Neither is "recessed", and the
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
| `--primary` / `--marker` | `#0070E8` / `#0062CC` | see the brand ramp above |
| `--success` etc. | unchanged (`#00734B` trio) | 5.91:1 on white |
| `--freshness-dot` | `#34C759` on `rgb(0 212 146 / .15)` | 8.51:1 on `#111111`; on white the dot keeps its halo — flat `#34C759` alone measures **2.22:1** on white, so the halo is load-bearing there, not decorative |

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
| cyan `brand-500`/`brand-600` (`#00CDF5`/`#00C0E8`) | `brand-500`/`brand-600` at `#007BFF`/`#0070E8` | **not a dead class** — the 4 September 2026 Figma named a different blue two days after this ramp last moved. Recorded here anyway because a class surviving under a new value is the "plausible and wrong" case this table exists to catch in the DOCS, not the code |
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

**`system-ui`**, with `-apple-system` behind it for older Safari and **Inter**
last. The reference's export names "SF Pro"; its rendered page reports
`System-ui`. It is asking the platform for its UI face rather than naming
Apple's, and `system-ui` is that request spelled correctly.

**The display face is deleted.** Instrument Sans ran page titles, the landing
hero and the metric numeral. The distinction this interface draws is between the
chrome and the NUMBER, and a tile's headline dropped from 36px to **28px** in
this pass — the Figma draws it smaller than the console did — but the
separation still does not need a second family: 28px Inter 600 against a 15px
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
"Refresh All") set 12px/550, and its own body copy's inspector reports
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
draws is `#181818`, meeting a top bar and a rail that are genuinely
`#111111` — a real, if narrow, colour change — so the frame token has
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
search field styled exactly like a real `Input` (`--control` fill,
`--border` outline, a magnifier, "Search", a ⌘K hint) that opens the same
command palette a real search box would, a "Main Menu" caps label in
`--faint` at 13px (`text-xs` — the scale has no 12px step, per §3), nav rows at 36px with 18px icons (the active row takes
a `--control` fill — **not** a coloured glyph; the "location" job left the
brand with this Figma, per §2), Dashboard's sub-items at 32px indented
under an 8px dash marker, and at the foot a full-width `primary` "New
flow" button above a "Get Free Access" row (a bell icon carrying a small
blue dot, the label muted). The collapse/pin cookie behaviour — what
actually opens and closes the column — is untouched; only what is drawn
inside it changed.

**The panel takes the corner, not the frame.** `AppFrame` renders the top
bar above a row of `[rail | panel]`; the panel is `--panel` with an 8px
**top-right** corner under the bar, and a square top-left where it butts
against the rail behind a hairline. Every earlier era cut the rail-side
corner instead; this one follows the export, which softens the far end.
`shell-skeleton.tsx` mirrors the geometry by hand, same as it always has,
and `tests/page-width.test.ts` is the pin that keeps the mirror honest —
including a negative assertion on `rounded-tl-frame`, because a convention
that old comes back on its own otherwise.

## 6. Components (`src/components/ui/`)

`Button` (**11** variants × 6 sizes — every clickable; `xs` is the dense row's
geometry, for a tile footline where `sm` would crowd out the timestamp; `default`
is the reference's 32px and the **workhorse is a bordered card chip**, not a
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
`Badge`, `Switch` (2 sizes), `Chip` (filter pill + count), `Modal`/`ModalTitle`
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
`Tabs`' line variant draws its active rule from `--rule` — the heavier
control-edge step, not the hairline itself — and keeps 8px corners.
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
`--muted-foreground` bottom rule and a "…" menu; inactive tabs 15px/500,
muted; a 28px `secondary` "+" square), the title itself centred at 26px/600
with its pencil, and the actions right. The dashboard is the one caller,
and its three actions are the export's: a **"Today" dropdown** (`secondary`
`xs`, a 16px calendar glyph, the selected preset's label, a chevron) in
place of the six-pill period track — same six presets, same `?range=` in
the URL, a tenth of the width and no horizontal scroller; **"+ Add"** on
the brand fill at `xs` with a 16px plus; and **"Refresh All"** `secondary`
`xs` with a 16px refresh glyph. Blue is spent on "+ Add" and "New flow",
and on nothing else in the header.

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
- **Skeletons hold the real shape.** `Skeleton` is `foreground/15` (an alpha, so
  it reads on the ground *and* on a card) and is sized at the call site
  to the thing it stands in for — a route's `loading.tsx` should be its page's
  own layout in grey, not three bars. A skeleton that doesn't match its content
  moves the jank later instead of removing it.
- **Hover:** neutral hovers are `hover:bg-accent` — the raised step — and never
  `hover:bg-muted`, which recesses and which was briefly the same value as
  `--card`, so six controls had an invisible hover. Primary walks **UP** the
  ramp: `hover:bg-brand-500`, `active:bg-brand-700`. That inverted with the
  surface — on a light page the brand had to darken, because brightening it
  moved it toward the white behind it and the label's contrast fell at the
  moment of the press. On near-black, raised means lighter. Never
  `hover:brightness-*` on the brand either way.
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

**Marks are the BRAND now, not the marker.** The Figma's own chart draws
its series in the same blue as its buttons: `--color-brand-500` (`#007BFF`)
is the default series colour, an area fill under a line is
`rgb(0 123 255 / .12)` — which `Sparkbars` spells `bg-brand-500/12`, up from
the 5% it had inherited, keeping its 25% border — and a bar is `#007BFF`
flat. Target-met
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
rendering. The token is not deleted — the canvas board, where a step
card's own leading edge is exactly this idea and is explicitly out of
scope for this pass, still reads it, so `--tile-edge` stays defined and
simply gains one fewer consumer. It had been three components that drifted
into three different cards in one grid, one of them carrying a comment
claiming it was "kept in step with FlowTile's shape on purpose" while
disagreeing on the shell, the padding, the title recipe and the footer.
The reader cannot tell which table a number came from, and should not be
able to.

The card is one block of padding, `p-4`, with no coloured edge on the
default board now — the leading-edge idea moves entirely to the canvas
board, where a step card already draws exactly this, and `--tile-edge`
stays wired for it: set by the lane in `board-column.tsx`, read by
inheritance, so a tile dragged to another column on the canvas board
changes allegiance on the frame it lands, with nothing threaded through a
server-rendered node. Content still takes the slack (`flex-1
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
with one theme the whole class of bug is unreachable: there is no second set of
role values for a surface to be pinned against.

**Heat is magnitude, never judgement.** The calendar tints each day by its
share of the month's largest day, in the marker — `color-mix(in srgb,
var(--color-marker) 12–56%, var(--card))`, which keeps the numeral past
7.5:1 at every step of the ramp. It is the marker rather than the brand for the
same reason the bars are: a tint under a numeral is a SURFACE, the shape
`--accent` already takes behind a selected row. Green-good/red-bad is the same
mistake a coloured delta would be — and it is worth restating now that the heat
ramp and `--success` are the same hue: this tint says HOW MUCH, never HOW WELL.
The numeral clearing 7.5:1 at every step is what keeps it a surface. A **negative** value is the single exception and takes
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
ramp holds `#007BFF`/`#0070E8` instead — a class name that keeps compiling
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
