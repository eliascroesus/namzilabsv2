---
name: Namzilabs
tagline: Six tools disagree; this one answers in a figure you can defend.
register: quiet chrome, loud numbers
surfaces: [page, chrome (top bar + rail + card), panel (the content area), control, raised, floating]
themes: dark (the console) + light · per device · defaults to the OS
accent: one blue (#007BFF) · 400 strokes on dark, 800 strokes on light · 600 fills on both
neutral: one ramp, re-cut for three darks (#0F1011 / #111111 / #181818) — eight surface steps below the gap, two ink steps above it, one caps-label-only step between them
type: SF Pro (system) / Inter · 11 · 13 · 15 · 17 · 18 · 20 · 26 · 28 · 48
radius: 4 badge · 8 field, button and chip · 10 everything that contains something · full avatar, bell badge, freshness dot and active-count numeral
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

## 2. Three surfaces, and the hairline that is still structural

The product's identity was **a single near-black surface** two days ago —
`#1B191A` carrying a 56px icon rail, a 60px bar and the page inside them,
all one colour. The 4 September 2026 Figma draws three: the page is
`#0F1011`, the top bar and the rail (and every card) are `#111111`, and
the content panel sitting under the top bar — where the board and its
tiles live — is `#181818`. **This reverses the reversal.** The one-surface
thesis was this file's own central argument two days ago, made
deliberately (a 40-point luminance step needs no help finding its own
edge, and a rule drawn where two identical surfaces meet does nothing);
it is reversed again here, just as deliberately, because the surfaces are
no longer identical and the hairline has a job to do that it did not have
before.

The three are close on purpose, not despite the purpose: `#111111` on
`#0F1011` measures **1.01:1**, and `#181818` on `#0F1011` measures
**1.07:1** — both TIGHTER than the 1.14:1 gap the previous surface ran
between its ground and its cards. **The hairline is doing more work now,
not less.** Every separation that is not one of those two steps is the
same 1px `#343434` rule as before, recut for the new ground:

- The rail's `border-r` and the bar's `border-b` are unchanged in kind —
  they take a real pixel each, and `ShellSkeleton` mirrors both for the
  same reason it always did: a ghost without them jumps the content at
  hydration.
- **The notch is back.** `--radius-frame` was 0 because a corner cut into
  `#1B191A` to reveal `#1B191A` draws nothing. The panel it now cuts into
  is `#181818`, sitting beside a rail and under a bar that are `#111111`
  — a real, if narrow, colour change — so the same argument that retired
  the notch two days ago is exactly the argument that reinstates it here:
  a radius reveals whatever is behind it, and there is something behind
  it again.
- **The rail's glyphs still sit on nothing at rest** — the surface behind
  them is `--chrome`, and a bare icon measures the same 14+:1 it always
  did against a near-black ground, chrome or otherwise.
- **The focus ring is still one ring.** It is blue at `--marker`'s new
  measurement — 6.65:1 on the page, 6.59:1 on the chrome, 6.20:1 on the
  panel — on every one of the three surfaces rather than the one this
  file used to have to cover.

**Cards still need their border, and for almost the same reason as two
days ago — just not the one you'd guess.** `--card` is `#111111`: on the
`#0F1011` page that is **1.01:1**, and on the `#181818` panel a card
usually sits on, it is **1.06:1** — lighter to darker rather than the old
"cards step up" direction, and close enough either way that eye and
instrument disagree about which one is which. A card without its border
is still not a flatter card, it is an invisible one; what changed is that
there are now three surfaces this is true of instead of one, and the
border has to say so on all three.

The rail carries no labels at rest, same as two days ago, and it still
opens: point at it and the column widens in place to 260px. What sits
inside the open column changed — a tinted switcher badge, a search field,
a "Main Menu" label, nav rows on a neutral fill rather than a coloured
glyph — and the written kit's own Layout section is where that is
itemised; the mechanism itself (hover, a cookie, a fixed 56px rest state)
did not move.

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

**Everything that contains something is still 10px.** Cards, panels,
popovers, selects, the period track, tables — unchanged by this pass,
because the argument for one container radius never depended on which
theme sat under it.

**Everything you press is 8px, and there is no pill this time — nor is
there a next time.** This has flipped between a pill and a rounded
rectangle twice now: the reference before the cyan console pilled every
pressable thing, the cyan console kept the pill, and this Figma draws
none. Two flips with no stated reference produced a genuine "which one is
right" argument each time; this file names the 4 September 2026 Figma as
the reference specifically so a third flip needs a new design behind it,
not a preference. `buttonVariants`' base class carries `rounded-control`
(8px) rather than `rounded-full`; the period track's segments do the
same. The WRAP exception the last flip needed — a control that wraps to
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

**Hairlines still carry structure; shadows still barely exist.** The card
shadow is now the Figma's own value, `0 1px 2px rgb(0 0 0 / .20), 0 0 3px
rgb(0 0 0 / .10)`, shared by both themes rather than floored only on
dark. The elevation ladder keeps its unused rungs so vendored components
compile, and the same two are ever chosen on purpose — `card` in the page
flow, `pop` for anything floating, with the floating ones keeping their
white inset ring on dark.

---

## 6. Type

**Set in `system-ui`**, with `-apple-system` one rung down for older Safari and
Inter last. The reference's export names "SF Pro", and this chased it with
`-apple-system` first — but the reference's own rendered page reports
`System-ui Semi-bold` in the inspector. It is asking the platform for its UI
face, not naming Apple's. `system-ui` is the same thing said correctly: SF Pro
on Apple hardware, Segoe UI Variable on Windows, the platform's own face on
Linux.

**The display face is still gone, and the number holding its place got
smaller.** Instrument Sans ran page titles, the landing hero and the metric
numeral; the distinction this interface draws is between the chrome and the
NUMBER, and that argument does not need the numeral to be 36px to work —
this Figma draws it at **28px**, Inter 600, and 28 against a 15px interface
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
  job. Real anchors, so a link pasted into Slack opens on the sender's view. The
  active tab takes a 2px green rule **and** goes white while the others stay
  muted. It has held three colours and only this one carries the state alone:
  the green it started as measured 1.78:1 on the light ground, the violet that
  replaced it managed 4.41:1, and this is 9.20:1. The white label is what the
  other two could not afford — with the rule legible on its own, the label is
  free to say SELECTED rather than LINKED, which is what a coloured word says.
- **Period track** — six mutually exclusive windows in a 32px bordered
  `--control` groove, segments filling it edge to edge. Track and segments are
  both capsules; `overflow-hidden` plus `h-full` is what makes them agree, so
  the first and last segment's outer corners land on the track's own and the
  lit segment reads as a pill inside a pill.

  *This entry is a correction.* One pass read "all buttons and timeline buttons
  have 999 radius" as licence to restyle the control and deleted the border,
  the fill and the enclosure, leaving six bare labels on the page. Nobody asked
  for that; a radius is a radius. The groove is the design this product has and
  `tests/console-theme.test.ts` now asserts its three properties, so losing
  them again has to be deliberate.
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

**The builder's canvas.** Out of scope for this pass by instruction, same as
last time. `--canvas-bg` keeps its frozen value, `#1B191A` — the OLD page
ground, from before either retheme — rather than moving to this pass's `#0F1011`.
Two days ago that value happened to equal the page ground,
which is the coincidence that closed a seam a previous pass had opened;
this pass reopens it, on purpose, because moving `--canvas-bg` would be a
canvas decision and none has been made. It is the same seam a previous
pass closed by coincidence, not a new one — the builder's *chrome* (its
toolbar, config panel and modals) still follows the primitives, so it
inherits every token change in this pass without the canvas itself having
been touched.

Do not treat any of the three as the reference for anything else.
