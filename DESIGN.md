---
name: Namzilabs
tagline: Six tools disagree; this one answers in a figure you can defend.
register: quiet chrome, loud numbers
surfaces: [page + chrome + panel (one colour), card (the only step), control, raised, floating]
themes: dark (the console) + light · per device · defaults to the OS
accent: one lime (#B6FF56) · a FILL under near-black ink (#2C2C2C) · the same value draws on dark · a solved-down #4F7A00 draws on light
neutral: one ramp — one ground (#121214) carrying page, bar and rail, one card (#191919) a hair above it, and one hairline (#343434) doing every separation that remains
type: Inter · 11 · 12 · 14 · 15 · 17 · 18 · 20 · 26 · 28 · 30 · 48
radius: 8 on everything that contains something · full on the delta chip, the freshness dot and the avatar
status: chrome, furniture and primitives SETTLED · the chart card's two-series legend NOT built (needs a comparison series the product does not have)
---

# The Namzilabs design language

This is the direction, derived from what the product actually looks like now —
not a proposal. Everything described here has shipped and is the thing to build
against. **Two surfaces are deliberately out of scope: the metric card and the
chart card.** They are being worked on, and nothing in this file should be read
as settling them.

The written kit (`docs/BRAND_KIT.md`) is the mechanical half — token names,
recipes, what the gate enforces. This is the half that says *why the screen
looks like this*, which a table of tokens cannot.

---

## 1. The thesis

**Quiet chrome, loud numbers.**

This is a reconciliation product. Six tools disagree about how many leads came
in last week, and the app's job is to answer in one figure the customer can take
into a meeting and defend. That single sentence decides almost every question
below: the number is the only thing allowed to be loud, and everything wrapped
around it is furniture.

Furniture that shouts is why most operational tools are exhausting by 4pm.

---

## 2. One surface, and the hairline that is now the only structure

The product's identity has been argued three ways in a week, and it is worth
recording all three because the argument keeps landing in the same place from
different directions.

It was **a single near-black surface** — `#1B191A` carrying a 56px icon rail, a
60px bar and the page inside them, all one colour, every separation a 1px rule.
The 4 September Figma drew **three**: page `#0F1011`, chrome `#111111`, panel
`#181818`. This file called that a reversal, deliberately, and it was.

The 8 September Figma (node 49:5268) draws **one**. The page, the top bar, the
rail and the content area are all `#121214`. **This is the second reversal, and
it is as deliberate as the first.** The three surfaces were not a mistake that
has been corrected; they were what that Figma drew, and this one draws
something else.

**What actually changed is the hairline's job, and it narrowed rather than
shrank.** Under three surfaces the `#343434` rule drew three seams that were
each too small to see unaided. There are no such seams now — a rule drawn where
two identical surfaces meet draws nothing at all, which is the one-surface
argument in its original form, and the reason it was right the first time.

What is left is **the card**, at `#191919`, and it measures **1.06:1** on the
page. That is not a step you can see; it is barely a step you can measure. So
the hairline is not doing less work, it is doing *all* of the work, on the one
edge in the product that still has two materials on either side of it. A card
without its border is not a flatter card, it is an invisible one — the same
sentence as under every scheme, now with exactly one place left to apply it.

Three things follow, and each is the mirror of a decision made four days ago:

- **The notch retires, again, by its own argument.** `--radius-frame` was 0
  when everything was one colour, because a corner cut into `#1B191A` to reveal
  `#1B191A` draws nothing. It came back at 8px when the panel appeared. The
  panel is gone, so the cut reveals `#121214` against `#121214`. The token stays
  defined so `rounded-frame` remains a legal spelling for whatever comes next.
- **`--chrome` survives as a role with no visible job on dark.** It holds the
  same hex as the page here. It is kept because `:root` still has a real
  chrome/page step — white on `#F7F8F9` — and a role declared in one theme must
  be declared in both, or the dark theme's vocabulary becomes a subset of the
  light one and `design-swatches.test.ts` fails.
- **The rail's glyphs still sit on nothing at rest**, and the focus ring is
  still one ring — lime at 15.53:1 on the ground, which is the brightest stroke
  this product has ever drawn.

**The rail no longer opens, because it is never shut.** It rested at 56px and
widened to 260px on hover, held open by a cookie the server read so the width
would be right in the first paint. The Figma draws one width. The mechanism —
`REVEAL`, the overlay panel, the pin, the toggle — is gone entirely, and
`page-width.test.ts` asserts its absence rather than its behaviour, because a
mechanism that subtle gets reintroduced by a well-meaning "restore the
collapse".

## 3. Eight steps below the gap, and three more above it

There is one grey ramp, cut deeper now: eight surface steps carry the
weight one used to, because three grounds need somewhere to sit rather
than one, and the ink side above the gap is unchanged in kind — still a
handful of defined steps, still only two of them read by a role.

| Token | Hex | Job |
|---|---|---|
| `neutral-950` | `#121214` | **the page** — and the chrome, and the panel |
| `neutral-925` | `#121214` | **the chrome** — top bar and rail. The same hex here; a real step in light |
| `neutral-900` | `#191919` | **the card** — the one surface that steps away, at 1.06:1 |
| `neutral-850` | `#202020` | **a control** — fields, the search box, the active nav row |
| `neutral-800` | `#333333` | grey buttons (`--secondary`) |
| `neutral-700` | `#3A3A3A` | `--accent` — the hover/press step above a grey button (amended 5 Sep); also avatar and icon circles (`--avatar`) |
| `neutral-600` | `#343434` | **the hairline** |
| `neutral-500` | `#4A4A4A` | the heavier rule a switch track or checkbox owes |
| `neutral-450` | `#6E6E6E` | the caps section label only — never a sentence |
| `neutral-400` | `#828282` | the first step body TEXT may be set in — 4.87:1 on the page, 4.58:1 on a card |
| `neutral-200` | `#FFFFFF` | body, headings and card titles alike |

The first two hold one hex between them — the ground of §2 — and the third is
the single card step above it. **500 is still the last step a LINE may be drawn in, and
400 the first that TEXT may be set in** — the gap between them used to be
one step and is now two, because `450` sits inside it for exactly one
job: a caps section caption ("Main Menu") that has to read quieter than
body text without being mistaken for a rule. A sentence set at `450`
would be the same bug a sentence set at `500` always was.

**Depth is stated as a mirror now, not as a rule about which way things
go.** On dark, a field on the `#191919` card is a step UP (`--control`
`#202020`, 1.08:1) and its hover a further step up (`--accent` `#3A3A3A`,
1.55:1); on
light a field on white is a step DOWN (`#F4F4F4`) and its hover a
further step down (`#ECECEC`). Neither is "recessed" — that was a
sentence about one theme stated as a rule about both, and the Figma
contradicts it outright on the dark side.

`--control` and `--accent` are the pair that carries it now. (`--muted`
is a separate role — a table's head, the content area's own fill — and it
was briefly indistinguishable from `--card` in an earlier draft, which
broke six hovers into invisibility: a card painted onto itself. A
skeleton's own track is not this role either: `Skeleton` is `bg-foreground/15`,
a `--foreground` alpha rather than a role, so it reads on the ground and on
a card alike without needing a role of its own. That is a different bug
from depth pointing the wrong way, and the lesson from both is the same
one — two roles that carry a visible state may never collapse to a single
value.)

---

## 4. One lime, and the ink that had to invert

The kit ran **"yellow FILLS, violet DRAWS"** for one reason, worth keeping on
the record because the reason keeps coming back. `#EECF00` measures **1.55:1**
as a stroke on white and **11.24:1** as a fill under near-black ink. That is not
a dim line and a bright box, it is an *absent* line and a superb box — so the
brand could only ever do one of the two jobs, and a second colour had to hold
the other.

Blue retired that split. `#007BFF` cleared its bar both ways, and the kit ran
two rungs of one ramp: `--marker` drew, `--primary` filled one step deeper
because blue under WHITE was tight at 3.98:1.

**Lime springs the yellow's trap exactly halfway, and that decides everything
below.**

| | measured |
|---|---|
| `#B6FF56` under `#2C2C2C` ink | **11.59:1** |
| `#B6FF56` as a stroke on `#121214` | **15.53:1** |
| `#B6FF56` under WHITE ink | **1.20:1** |
| `#B6FF56` as a stroke on WHITE | **1.20:1** |

Two consequences, and neither is cosmetic:

**The ink inverted.** Blue was a fill under white. Lime cannot be — white on
lime is 1.20:1, which is not a dim label but an unreadable one. So
`--primary-foreground` is **near-black in both themes**. The RULE did not
change: a primary button is one object and its ink does not vary by theme. What
changed is which end of the ramp supplies that ink.

**The split moved rather than retiring.** On dark, one value does everything —
`brand-400` is the fill, the stroke *and* the default chart series, where blue
needed two rungs. On white, lime has the yellow's problem precisely, so light
alone keeps a solved-down `brand-800` (`#4F7A00`, 5.10:1) for its stroke. The
split is no longer fill-versus-stroke inside a theme; it is dark-versus-light.

| | job | where |
|---|---|---|
| a **stroke** | signal | links, the focus ring, a selected edge, the active nav row's glyph |
| a **fill** | action | "+ Add", the rail's "New", every primary button |

*The active tab's rule is not this stroke.* It reads `--tab-rule` — grey in both
themes — because the Figma draws that rule in grey, not in the brand.

**And two controls are white, which this file has to own rather than explain
away.** "Today" and "Refresh All" are drawn as white pills with `#4A4A4A` ink
(nodes 49:5429 and 49:5439), adjacent, unambiguous. On a `#121214` console a
white fill is the loudest object on the screen after the lime itself, and
"quiet chrome, loud numbers" is this document's first sentence. They were
shipped as drawn. The thesis survives in the half that carries meaning — the
brand still marks only the two controls that ADD something — but a reader
comparing §1 to the dashboard header deserves to be told this was a decision
and not a drift.

## 5. Shape

**Everything that contains something is still 10px.** Cards, panels,
popovers, a select's own open menu, tables — unchanged by this pass,
because the argument for one container radius never depended on which
theme sat under it. The period track is NOT in this group any more — see
below, it presses now, it does not contain.

**Everything you press is 8px, and there is no pill this time — nor is
there a next time.** This has flipped between a pill and a rounded
rectangle twice now: the reference before the cyan console pilled every
pressable thing, the cyan console kept the pill, and this Figma draws
none. Two flips with no stated reference produced a genuine "which one is
right" argument each time; this file names the 4 September 2026 Figma as
the reference specifically so a third flip needs a new design behind it,
not a preference. `buttonVariants`' base class carries `rounded-control`
(8px) rather than `rounded-full`; `PERIOD_TRACK` — the groove itself, not
just `PERIOD_PILL`'s segments inside it — carries the same `rounded-control`
class, so the container and what presses inside it share one radius rather
than a bigger one clipping a smaller one. The WRAP exception the last flip needed — a control that wraps to
two lines cannot be a pill, because a full radius on a two-line box
renders as a circle around the words — does not reopen, because nothing
here is a pill for that exception to be an exception to. `rounded-control`
simply is what a button is now.

**Circles are reserved for four things, and reading as an action is no
longer one of them:** an avatar, the bell's unread badge, the freshness
dot, and the tile's "active count" numeral. Nothing that a person presses
is ever fully round.

**A badge is 4px. A card is 10px.**

**The frame is back, and on the other corner.** `--radius-frame` was 0 two
days ago because the notch's whole argument — a radius reveals whatever sits
behind it — had nothing to reveal once the shell became one colour. It did
not stay one colour; see §2. The token is **8px** again, cutting the content
panel's **top-right** corner under the top bar. Every earlier era cut the
top-LEFT, the corner nearest the rail, and the export does not: the panel
butts square against the rail behind a hairline and softens the far end
instead. Followed literally rather than corrected toward the older
convention, and pinned in `tests/page-width.test.ts` with a negative
assertion on `rounded-tl-frame` so the habit cannot return by itself.
**This is a dark-theme device, not a universal one:** in light, `--panel`
is `--background` (`#F7F8F9`) — the same colour the page already is — so
the identical 8px cut reveals nothing there, exactly as it did not two
days ago. Dark grew a third surface; light never lost its second.

**Below `md`, the corner's whole argument evaporates a second time, for a
third reason.** The notch reveals the panel meeting the rail on a line
that only exists at `md` and up; below it there is no rail to butt
against, so the panel takes the full inset rather than a cut corner —
same conclusion as the light theme's flat colour, reached by removing the
edge instead of matching it. The rail's own tree does not vanish with the
rail, it moves: a 32px menu button opens a 280px **drawer** built on the
SAME component tree as the expanded rail (`RailContent`, one export
rendered in two frames, never a hand-kept copy), closing on navigation or
the instant the window crosses back over `md`. The board underneath drops
to one column for the same reason the corner drops — a phone has no room
to spend on either.

**Hairlines still carry structure; shadows still barely exist.** The card
shadow is now the Figma's own value, `0 1px 2px rgb(0 0 0 / .20), 0 0 3px
rgb(0 0 0 / .10)`, shared by both themes rather than floored only on
dark. The elevation ladder keeps its unused rungs so vendored components
compile, and the same two are ever chosen on purpose — `card` in the page
flow, `pop` for anything floating, with the floating ones keeping their
white inset ring on dark.

---

## 6. Type

**Set in Inter**, everywhere, as of 6 September 2026. `--font-sans` and
`--font-display` both open with `var(--font-inter, "Inter")` and keep
`system-ui`, `-apple-system`, `BlinkMacSystemFont` and `"Segoe UI"` behind it
as the fallback.

For four days they did not. Inter sat FIFTH, behind four keywords that
resolve on every platform in practice — so the face `next/font` self-hosts on
every page load was never reached, a Mac drew the whole product in SF Pro, and
the two rules that named Inter directly (`.stat-numeral` and `.wordmark`) came
out in a visibly different face from the interface around them. The argument
for that order was that the reference's own rendered page reports `System-ui`
in the inspector rather than the "SF Pro" its export names, so asking the
platform for its UI face was the honest reading. It was the wrong call twice
over: it made the app's two loudest objects mismatch everything else, and
it meant loading a webfont nobody would ever see.

Neither `.stat-numeral` nor `.wordmark` names a family any more — they inherit
Inter like everything else, and each keeps only what is genuinely its own
(tabular digits and tracking; the 900 weight).

**The display face is still gone, and the number holding its place got
smaller.** Instrument Sans ran page titles, the landing hero and the metric
numeral; the distinction this interface draws is between the chrome and the
NUMBER, and that argument does not need the numeral to be 36px to work —
this Figma draws it at **28px**, Inter 600, and 28 against a 14px interface
still reads as the loudest thing on the tile. A second family was buying
separation the size step had already paid for, at 36 or at 28 either one.

Three sizes do the work: **15px** for the interface, **13px** for labels,
captions and dense controls, and **11px** for the micro badge. 17px is reading
prose only — legal pages, marketing copy — and the app's body is not that.

**The micro-label voice** is the product's signature: 11px, ALL CAPS,
`--tracking-label`, muted. It is what a status pill, a section heading, a table
head and a group's sort marker all share, and it is what lets a very small
string read as a LABEL rather than as very small prose. It is available as
`.label-micro`, because it was four utilities spelled slightly differently in
eleven files.

**A chip is the one small object that is NOT caps.** A badge carries a status —
a word you scan. A filter chip carries a source name or a metric name, which is
a proper noun the customer chose, and setting somebody's workspace name in caps
is the product shouting a word it did not write.

**The wordmark is new, and it is not a scale step.** "Namzilabs" sets in a
class of its own, `.wordmark` — Inter, 24px, weight 900, 22px line —
because this is the one string in the whole Figma the export actually
names a face and a weight for, rather than asking for the platform's own
UI font at whatever this kit already runs. It moved out of the rail into
the top bar's left slot in the same pass (§2, above), which is the more
visible of the two changes: a wordmark that only appeared once per
session, inside a column that is 56px wide most of the time, was never
going to be the thing anyone noticed move.

**One name per size.** The scale is closed and single-spelled, and the gate fails
on a second spelling. This is not tidiness: the app once ran twelve names over
nine sizes with three-way ties, every one of them legal, so the same label was
one size in one file and another size in the next while every check passed.

Weights are 400 / 500 / 600 — plus exactly ONE named exception, and the
count matters more than the exception does. `.wordmark` is it, at 900,
because the Figma names a face and a weight for that one string and for
nothing else. The rail's workspace-switcher badge was the candidate for a
second and did not get it: its initial ships at 13px/600, since "a
one-character badge is not prose" would let every badge in the product
through and 600 already reads as a badge at that size. Every other request
for 700 or 900 either Figma export made ships at 500 or 600 regardless.
`check:ui` still fails on `font-bold` and needs no allow-list for the
wordmark: the 900 is declared in the CSS class, and the gate reads `.tsx`,
never `.css`.

---

## 7. Furniture, in the order you meet it

- **View strip** — the board's arrangements, Notion's view bar doing Notion's
  job. Real anchors, so a link pasted into Slack opens on the sender's view.
  The active tab used to carry the state in colour ALONE — a 2px rule at the
  time, that went from a green measuring 1.78:1 on the light ground, to a violet at
  4.41:1, to a cyan that cleared its own bar with room to spare — and colour
  got QUIETER at the same time it got easier to read: the rule this Figma
  draws is a grey role, `--tab-rule` (`--muted-foreground` on dark,
  `--heading` on light, bridged as `border-tab-rule`), no colour at all, and
  the active tab is set apart by WEIGHT (500 → 600) and ink (muted →
  `--heading`) instead. Three colour changes taught the same lesson before
  this pass finally acted on it: a state that only colour carries is
  invisible to whoever cannot see the colour, so the rule and the weight and
  the ink all have to say SELECTED, not just one of them.
- **The "Today" dropdown replaces the period track.** The dashboard used to
  spend a full-width 32px bordered `--control` groove on six mutually
  exclusive range buttons — Today, Yesterday, 7d, 30d, this month, last
  month — filling it edge to edge as segments, capsule inside capsule. The
  Figma draws a single `secondary` button instead: a 16px calendar
  glyph, the window's own label, a chevron. As of 7 Sep 2026 it also does
  something different — it opens a CALENDAR rather than a list of six. A
  window is a first click, a second click, and the same day twice for one day;
  it rides in `?range=` as `YYYY-MM-DD..YYYY-MM-DD`, and a pair that happens to
  equal one of the six precomputed windows is canonicalised back to it. The six
  survive as the windows every stored tile carries, not as a menu. What did not
  change is the control's shape, from a groove that had to fight a narrow
  screen for width to a button a tenth as wide
  and never touching a horizontal scroller.

  *The groove is not gone, only reassigned.* `PERIOD_TRACK` and
  `PERIOD_PILL` still exist, now 8px like every other control (§5) rather
  than a capsule, and `tests/console-theme.test.ts` still pins the three
  properties that matter — border, fill and enclosure — regardless of which
  radius they render at. The calendar's own month stepper is what wears
  them now, so a control that used to be pill-first everywhere is
  pill-nowhere, including the one place this section used to have to
  defend it.
- **Group column** — a tinted lane with a 4px accent bar, a name badge in its own
  hue, and a count. The tint is 6% so a card on it still reads as an object; the
  1px inset ring at 14% is what turns a wash into a panel.
- **Buttons** — one component, twelve variants, seven sizes, and **32px is the
  default**. It is also the only height the console uses: `sm` resolves to it,
  fields follow it, chips match it, and the period track is 32 outside. The app
  was running eight control heights before this was measured rather than
  assumed, and 28-beside-32 was the one that read as a fault. Every control in the product is 32: the date picker, the selects,
  the segmented groups, the dense row. The ladder came down from 28/36/44/52,
  which was cut for a roomy light app and put a 44px button beside a 40px track
  beside a 24px title with nothing in the row standing on the same line.
  The *workhorse* is a bordered card chip rather than a solid fill — which is
  what a console's ordinary act looks like — so **the primary act has to say so.**
  `SubmitButton` defaults to the brand for exactly that reason: a submit is the
  primary act by definition, and "Save" rendering as the same object as "Cancel"
  is a form with no primary.
- **Cards have a ruled head.** 16px, closed by a hairline, then the content. That
  rule is what makes a card's name a title without spending a size step or a
  weight on it — which is why every card title in the product is the same body
  size as the text under it.
  **The board's own tiles were the last surface still not using it**, and they
  were the surface it mattered most on: a chart card headed by a 13px ALL-CAPS
  muted label reads as a caption with a graph under it, at a size two steps
  below the body text everywhere else. The micro-label voice is for a STATUS or
  a column head — strings you scan — never for a name the customer wrote.

---

## 8. Interaction

- **A press lands immediately.** Anything that re-renders from the URL lights its
  control on the press and swaps its content for content-shaped skeletons, while
  the URL updates inside a transition. Never dim the old numbers: a legible
  figure under a chip that now says something else is a wrong answer shown
  confidently.
- **Focus is declared once**, globally, for every control in the product.
  Components must not re-spell it and must not set `outline-none`.
- **Every interactive element has five states.** No exceptions, including icon
  buttons, tabs and nav.
- **Colour never carries state alone.** The reference draws its active nav row as
  a brand-coloured glyph and nothing else, which is invisible to a colour-blind
  reader looking at six otherwise identical icons. This kit answers with a
  second signal rather than removing the first: the active row takes a
  neutral `--control` fill UNDER the glyph, and the glyph keeps its own
  `text-marker` colour on top — location is a SHAPE now as well as a colour,
  not instead of one, which answers the same objection without spending the
  brand's signal job. The view strip's active tab took the same lesson from
  the opposite direction (§7): its rule went from carrying colour alone to
  carrying none at all, with weight and ink doing the work instead. This is
  the same class of correction as §9's contrast floor, and it is the second
  place the kit deliberately overrules its own source.
- **Nothing destructive fires on first click.**
- **Motion is tokenised** — 120/180/280ms, three curves. `spring` only for things
  that appear or that the user just did; exit is faster than entry, because a
  slow dismissal reads as lag.

---

## 9. Honesty rules

These are design rules, not engineering ones, and they are the product's actual
character:

- **A number says when it was true.** Every materialized figure carries its
  as-of, and a stale one shows exactly how far behind it is.
- **An em-dash is not a zero.** "No answer for this period" and "the answer is
  zero" are different facts and the tile that conflates them is the one nobody
  can trust.
- **A fabricated comparison is worse than no comparison.** A delta is shown only
  where a real predecessor is stored.
- **Deltas are never green or red.** Up is good for Booked Leads and bad for
  Speed to Lead, and nothing on the tile says which — a coloured delta would
  confidently report a regression as a win.
- **A number that leaves data out has to admit it**, or the gap reads as an
  answer.
- **Heat is magnitude, never judgement.**
- **The kit measures its own source.** This is not a one-time finding; the same
  gap reopened with the 8 September Figma and was caught the same way, for the
  third time. Its own dimmest ink is `#7E7E7E`, and on the `#191919` card its
  own card titles sit on, that measures **4.33:1** against the 4.5:1 body text
  owes. Ours is `#828282` — four values up, same hue, indistinguishable beside
  it — clearing **4.87:1** on the page and **4.58:1** on a card.

  The same Figma sets its inactive tabs in `#4A4A4A`, which is **2.11:1** on
  this ground: below even the 3:1 a non-text graphic owes, on a control you are
  meant to click. Those read `--muted-foreground` instead. Copying a value
  because it came from the comp is how a design system inherits somebody else's
  bug — three passes running, now.

---

## 10. What is not settled

**The chart card's two-series legend.** Node 49:5268 draws a legend under each
chart naming two dates — the period and the one it is compared against — and
the product has no comparison SERIES to draw. It computes a delta, which is why
the card carries a chip instead, but nothing plots a second line. A legend
naming two series when one is drawn is a lie about the data, so it was left
unbuilt rather than faked. Everything else on both cards follows the Figma:
surface, hairline, the 28px figure, the freshness dot, the neutral chip.

Still open with it: whether a tile carries its own controls, and how a mark
fills a tall tile.

**The builder's canvas and its nodes.** Out of scope by instruction for the
third pass running, and narrowed this time to exactly that: Elias's ruling on
8 September was "recolour and change layout, complete retheme — only thing not
to redesign is the flow canvas and nodes". So the builder's *chrome* was
re-themed in full and the canvas surface was not. `--canvas-bg` keeps its
frozen `#1B191A` — the page ground from before any of these retheme passes —
rather than following the page to `#121214`. Moving it would be a canvas
decision, and none has been made. It is the same seam a previous
pass closed by coincidence, not a new one — the builder's *chrome* (its
toolbar, config panel and modals) still follows the primitives, so it
inherits every token change in this pass without the canvas itself having
been touched.

Do not treat any of the three as the reference for anything else.
