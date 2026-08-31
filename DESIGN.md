---
name: Namzilabs
tagline: Six tools disagree; this one answers in a figure you can defend.
register: quiet chrome, loud numbers
surfaces: [band (rail + top bar), ground, view strip, period track, group column]
accent: yellow FILLS (the brand) · violet DRAWS (the marker) · nothing else
neutral: Untitled UI grey, faint blue cast
type: Helvetica Neue / Inter · 12 · 14 · 16 · 18 · 20 · 24 · 30 · 36
radius: 8 control · 12 card · 16 surface · full pill
status: chrome and furniture SETTLED · metric card and chart card IN PROGRESS
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

## 2. The band, and the fact that it does not move

The product's identity is a **single charcoal band** — `#2E2E2E`, a 70px icon
rail down the left and a 70px bar across the top — wrapping a page that is not
charcoal.

**The band never inverts.** `ink-950` in both themes; only the page inside it
switches. This is what Miro, Notion and Linear all do, and the reason is not
imitation: a rail that changes colour with the theme is a rail with no identity.
It is the one part of the app that says *where you are* before you read a word,
so it has to be the same object at both exposures.

**The band has no seam inside it.** The rail's `border-r` and the top bar's
`border-b` are both gone. That is §5's own rule applied to the chrome — *a rule
drawn where two different materials already meet is a rule doing nothing* —
because below the bar and right of the rail is the ground at `#F5F5F5`, and a
40-point luminance step needs no help finding its own edge. Inside the band
there is no second material to divide from, so the rail and the bar are one
continuous shape with the ground's 16px corner cut out of its inner angle.
`--chrome-line` survives for what is genuinely *within* the band: the ⌘K keycap,
chip outlines on dark.

The rail carries no labels and no headings. Six 40px slots, each wrapping a 28px
chip, in one flat uniformly-spaced stack from the mark to the foot. **Rest is
nothing at all** — a bare white glyph, which on this charcoal measures 12.9:1
and does not need a plate to be found; hover raises to `ink-900`; **active is a
filled yellow chip**, and it is the one filled object in the column, which is
why the other five do not have to compete to be seen.

The stack used to be two groups — Workspace and Build — each opening with a caps
label whose line was *reserved* at 70px so it could fade in on hover without
moving anything. That reservation was correct and worth recording: a heading
that grows from zero on hover pushes every row below it down ~20px while the
pointer is on one of them, so you aim at Flows and click Activity. The headings
are gone rather than collapsed, because keeping them meant ~56px of blank
charcoal in a shut rail to hold two words nobody can see. Five destinations is
under the count at which a list needs sorting into groups to be read.

Names live in `aria-label` **and** a tooltip — one without the other excludes
half the room. The 40px slot stays the hit target, so nothing got harder to
press when the words left.

The top bar holds the workspace on the left, the greeting centred, and the acts
on the right. On the builder its centre is a portal: the whole editing toolbar
renders into `#topbar-slot`, which is why that bar has a scoped `dark` class —
its controls are spelled in roles, and on a light document they would resolve to
near-black on near-black.

---

## 3. The ground, and why content floats on it

Every authenticated page scrolls on `--ground`. Nothing sits flat on it except a
heading, a caption, or a filter's own label — **everything with content in it is
an island** with a border and a shadow.

The ground is the only thing in the chrome that switches with the theme, and it
has to: a light theme whose only light surfaces are the cards is not a light
theme, it is the dark one with white boxes on it.

Cards follow the ground rather than fighting it. This was got wrong once — the
metric tile was pinned white in both themes, which changed the surface and not
the ink, and every muted label on it measured 2.52:1 against 4.5 required. A
card that follows the theme carries the ink the theme already solved for it, and
the problem stops existing instead of needing a patch.

---

## 4. Yellow fills. Violet draws.

Written down because "use the brand colours" is not a rule anybody can apply
twice the same way — and because this one is a measurement rather than a taste
call:

| `#EECF00` | on `#FFFFFF` | on the `#F5F5F5` ground | on the `#2E2E2E` band |
|---|---|---|---|
| as a **stroke or text** | **1.55:1** | **1.42:1** | 8.77:1 |
| as a **fill**, ink `#1A1A1A` | **11.24:1** | — | — |

A yellow line on a light page is invisible and a yellow fill is superb. So each
colour's job is a SHAPE, not a meaning:

| | job | where |
|---|---|---|
| **Charcoal** | the band, and only the band | rail + top bar, one unbroken `#2E2E2E` |
| **Yellow** | **FILLS** | the mark, the active rail chip, primary buttons, the unread badge, step markers, the active period pill, the empty card's cap |
| **Violet** | **DRAWS** | focus ring, links, hover borders, selection rings, the view strip's rule — plus the workspace avatar, the one place violet is a fill, because identity is not a control |
| **Near-black** | ink, and the workhorse button | body copy, `bg-foreground` buttons, the toast |

The one place yellow may stroke is a dark surface, where it measures **8.77:1**:
the top bar's progress arc is yellow for that reason and a link never is.

**This rule replaced "yellow is the HERO, at most once per screen", and the
replacement is not a change of mind — it is a change of what can be checked.**
The scarcity rule said the value of the yellow *was* its rarity, so a second one
halved the first. Nothing anywhere could count them. It was enforced by whoever
happened to be reviewing, which means it was enforced for about as long as
anyone remembered it, and the chrome ended up spending yellow eight times on one
screen with no failure of any kind. The fill/stroke split says something a
script can test, and `scripts/check-ui.ts` tests it: the `yellow-as-stroke` rule
fails the build the moment `--primary` is spelled as text, a border, a ring, a
stroke, a fill or a divide. `bg-primary` with `text-primary-foreground` is the
only shape it will pass.

**The green is gone, and losing it closed a bug this file had already
confessed.** Green said *which slice of this page* — the active view tab's 2px
rule, `#00d492`. Its own token comment admitted the measurement: 9.02:1 on the
dark ground and **1.78:1 on the light one**, where a 2px rule carrying state is
well under the 3:1 such an indicator owes, so the underline was legible only
because the weight change beside it was doing the work. Under the new rule an
underline is a **stroke**, and a stroke is the marker's: **4.41:1** light,
**6.60:1** dark. The rule now carries the state on its own at both exposures.
The green had no job left anyway — it was picked to differ from a selection
violet the rail no longer wears.

State (success / warn / danger) is a separate vocabulary and never borrows from
these. **Status is quiet when fine:** a healthy tile carries a 6px dot; only one
that needs something wears a full pill. A board where every card shows a green
badge is furniture reporting no news, and it buries the one card that matters.

---

## 5. Shape

Everything pressable is a **full pill**. Everything containing something is a
**rounded rectangle** — 8px for controls, 12px for cards and the rail's tiles,
16px for panels and tiles.

The one exception proves the rule: a control that WRAPS cannot be a pill,
because a full radius on a two-line box is half its height and renders as a
circle around the words. Multi-line pressables take the 8px control radius.

**Hairlines carry structure; shadows whisper.** A 1px border does the
separating; elevation only says how far a surface floats. A rule drawn where two
different materials already meet is a rule doing nothing — the top bar carried
one at the edge of its portal slot and it read as a rendering fault.

---

## 6. Type

Two sizes do the work: **14px** for the interface and **12px** for labels,
captions and dense controls. 16px is reading prose only — legal pages, marketing
copy — and the app's body is not that.

**The micro-label voice** is the product's signature: 12px, ALL CAPS,
`tracking-wide`, muted. It is what a section heading, a metric's name, a group's
sort marker and a status pill all share, and it is what lets a 12px string read
as a LABEL rather than as very small prose.

**One name per size.** The scale is closed and single-spelled, and the gate fails
on a second spelling. This is not tidiness: the app once ran twelve names over
nine sizes with three-way ties, every one of them legal, so the same label was
one size in one file and another size in the next while every check passed.

Weights are 400 / 500 / 600. Never 700 — and the rebrand's own source did not
get an exemption. The Figma export sets the top bar's workspace name, avatar
initial and greeting at **700**; the kit's ladder is three rungs and `check:ui`
fails on `font-bold`, so all three shipped at 600. A fourth weight used in one
file and nowhere else is not a design decision, it is the near-miss §1 of the
token file opens by arguing against. It is one of five places this build
deliberately does not follow the export.

**The active thing is the heavier one** — this ran backwards in the view strip
for a while, so the five tabs you were not on were the boldest words in the row.

---

## 7. Furniture, in the order you meet it

- **View strip** — the board's arrangements, Notion's view bar doing Notion's
  job. Real anchors, so a link pasted into Slack opens on the sender's view.
  Active takes the **marker** rule *and* the weight *and* the ink. It still
  takes all three, but for a different reason than it used to: the green it was
  drawn in measured 1.78:1 on the light ground and *could not* carry the state
  alone, so the weight was compensating for a broken rule. The marker is 4.41:1
  light and 6.60:1 dark — the rule now holds on its own, and the weight and ink
  are there because a selection should be unmistakable, not because it has to be.
- **Period track** — six mutually exclusive windows in a segmented pill group.
  The one control that follows the PAGE rather than the band, because a
  near-black pill group on a light page is a second dark object competing with
  the chrome, and the chrome has to win that fight. **The active pill is
  yellow**, which follows from §4 rather than from the export (which does not
  draw this control): an active segment is a filled object, and a filled object
  is the brand. It also keeps the product's two "you are here" marks spelled the
  same way — the rail's chip went yellow, and a pill that stayed violet one
  surface over would mean two selections in two colours, pointing at nothing.
- **Group column** — a tinted lane with a 4px accent bar, a name badge in its own
  hue, and a count. The tint is 6% so a card on it still reads as an object; the
  1px inset ring at 14% is what turns a wash into a panel.
- **Buttons** — one component, twelve variants, six sizes. A dense row takes
  `xs`; the chrome and the builder's toolbar both take `sm`. Two buttons doing
  the same job in two places must be the same rung, and "the builder's primary
  act" and "the chrome's primary act" sharing a bar at 42px and 36px is the
  near-miss this rule exists to stop.

---

## 8. Interaction

- **A press lands immediately.** Anything that re-renders from the URL lights its
  control on the press and swaps its content for content-shaped skeletons, while
  the URL updates inside a transition. Never dim the old numbers: a legible
  figure under a pill that now says something else is a wrong answer shown
  confidently.
- **Focus is declared once**, globally, for every control in the product.
  Components must not re-spell it and must not set `outline-none`.
- **Every interactive element has five states.** No exceptions, including icon
  buttons, tabs and nav.
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

---

## 10. What is not settled

**The metric card and the chart card.** They are mid-rework. What is agreed so
far: they follow the theme, they carry the micro-label voice, the figure is the
loudest thing on them, and a row of them lines its footers up. What is still
open: how a comparison series is drawn, whether a tile carries its own controls,
and how a mark fills a tall tile.

Do not treat the current tiles as the reference for anything else.
