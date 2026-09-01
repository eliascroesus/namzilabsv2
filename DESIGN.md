---
name: Namzilabs
tagline: Six tools disagree; this one answers in a figure you can defend.
register: quiet chrome, loud numbers
surfaces: [ground (rail + top bar + page), card, control, raised, floating]
themes: dark (the console) + light · per device · defaults to the OS
accent: one blue (#00C0E8) · 500 draws on dark, 900 on light · 600 fills on both
neutral: one ramp, cut for #1B191A — five surfaces below, four inks above
type: SF Pro (system) / Inter · 11 · 13 · 15 · 17 · 18 · 20 · 26 · 36 · 48
radius: 4 badge · 8 field · 10 everything that contains something · full button, chip and avatar
status: chrome, furniture and primitives SETTLED · metric card and chart card IN PROGRESS
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

## 2. One surface, and the hairline that is now structural

The product's identity is **a single near-black surface** — `#1B191A` — carrying
a 56px icon rail down the left, a 60px bar across the top, and the page inside
them. All three are the same colour. **Every separation in the product is a 1px
`#3D393B` rule and nothing else.**

This is the reverse of what shipped before, and the reversal is the whole
re-theme. The product used to be a `#2E2E2E` **band** wrapping a `#F5F5F5` page,
and the rule then was that the band had *no seam inside it* — because a
40-point luminance step needs no help finding its own edge, and a rule drawn
where two materials already meet is a rule doing nothing. That was right, and it
inverts completely the moment the two materials become one:

- The rail's `border-r` and the bar's `border-b` are **back, and load-bearing.**
  Without them the chrome bleeds into the page. They also take a real pixel each,
  which is why `ShellSkeleton` mirrors both — a ghost without them jumps the
  content 1px sideways and 1px down at hydration.
- **The notch is gone.** `--radius-frame` cut 16px out of the page's top-left so
  the band's charcoal showed through. Cutting a corner out of `#1B191A` to reveal
  `#1B191A` draws nothing, so the class went and the token is 0.
- **The rail's glyphs sit on nothing.** They wore a chip because a bare icon on
  near-black was a smudge; at 14.08:1 on this ground a chip is a surface step
  away from a surface that is already there.
- **There is one focus ring.** `focus-ring-light` was a sanctioned white twin,
  because the product's violet ring was invisible on the one dark surface in a
  light app. Every surface is that surface now, and the ring is blue at 9.20:1
  on all of them.

**Cards step UP, not down.** `--card` is `#272426` on a `#1B191A` page: a
**1.14:1** step, which exists in the numbers and not in the eye. A card without
its border is not a flatter card, it is an invisible one. That is the single
most important consequence in this file, and it is why `border border-border` is
in the base of the Card primitive rather than in any of its variants.

The rail carries no labels at rest. Six 36px slots, each holding an 18px glyph,
in one flat uniformly-spaced stack from the mark to the foot — and **it opens.**
Point at it and the column widens in place to 260px with the names fading in
beside the chips. The reference this is drawn from does not do that, and its
twelve unlabelled icons are the reason to: an icon rail is unreadable until you
have learned it. Names live in the visible label *and* the accessible name,
which is one string, so the two cannot drift.

---

## 3. Five surfaces, and which direction each one goes

There is one grey ramp, and its steps are five surfaces and four inks with a
deliberate gap between the halves.

| | | |
|---|---|---|
| `neutral-950` | `#1B191A` | **the ground** — rail, top bar and page |
| `neutral-900` | `#211F20` | **a control** — selects, inputs, the period track |
| `neutral-800` | `#272426` | **a card** — and popovers |
| `neutral-700` | `#332F31` | **raised** — hover, a menu row, the toast |
| `neutral-600` | `#3D393B` | **the hairline** |
| `neutral-500` | `#4D494B` | the heavier rule a switch track or checkbox owes |

**A control recesses; a hover raises.** That is the one thing to hold on to. A
select on a card is a slot cut into it, which is what makes a row of fields read
as fields rather than as a stack of small panels; a row you can press comes
*forward* under the pointer. Getting this backwards is not a slightly-wrong
colour, it is depth pointing the wrong way.

`--muted` and `--accent` are the two roles that carry it, and they were briefly
the same value, which broke six hovers into invisibility — a card painted onto
itself. Muted recesses, accent raises, and they may never collapse again.

---

## 4. One blue, in three shapes

The kit ran **"yellow FILLS, violet DRAWS"** for one reason, and it is worth
recording because the reason is now gone rather than forgotten. `#EECF00`
measures **1.55:1** as a stroke on white and **11.24:1** as a fill under
near-black ink. That is not a dim line and a bright box, it is an *absent* line
and a superb box — so the brand could only ever safely do one of the two jobs, a
second colour had to hold the other, and `check-ui.ts` needed a rule to stop
them swapping places.

On `#1B191A`:

| | as a **stroke / text** | as a **fill**, ink `#1B191A` |
|---|---|---|
| `#00CDF5` on the ground | **9.20:1** | — |
| `#00CDF5` on a card | **8.49:1** | — |
| `#00C0E8` | — | **8.08:1** |

Both columns clear their bar with room, so the split has nothing left to
prevent. `--primary` fills and `--marker` draws, and they are **two steps of one
ramp** rather than two colours holding each other's job open. The
`yellow-as-stroke` gate rule retires with the token it policed.

What replaces the split is a rule about **shape**, and the rail is where you can
see all three at once:

| | job | where |
|---|---|---|
| a **ring** | identity | the mark at the top of the rail |
| a **glyph** | location | the active nav row |
| a **fill** | action | the "+" in the foot, every primary button, the active chip |

Three appearances of one colour in three different shapes, each answering a
different question, rather than three fills competing to be the thing you press.

**Hover walks UP the ramp now, and that inverted with the surface.** On a light
page the brand had to *darken* under the pointer, because brightening a yellow
moves it toward the white behind it and the label's contrast fell at the moment
of the press. On near-black, raised means lighter.

### The collision that used to be here, and why it is gone

This section used to argue the opposite of what it argues now, and the reversal
is instructive rather than embarrassing.

While the brand was green, **success and the brand were the same colour** and
the kit conceded it: a success green four counts from the brand green would have
been indistinguishable on screen and guaranteed to drift, so the rule became
"green means good-or-brand" and state gave up its own vocabulary.

That concession was conditional on a hue, and the hue changed. **The brand is
cyan; success keeps the green the brand vacated.** Restoring the split is not a
reversal of the reasoning but the same reasoning under new facts — and the new
facts make the collision actively wrong, because a DONE badge and a New-flow
button sharing one colour puts the loudest *state* and the loudest *act* in one
vocabulary. Warn and danger are the other two state hues.

The green is not a fresh cut. It is `#00D492` / `#00734B`, the exact ramp the
brand vacated, which was solved for this interface and still measures: **9.02:1**
on the ground, **7.93:1** on a card, **5.91:1** on white.

What survives untouched is the half of the rule that was doing the real work —
**status is quiet when fine.** A healthy thing carries a 6px dot; only a thing
that needs something wears a full pill. A board where every card shows a green
badge is furniture reporting no news, and it buries the one card that matters.

`TargetBar` is the component that paid for the collision: it drew "goal met" in
`--success` and "in progress" in `--marker`, which was a real distinction while
the marker was violet and became two identical greens. Those two are different
colours again — but the fix outlived the bug on its own merits. It draws the
unmet meter in **greyscale** and lets colour *arrive* when the goal lands, which
is the honest reading regardless of palette: a bar at 40% is not good, it is
40%.

---

## 5. Shape

**Everything that contains something is 10px.** Cards, panels, popovers,
selects, the period track, tables. The kit ran three container radii — 8, 10 and
16 — so a panel, a card and a tile were three different objects on one screen
and nothing said which was which. The reference draws exactly one.

**Everything you press is a full pill; everything you type in is 8px.** This
has now moved twice, and what decides it is the SHEET rather than a principle:
the previous reference drew its buttons, badges and selects all as rounded
rectangles, and a capsule among them read as borrowed. The current one pills
every pressable thing — "New flow", "Refresh all", "Invite members", the lit
period chip, the notification bell — while leaving cards and fields square-ish.

The pill lives on `buttonVariants`, **not** on `--radius-control`. That token was
`9999px` for one commit once and fifty-one files inherited it, so every text
field, menu row and small panel went capsule-shaped. The token stays at 8px and
holds the fields; the button carries its own shape.

The one exception the pill needs is real and still handled: a control that WRAPS
cannot be a pill, because a full radius on a two-line box is half its height and
renders as a circle around the words. Such a call site passes `rounded-control`
and now genuinely wins, because `cn()` was taught the kit's radius names — the
last time buttons were pills, that override was silently dropped and the page
title rendered inside a grey circle.

**A badge is 4px.** **A card is 10px.**

**Hairlines carry structure; shadows barely exist.** On `#1B191A` a black shadow
at 10% moves about one count. The elevation ladder keeps its rungs so vendored
components compile, but only two are ever chosen on purpose — `card` for
anything in the page flow and `pop` for anything floating over it — and the
floating ones carry a **white inset ring**, because on a dark surface a hairline
of light is the only thing that reads as height at all.

---

## 6. Type

**Set in `system-ui`**, with `-apple-system` one rung down for older Safari and
Inter last. The reference's export names "SF Pro", and this chased it with
`-apple-system` first — but the reference's own rendered page reports
`System-ui Semi-bold` in the inspector. It is asking the platform for its UI
face, not naming Apple's. `system-ui` is the same thing said correctly: SF Pro
on Apple hardware, Segoe UI Variable on Windows, the platform's own face on
Linux.

**The display face is gone.** Instrument Sans ran page titles, the landing hero
and the metric numeral, because a page set entirely in Inter is the house style
of every dashboard built since 2019. That argument is answered rather than
abandoned: the distinction this interface draws is between the chrome and the
NUMBER, and 36px at -0.03em against a 14px interface already carries it. A
second family was buying separation the size step had paid for.

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

**One name per size.** The scale is closed and single-spelled, and the gate fails
on a second spelling. This is not tidiness: the app once ran twelve names over
nine sizes with three-way ties, every one of them legal, so the same label was
one size in one file and another size in the next while every check passed.

Weights are 400 / 500 / 600. Never 700 — and neither rebrand's source got an
exemption. Both Figma exports set small numerals and chrome labels at 700;
`check:ui` fails on `font-bold`, so all of them shipped at 500 or 600.

---

## 7. Furniture, in the order you meet it

- **View strip** — the board's arrangements, Notion's view bar doing Notion's
  job. Real anchors, so a link pasted into Slack opens on the sender's view. The
  active tab takes a 2px green rule **and** goes white while the others stay
  muted. It has held three colours and only this one carries the state alone:
  the green it started as measured 1.78:1 on the light ground, the violet that
  replaced it managed 4.41:1, and this is 9.20:1. The white label is what the
  other two could not afford — with the rule legible on its own, the label is
  free to say SELECTED rather than LINKED, which is what a coloured word says.
- **Period row** — six mutually exclusive windows as free-standing 32px pills
  with no track around them. It was a bordered `--control` groove with square
  segments filling it edge to edge, which is the classic segmented control and
  is not what the sheet draws: the six labels sit directly on the page and the
  selected one is a filled capsule in the brand. That suits what the control
  IS — six links setting one query parameter — and it takes a third bordered
  object off a header that already carries a title and two buttons. The height
  moved from the track to the segment, because with nothing to fill, a pill has
  to carry its own 32.
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
  figure under a pill that now says something else is a wrong answer shown
  confidently.
- **Focus is declared once**, globally, for every control in the product.
  Components must not re-spell it and must not set `outline-none`.
- **Every interactive element has five states.** No exceptions, including icon
  buttons, tabs and nav.
- **Colour never carries state alone.** The reference draws its active nav row as
  a brand-coloured glyph and nothing else, which is invisible to a colour-blind
  reader looking at six otherwise identical icons. Ours takes the colour *and* a
  raised chip. This is the same class of correction as §9's contrast floor, and
  it is the second place the kit deliberately overrules its own source.
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
- **The kit measures its own source.** The reference's dimmest ink is `#6A7282`,
  and it sets its empty-state copy in it: **3.56:1** on its own `#272426` card,
  against the 4.5:1 body text owes. Ours is `#948D93` — four steps up, same hue,
  4.75:1. Copying a value because it came from the comp is how a design system
  inherits somebody else's bug.

---

## 10. What is not settled

**The metric card and the chart card.** They are mid-rework, and they are
explicitly *not* derived from the reference — it is an observability console
with no numbers on it at all, so there is nothing there to copy for the one
screen this product exists to draw. What is agreed so far: they take the surface
and the hairline like everything else, they carry the micro-label voice, the
figure is the loudest thing on them, and a row of them lines its footers up.
What is still open: how a comparison series is drawn, whether a tile carries its
own controls, and how a mark fills a tall tile.

**The builder's canvas.** Out of scope for this pass by instruction. One visible
consequence: `--canvas-bg` keeps its previous value `#1B191A` rather than moving
to `#1B191A`, so the canvas sits six counts off the chrome around it. That is a
known seam, not an oversight. The builder's *chrome* — its toolbar, config panel
and modals — follows the primitives and so inherits the new control ladder
without having been redesigned.

Do not treat any of the three as the reference for anything else.
