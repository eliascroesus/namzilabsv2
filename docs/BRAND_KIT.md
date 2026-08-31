# Namzilabs Brand Kit & UI Guide

The single source of truth for how Namzilabs looks and behaves. Tokens live in
`src/app/globals.css` (`@theme`), primitives in `src/components/ui/`, and the
living render of everything here is `/design`. If this document, the tokens,
and `/design` ever disagree, the tokens win and the other two are bugs.

Benchmarked against Linear, Stripe, Notion, Vercel, Miro and Zapier, and drawn
from a VoltAgent-style observability console: **one surface separated entirely
by hairlines**, one neutral ramp, one green in three shapes, a 14px UI base, and
a state for everything — hover, focus, empty, loading, error.

**The thesis: quiet chrome, loud numbers.** This is a reconciliation product —
six tools disagree and the app's job is to answer in one figure you can defend.
So the number and the canvas carry all the presence, and everything around them
is furniture. Furniture that shouts is why most operational tools are
exhausting by 4pm.

---

## 1. Principles

1. **One surface. The hairline is the structure.** The rail, the top bar and the
   page are all `#0F1011`; every separation in the product is a 1px `#2B2D2F`
   rule. A card is `#1A1B1E` — a **1.11:1** step, which exists in the numbers
   and not in the eye — so a card without its border is not a flatter card, it
   is an invisible one.
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
6. **One theme.** The light theme is deleted, not hidden. `dark:` is bound to a
   class nothing stamps and `check:ui` fails on it (§11).

## 2. Color

### The rule that retired: yellow fills, violet draws

The kit ran a fill/stroke split for one reason, and it is recorded here because
the reason is gone rather than forgotten:

| `#EECF00` | on `#FFFFFF` | on the `#F5F5F5` ground | on the `#2E2E2E` band |
|---|---|---|---|
| as a **stroke or text** | **1.55:1** | **1.42:1** | 8.77:1 |
| as a **fill**, ink `#1A1A1A` | **11.24:1** | — | — |

An absent line and a superb box. The brand could only safely do one of the two
jobs, so a second colour had to hold the other, and `check:ui` needed a rule to
stop them swapping places.

### The rule now: one green, in three shapes

| `#00D492` / `#00BC7D` | on the ground `#0F1011` | on a card `#1A1B1E` |
|---|---|---|
| `#00D492` as a **stroke or text** | **9.83:1** | **8.88:1** |
| `#00BC7D` as a **fill**, ink `#0F1011` | **7.70:1** | **7.70:1** |

Both clear their bar with room, so the split has nothing left to prevent.
`--primary` fills and `--marker` draws as **two steps of one ramp**. What
replaces the split is a rule about SHAPE, visible all at once in the rail:

| shape | job | where |
|---|---|---|
| a **ring** | identity | the mark at the top of the rail |
| a **glyph** | location | the active nav row (plus a raised chip — see §7) |
| a **fill** | action | the `+` in the foot, every primary button, the active chip |

| role | value | job |
|---|---|---|
| `--primary` | `brand-600` `#00bc7d` | every FILLED object: primary buttons, the active chip, the unread badge, the rail's `+` |
| `--primary-foreground` | `#0f1011` | the ink ON that fill — a CONSTANT, not `--foreground`: the green does not invert and neither may what is written on it |
| `--marker` | `brand-500` `#00d492` | every LINE, RING and coloured GLYPH: the focus ring, the tab rule, the active nav glyph, the setup ring's arc, links |
| `--brand-soft` | `rgb(0 188 125 / .10)` | the brand as a WASH — soft pills, selected banners |
| `--brand-soft-line` | `rgb(0 188 125 / .20)` | the ring around that wash; a 10% wash on `#1a1b1e` has no edge without it |

`--marker-ink` is **retired**. The violet needed a second step because 4.41:1
clears the 3:1 a rule owes and falls short of the 4.5:1 a link does. The green
is 9.83:1 and clears both.

### The neutral ramp — five surfaces, four inks, and a gap between them

| token | value | job | on the ground |
|---|---|---|---|
| `neutral-950` | `#0f1011` | **the ground** — rail, top bar, page | — |
| `neutral-900` | `#141518` | **a control** — inputs, selects, the period track | 1.10:1 |
| `neutral-800` | `#1a1b1e` | **a card** — and popovers | 1.11:1 |
| `neutral-700` | `#222325` | **raised** — hover, menu rows, the toast | 1.25:1 |
| `neutral-600` | `#2b2d2f` | **the hairline** | 1.38:1 |
| `neutral-500` | `#3a3d40` | the heavier rule: switch track, checkbox, table divider | 2.40:1 |
| `neutral-400` | `#7d8593` | the dimmest **ink** | 5.12:1 |
| `neutral-300` | `#9ca3af` | descriptions, captions | 7.51:1 |
| `neutral-200` | `#dcdcdc` | body, card titles — `--foreground` | 12.90:1 |
| `neutral-50` | `#fafafa` | reserved; `#ffffff` is the page title |

**500 is the last step a LINE may be drawn in and 400 the first that TEXT may be
set in.** The gap is deliberate: the value that reads as a 1px rule and the value
that reads as 12px copy are not the same value, and the product had been
pretending they were.

**`neutral-400` is NOT the reference's `#6a7282`.** That value measures
**3.56:1** on the `#1a1b1e` card the reference sets its own empty-state copy on,
against the 4.5:1 body text owes. Raised four steps in the same hue. This is the
one place the kit overrules its source on a measurement, and §11 of DESIGN.md is
where the principle lives.

The reference ships **seven** greys for text — `#ffffff`, `#dcdcdc`, `#e5e7eb`,
`#a1a1a1`, `#9ca3af`, `#99a1af`, `#6a7282` — three of which sit within three
counts of each other. That is the "twelve names over nine sizes" failure the
type scale was closed to prevent, arriving in the colour layer. Four values, one
per job.

### Retired token families

All of these still PARSE as classes and compile to NOTHING, which is why they
are a build failure rather than a review comment (§11, `retired token`):

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

### State trios, and the collision

`--success` / `--warn` / `--danger`, each with a `-soft` wash and an `-ink`, and
each wash carrying a **20% ring of its own colour** — a 10% wash on `#1a1b1e` is
quieter than the same wash was on white and reads as tinted text with no edge
otherwise.

**Green is the brand and green is success.** The old rule — "state never borrows
from the brand" — cannot survive that, and patching it would mean a success
green four counts from `#00d492`: indistinguishable, guaranteed to drift.

> **Green means good-or-brand. Warn and danger are the only separate state hues.**
> **Status is quiet when fine:** a healthy thing carries a 6px dot; only a thing
> that needs something wears a full pill.

`TargetBar` is the component that paid for this: it drew "met" in `--success` and
"in progress" in `--marker`, which are the same green today, so it rendered both
states identically. It draws the unmet meter in **greyscale** now and lets colour
ARRIVE when the goal lands — which is the honest reading anyway, since a bar at
40% is not good, it is 40%.

## 3. Typography

**SF Pro**, reached through `-apple-system`, with **Inter** carrying every other
platform. The reference is drawn in SF Pro and it is Apple-licensed — there is
no webfont to serve, and the copy on every Mac and iPhone is the only legal way
to get it.

**The display face is deleted.** Instrument Sans ran page titles, the landing
hero and the metric numeral. The distinction this interface draws is between the
chrome and the NUMBER, and 36px at -0.03em against a 14px interface already
carries it; a second family was buying separation the size step had paid for.
`.font-display` survives as a tracking utility (-0.022em) and `.stat-numeral` as
the ledger figure.

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
| `text-display-md` | 36 | the tile's headline number |
| `text-display-lg` | 48 | the landing hero |
| `text-banner` | fluid | the landing's one oversized moment |

**The micro-label voice**, as `.label-micro`: 10px, ALL CAPS,
`--tracking-label`, muted. A status pill, a section heading, a table head and a
group's sort marker all share it. It was four utilities spelled slightly
differently in eleven files.

**A chip is the one small object that is NOT caps.** A badge carries a status —
a word you scan. A chip carries a source or metric name the customer chose, and
setting somebody's workspace name in caps is the product shouting a word it did
not write.

**One name per size**, enforced (§11). Weights are **400 / 500 / 600**; never
700, and neither Figma export got an exemption for its bold numerals.

## 4. Shape & elevation

**Everything that contains something is 10px** — `--radius-card` and
`--radius-surface` are the same value. The kit ran 8 / 10 / 16, so a panel, a
card and a tile were three different objects on one screen with nothing saying
which was which.

**Everything pressable is 8px** (`--radius-control`). This replaces "everything
pressable is a full pill", which needed an exception it could never justify: a
control that WRAPS cannot be a pill, because a full radius on a two-line box
renders as a circle around the words. **A badge is 4px. An avatar and a status
dot are the only full radii left.** `--radius-frame` is **0** — the notch it cut
opened onto a colour that no longer differs from the page.

**Shadows barely exist here.** Black at 10% over `#0f1011` moves about one count.
The ladder keeps its rungs so vendored components compile, but only two are
chosen on purpose — `shadow-card` in the page flow, `shadow-pop` for anything
floating — and the floating rungs carry a **white inset ring**, because on a dark
surface a hairline of light is the only thing that reads as height.

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
segmented track is 32 OUTSIDE with 28px pills and a 2px inset — so the outer
control stands at the height of the buttons either side of it.

**16px inside every card, including the metric tile.** It ran `p-5`; one tile
padded four pixels wider than every other card on the same board is the
near-miss that makes a row of tiles look hand-placed.

**The shell's geometry is tokenised**: `--spacing-rail` (56), `--spacing-rail-open`
(260) and `--spacing-topbar` (44 content, 60 with padding). Those numbers appear
in four files including the loading skeleton, and `tests/page-width.test.ts`
pins them — including **both hairlines**, which now take real pixels, so a ghost
without them jumps the page 1px in each axis at hydration.

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
it, and why every card title is the same 14px/500 as the body under it,
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

**Marks are the MARKER** (`bg-marker`); target-met `success`; bottleneck
`danger`; tracks `bg-muted`. Bars never `bg-neutral-800`. Headline numbers per
§3. One `Sparkbars`/`TargetBar`/`GroupBars`/`Delta` implementation in
`src/components/charts.tsx`, shared by every tile.

A bar is not a filled object in §2's sense — it is a **shape read by its edge
against the card it sits on**, with no ink of its own to carry the contrast. That
argument forced the series onto the marker when the brand was yellow (1.55:1
against the marker's 4.41:1); it is satisfied either way now, since both steps of
the green ramp clear 8:1 on a card. The series stays `--marker` because a series
is a MARK, and the fill step is reserved for things you press.

**`TargetBar` is the exception, and it is the success/brand collision landing.**
It drew "met" in `--success` and "in progress" in `--marker`, which are the same
green today — so it rendered both states identically and stopped reporting the
only thing it exists to report. The unmet meter is **greyscale** now and colour
ARRIVES when the goal lands. A bar at 40% is not good, it is 40%.

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

`pnpm check:ui` (`scripts/check-ui.ts`) gates **thirteen** rules: stock
type/radius/shadow classes, the nine retired type aliases, `font-bold`, raw
chromatic palette classes, **`retired token`**, **`dead dark: variant`**, hex
literals outside the five sanctioned paths, bare `toLocale*()` outside
`format.ts`, text glyphs used as icons, and raw `<button>` outside the
primitives and the builder's bespoke chrome. Each rule carries a per-path
allowlist with a stated reason — "it's fine" is how the next drift gets waved
through.

**`retired token` is the rule this re-theme earned the hard way.** Retiring a
COLOUR token is not like retiring a size token. An unresolved `text-micro`
renders at the inherited size — wrong, and visible. An unresolved
`border-marker-300` renders with **no border at all**, so the selected step in
the flow builder stopped having an edge; an unresolved `text-marker-ink` renders
in whatever colour its parent happened to be. Both look plausible, neither
throws, and the build passed. Twenty-seven ramp classes and three ink classes
survived the sweep that deleted their tokens and were found by grepping. The
rule carries the full substitution table in its own comment (and §2 above).

**`dead dark: variant`** exists because `@custom-variant dark` is deliberately
KEPT in `globals.css`. Deleting it hands `dark:` back to Tailwind's default
`prefers-color-scheme` binding, where a stray class would fire on half the
machines loading the page with nobody here able to see it. So the variant
compiles, matches nothing, and this rule stops the dead spelling accumulating.

**Two rules retired with the design they policed.** `yellow-as-stroke` failed
the build on `text-primary`, `border-primary`, `ring-primary` and their kin,
because those classes point at a live token — they COMPILE, the build passes,
and the link renders at 1.55:1 on white. It was the best rule in the file and
its measurement is gone: the green is 9.83:1 as a stroke on every surface in the
product. `black-as-primary` banned `bg-neutral-900` as a near-black frozen at
one exposure; there is one exposure, and that value is now the CONTROL surface
every select legitimately names. `retired accent-yellow` is folded into
`retired token`.

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
