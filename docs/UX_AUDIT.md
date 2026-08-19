# UX / UI audit — the flow builder and the app around it

Written 2026-08-18, against `main`. Scope: everything the user sees. **No
backend, engine, connector or ingestion change is proposed anywhere in this
document.** Every recommendation is a component, a layout, a piece of copy, or
a rule about which existing thing is shown when.

> **Status — all five stages shipped, every defect closed, plus a density
> pass.** All twenty items in §9 and all fourteen defects in §8 have landed,
> each marked ✅ below; §9b and §9c cover the label/icon and declutter rounds
> that followed the first screenshots. The verification bar was met after every stage:
> `typecheck`, **1,392 tests / 112 files**, `build`, `check:orphans`.
> Behavioural changes are sabotage-verified in the repo's convention — the pin
> is broken, confirmed to fail alone, and restored.
>
> §10 (what not to change) still stands, and is the part of this document with
> the longest shelf life.

Read alongside `STATE.md` (what is switched on) and `docs/DATA_MODEL.md` (what
each connector guarantees). This file answers a different question: **can a
stranger build the metric they came for, alone, on the first sitting?**

---

## 0. The verdict in one paragraph

The engine is ahead of the interface. The hard product thinking — what happens
when a duplicate field is empty, which record survives a tie, whether a range
includes its last day, what a metric's denominator quietly excluded — is
*already solved and already written down on screen*, and that work is
genuinely rare. What is not yet solved is the **first ten minutes**: the
vocabulary is inconsistent across screens, the canvas hides the part of the
graph that most often goes wrong, the build loop asks for two clicks where
Zapier asks for zero, and one step (Calculate) carries two entirely different
mental models behind a single sixteen-item dropdown. None of that is deep. All
of it is between a new user and their first number.

At 300,000 users, every ambiguity in this document is a support ticket
multiplied by six figures. The fixes below are ordered by that arithmetic.

---

## 1. The core thesis: the picker is the product's taxonomy

A first-time user does not learn your product from documentation. They learn it
from **the list of steps they are offered**, once, in the moment they press "+".
That list is the entire mental model they will carry for the rest of their
account's life.

Today that list is:

| Stage | Step | What the user thinks it means |
|---|---|---|
| Data | Get data | ✅ correct instantly |
| Data | Combine data | ⚠️ *two unrelated operations wearing one name* |
| Conditions | Filter records | ✅ correct instantly |
| Conditions | Split into paths | ✅ correct, though rarely needed |
| Calculation | Calculate | ❌ *two unrelated operations wearing one name* |
| Calculation | Time between | ✅ correct, and excellent |

Two of six entries are compound. That is the single biggest comprehension cost
in the builder, and it comes from a decision that was *right for the engine and
wrong for the picker*: merging Count into Calculate, and matching into Combine,
removed real duplication from `engine.ts` — but the picker inherited a merge it
should not have.

**The fix is free: one engine node, two picker entries.**

`NODE_META` is a display-layer map. Nothing stops it listing two entries that
both create a `formula` node with different `defaultConfig`. The engine, the
validator, `parseGraph`, and every stored flow are untouched.

```
Calculation
  ├── Summarise records      → formula, defaultConfig { op: "count" }
  │     "Count, total or average the records flowing in"
  └── Compare two numbers    → formula, defaultConfig { op: "percentage" }
        "A rate, a ratio, a % change — from two earlier steps"

Data
  ├── Combine data           → unite, defaultConfig { mode: "stack" }
  │     "Put several steps' records on one line"
  └── Match against a list   → unite, defaultConfig { mode: "match" }
        "Keep only records that appear (or don't) in another step"
```

The user who wants "how many calls" and the user who wants "what % showed up"
now take different doors and never see each other's controls. The user who
wants "only the leads that are also in the sheet" finds it by its own name
instead of discovering a checkbox inside a step called Combine.

Both panels stay exactly as they are — the panel already branches on
`isDatasetFormulaOp(op)` and on `mode === "match"`. You are changing which door
leads there, not what is behind it. And because the op dropdown remains inside
each panel, a power user can still switch a Summarise into a Compare without
deleting the step.

**Tradeoff, stated:** the picker grows from 6 entries to 8. That is the right
direction — Zapier's action list is enormous and nobody is confused by it,
because each entry means one thing. Six ambiguous entries are harder than eight
unambiguous ones.

---

## 2. Information architecture — the app around the builder

### 2.1 Flows are not in the navigation

The header offers **Dashboard · Integrations · Settings**. The flow builder —
the core of the product, the thing the entire ingestion engine exists to feed —
is reachable only by:

- a "New flow" button on the dashboard,
- a link inside the onboarding checklist, which disappears forever once one
  tile is published,
- typing the URL.

A user who publishes one metric, closes the tab, and comes back next week has
**no visible path to their flows**. They will assume the dashboard is the
product and that metrics are not editable.

**Fix:** `Dashboard · Flows · Integrations · Settings` in `app-header.tsx`. One
line. This is the highest value-per-character change in the audit.

### 2.2 Two builders are exposed at once

The dashboard header renders three actions: **Refresh**, **New flow**, and
**Classic metric** (→ `/dashboard/metrics/new`, the retired form builder). A
new user reads "Classic" as "the stable one" and takes it. They then land in a
completely different authoring model, produce a `metrics` row instead of a
flow, and never see the canvas.

**Fix:** remove "Classic metric" from the dashboard. Keep the routes alive so
existing metrics still open and edit — just stop advertising a second way in.
Same for `/dashboard/funnels/new`. One product, one way to build.

### 2.3 The dashboard's action row has no hierarchy

Three buttons of near-equal weight: a bordered Refresh, a black New flow, a
bordered Classic metric. Once Classic is gone, the pair should read:

- **New flow** — the only filled button.
- **Refresh** — demote to an icon button with a tooltip, or fold it into the
  range pill row. It is a maintenance action, not a primary one; it currently
  competes with the one action you want people taking.

### 2.4 Terminology drift across screens

The same object is called five things:

| Screen | Word used |
|---|---|
| `flows/page.tsx` h1 | "Metric flows" |
| dashboard button | "New flow" |
| onboarding checklist | "your first flow" |
| flow list status pill | "published" / "draft" |
| what it produces | "metric", "tile", "result", "output", "endpoint" |

Pick two words and enforce them everywhere:

- **Flow** — the thing you build. (h1 becomes "Flows".)
- **Metric** — the number a flow publishes to the dashboard.

Then: "endpoint" never appears in UI copy (it is currently only internal —
keep it that way), "output" never appears (the legacy Output node is hidden
anyway), "result" is reserved for the Test tab's own heading.

### 2.5 Raw machine strings leak into three user-facing places

The product has `eventTypeLabel()` and `sourceStyle()` for exactly this, and
uses them correctly in the builder — but not on the dashboard:

- **Source filter pills** render `{srcName}` — the user sees `gsheets`,
  `close`, `webhook` rather than *Google Sheets*, *Close*, *Custom webhook*.
- **Recent activity table** renders `{e.source}` and `{e.eventType}` raw —
  `close` / `lead_created` instead of *Close* / *Lead created*.
- **Legacy `MetricTile`** renders `{tile.result.value}` with no formatter,
  while `FlowTile` next to it runs everything through `formatMetricValue`. Two
  tiles side by side on one board, one reading `1234.5` and one reading
  `1,234.5`.

These are one-line substitutions using functions that already exist.

---

## 3. First run — from empty canvas to first number

This is the sequence that decides whether someone becomes a customer, and it is
currently the least-designed part of the builder.

### 3.1 The empty canvas says too little and allows too much

Today: a dashed box, *"Start by pulling data from an app."*, one button, and
then the **full six-step picker**.

Two problems:

1. **A first step that isn't Get data is a guaranteed dead end.** Nothing stops
   a new user picking "Filter records" first. They get a card reading *"Needs
   setup — Connect an input"* with no input to connect and no way to fix it
   except deleting the step. `createNode` places it, `computeNodeStatus` marks
   it `setup`, and the flow cannot progress.
2. **Nothing says what a flow is.** "Start by pulling data from an app" tells
   them the first move but not the shape of the game.

**Fix — a real empty state:**

```
        ┌─────────────────────────────────────────┐
        │   Build a metric in three moves          │
        │                                          │
        │   1. Get the records   →  from a         │
        │      connected app                       │
        │   2. Narrow them       →  keep only      │
        │      what counts                         │
        │   3. Turn them into    →  a number for   │
        │      a number             your dashboard │
        │                                          │
        │        [ + Get data ]                    │
        │                                          │
        │   Connected: Close · Google Sheets       │
        └─────────────────────────────────────────┘
```

The button is **not** the generic picker — on an empty canvas it creates a Get
data step directly and opens its panel. The three-line explainer is the only
onboarding text in the builder and it earns its place, because it is the mental
model in eleven words.

If the org has **no connections**, the button instead reads
**"Connect an app first →"** and links to `/integrations`, because every other
path from here dead-ends at "No connected accounts yet" inside the panel.

### 3.2 Templates are gone — what replaces them

You removed the four starter templates (done in this session: `templates.ts`
deleted, gallery removed, `createFlowFromTemplateAction` removed, engine
coverage preserved as an inline fixture in `tests/time-between.test.ts`).

That is defensible — templates that only fit Close and Calendly users are noise
to the other 80% — but it removes the only worked example in the product. The
replacement is **not** a template gallery. It is:

- the three-line explainer above (what a flow *is*),
- the guided per-step rhythm in §4 (what to do *next*),
- and the setup hints already in `setupHint()` (what is *missing*).

All three are generic. None of them assume a CRM.

### 3.3 The onboarding checklist stops too early

`OnboardingChecklist` shows *connect → build → publish*, then vanishes forever
once one tile exists. It is well-built and honestly state-driven. Two gaps:

- It lives **only** on the dashboard's empty state. A user mid-way through
  their first flow has left it behind and has nothing.
- Step 2 says "Build your first flow" — but the hard part is not starting one,
  it is finishing one. Roughly: people create a flow and abandon it unpublished.

**Fix:** keep the checklist, and add a fourth state — when `hasFlow &&
!hasPublished`, the checklist's step 3 CTA should deep-link to *that specific
draft* ("Finish 'Untitled flow' →"), not to the flow list.

---

## 4. The build loop — the rhythm of Configure → Test → Continue

This is the part that most resembles Zapier and is closest to right. Three
changes take it the rest of the way.

### 4.1 Auto-test on Continue

Today the guided footer is:

```
Configure tab  →  [ Continue ]        (switches to Test tab)
Test tab       →  [ Test ]            (runs it)
after success  →  [ Retest ] [ Continue ]
```

So every step costs **two deliberate clicks** before the user sees data, and
the middle click has no purpose except to arrive at a button. Zapier collapses
this: pressing Continue runs the test.

**Fix:** Configure's `[ Continue ]` switches to the Test tab **and immediately
fires `onTest()`**. The user presses one button per step and watches their data
appear. `Retest` remains for the deliberate re-run. Nothing about the test
mechanism changes — only who triggers it.

This also fixes a subtler thing: today a user *can* skip testing entirely and
publish an untested flow. Auto-testing on the natural forward path means almost
every published flow has been seen working.

### 4.2 `onTestUpstream` is wired up and never rendered — a defect

`onTestUpstream` is created in `flow-canvas.tsx`, passed to `ConfigPanel`,
destructured, typed, and passed again into `NodeConfig` — where it is
destructured, typed, and **never used**. Its own comment calls it *"the cure
for an empty field picker."*

The disease it cures is real and common: a user opens a Filter, clicks the
field picker, and reads *"No data yet. Test an earlier step to bring its fields
here."* — which is an instruction to leave the step they are on, find the step
above, open it, run its test, come back, and re-open the picker. Five actions
to answer a question the panel could answer with one button.

**Fix:** render it. In the `DataBrowser` empty state, when `onTestUpstream`
exists:

> **No fields yet.**
> The step above hasn't been tested, so we don't know what its records look
> like.
> **[ Test the previous step ]**

`check:orphans` did not catch this because it only tracks exported functions,
not props. Worth a glance for other props threaded but unused.

### 4.3 There is no way to run the whole flow

Every test is per-step. A user with a six-step flow who changes step 1 must
re-test six steps, one panel at a time, because `markDirtyFrom` correctly marks
all descendants dirty. There is no "run everything" anywhere, and the only way
to see the flow's final number is to open the last step and test it.

**Fix:** add **[ Test flow ]** to the toolbar, beside Undo/Redo. It walks the
steps in `computeStepNumbers` order calling the existing per-step test, updates
each card as it lands, and needs no new backend path. The canvas becomes a live
progress display — which is exactly the moment a user understands what they
built.

This is also the honest answer to "what does my metric say right now?" before
committing to Publish.

### 4.4 The status vocabulary needs one more level of contrast

`STATUS_META` today:

| Status | Label | Colour |
|---|---|---|
| `setup` | Needs setup | grey |
| `untested` | Ready to test | grey |
| `updating` | Testing… | blue |
| `ready` | Ready | green |
| `error` | Error | red |

**"Needs setup" and "Ready to test" are the same grey.** One means *this step
is broken and the flow cannot publish*; the other means *this step is fine, I
just haven't run it*. They are opposite states wearing the same badge, and they
are by far the two most common states on a half-built canvas.

**Fix:**

| Status | Label | Colour | Why |
|---|---|---|---|
| `setup` | **Needs setup** | **amber** | It blocks publish. Amber is the product's existing "you must look at this" tone. |
| `untested` | **Not tested** | grey | Neutral, non-blocking, accurate. |
| `updating` | Testing… | blue | unchanged |
| `ready` | **Tested** | green | "Ready" over-promises — it means the test passed, not that the flow is correct. |
| `error` | Error | red | unchanged |

"Not tested" also reads better than "Ready to test", which is an instruction
disguised as a status.

### 4.5 A running test can take 90 seconds with no way out

`pollTestResult` ticks 112 × 800ms. During that window the footer is a disabled
**"Testing…"** and the card shows a blue chip. There is no elapsed time, no
progress, and **no cancel**. The three failure messages at the end are
excellent and specific — but 90 seconds of a dead button is a long time to earn
them.

**Fix:** after ~8 seconds, replace the disabled button with:

> Testing… **12s** · [ Cancel ]

Cancel just stops polling client-side and restores the previous state (the
background run settles harmlessly on its own). Also consider surfacing the
existing honest note earlier: at ~30s, add *"Large date ranges take longer —
you can narrow this step's date range to speed it up."*

---

## 5. The canvas

### 5.1 The canvas hides the connections most likely to be wrong

`displayEdges` deliberately drops every `a`/`b` reference edge, and
`structuralEdges` hides them from layout. The reasoning in the comments is
sound — reference lines would cut diagonally across the canvas and turn a clean
column into spaghetti.

But the consequence is that **a Compare step's two inputs are invisible**.
Looking at the canvas, nothing shows that step 5's denominator comes from step
2. The product has already had to paper over this twice: the `recordSourceNote`
("Reads records from 2. Calls dialed") and the `formulaExpression` line in the
panel both exist to describe a relationship the drawing refuses to draw.

**Fix — selection-scoped reference edges.** Draw the `a`/`b` edges *only when
the compare step is selected or hovered*, as thin dashed lines in a distinct
colour, labelled with the handle name ("Count this" / "Out of this"). Default
canvas stays clean; the moment you look at the step, its wiring appears.

Additionally, put a compact chip on the compare card itself:

```
┌────────────────────────────────┐
│ ⬤  5. Show-up rate      Tested │
│    38%                          │
│    ◆ 2. Meetings ÷ ◆ 4. Booked │   ← new line, grey
└────────────────────────────────┘
```

The card then says what it computes without being opened. This is the single
change most likely to prevent "why is my number wrong" tickets.

### 5.2 Which steps become dashboard tiles is invisible until Publish

A step becomes a metric by being a **structural terminal**. That rule is never
stated and never shown. Consequence, straight from the code you deleted this
session: the no-show-rate shape produced *three* offered metrics, because its
two count steps are structural terminals whose only outgoing edges are `a`/`b`
references that the layout drops — and the only defence was pre-seeding them
`enabled: false` in the template. Hand-built flows have no such defence: the
user opens Review & publish and is offered three metrics where they expected
one, with no explanation.

**Fix:** show it on the canvas. Every terminal card gets a small badge:

```
  📊 Goes to dashboard
```

Now the rule is learnable by looking, the three-metric surprise happens *while
building* rather than at the publish gate, and the user can react by connecting
the stray step into something.

### 5.3 No zoom, fit, or minimap controls exist

`README.md` claims the canvas has "drag/connect/zoom/pan, minimap". The code
has none of that: `nodesDraggable={false}`, `nodesConnectable={false}`, no
`<MiniMap>`, no `<Controls>`. Panning is scroll, zooming is pinch or ⌘-scroll,
and **nothing on screen says so**.

The *behaviour* is right — a managed layout is the correct call for this
audience, and I would not add dragging. What's missing is the affordance:

**Fix:** a small floating control cluster, bottom-left, matching the rounded
Make-ish language already in use:

```
  [ + ]  [ − ]  [ ⤢ Fit ]
```

Three buttons calling `rf.zoomIn/zoomOut/fitView`. That is the whole change.
A minimap is unnecessary for a single managed column — skip it, and fix the
README instead (see §8).

### 5.4 Backspace deletes a step with no confirmation

The keydown handler routes through `requestDelete`, which confirms for Paths
hubs and branches — but a plain step is deleted immediately via
`deleteAndReconnect`. Since cards are *selected by clicking* and are *not
editable in place*, the sequence "click a card, reach for the keyboard, press
backspace" is entirely plausible, and it silently destroys a configured step.

Undo exists (⌘Z) but nothing tells the user that.

**Fix — cheapest effective version:** keep the instant delete, and show a
transient toast: *"Step deleted. **Undo**"* for ~6 seconds. This is better than
a confirm dialog, which would slow down deliberate deletes on a canvas where
deleting is common.

### 5.5 The panel + flyout eat the screen on a laptop

The config panel is a fixed `w-[452px]`, and the `DataBrowser` flyout opens to
its **left** at a default 340px. Together: **792px**. On a 1280px MacBook Air
that leaves 488px of canvas — and the flyout is opened constantly, because
every field, value, number and moment is picked through it.

**Fix, in order of effort:**
1. When the flyout opens, pan the canvas so the selected card stays visible in
   the remaining space (the code already does exactly this kind of minimal-nudge
   panning in `continueFromNode` — reuse that math).
2. Below ~1200px viewport width, let the flyout overlay the panel rather than
   sit beside it, with a back arrow.

There is currently **no responsive handling at all** — `h-screen` flex, fixed
pixel widths, no breakpoints. For an enterprise product that will be opened on
13" laptops constantly, this deserves a pass.

---

## 6. Per-step notes

### 6.1 Get data — the strongest panel in the product

Account → resource fields → Record type → Remove duplicates, with the import
status line under the account and the honest history note. Very little to
change.

- **"Keep one record per…"** as the checkbox label is good, but the collapsed
  state below it reads *"Collapse records that share a value down to one, right
  as they load."* — that sentence is doing explanation work in the *off* state
  where nobody has asked a question yet. Trim to: *"Remove duplicate records as
  they load."*
- The dedupe block's border and internal `Field` labels make it visually
  heavier than the fields above it, despite being optional. Move it below a
  thin divider labelled **Options**, so the required path reads top-to-bottom
  without interruption.
- **"Record type"** vs the provider's own "event type" is handled thoughtfully
  in the code comments. Keep the label; consider the hint *"What kind of record
  to pull — leave as All if you're not sure."*

### 6.2 Filter — good, but the date range is hiding

`DateRangeSection` renders as a collapsed accordion at the *bottom* of the
panel, under the conditions, reading **"Date range · off"**. Yet limiting a
metric to a period is one of the two most common things anyone does to a
metric, and the internal comment already acknowledges this ("a prominent 'Date
range' quick section lives inside Filter").

It is not prominent. It is a grey collapsed row below the fold.

**Fix:** promote it to a **segmented control at the top of the Filter panel**:

```
  Time period    [ All time ▾ ]        ← Last 7 days, Last 30 days,
                                          This month, Custom…
  ───────────────────────────────
  Only continue if…
  [ conditions ]
```

Same config shape (`dateRange`), same engine, same `describeWindow()` sentence
underneath — which is excellent and should stay exactly as it is. Only the
prominence changes.

### 6.3 Calculate — see §1, plus two panel notes

Beyond the split into two picker entries:

- **"What are you calculating?" → "A number" / "A length of time"** is asked
  *after* the Calculation dropdown, which means the user picks `median` before
  saying they're measuring time. Ask it **first**: it changes what the rest of
  the panel offers, and it is the cheaper question.
- The blue expression box (`datasetCalcExpression` / `formulaExpression`) is a
  genuinely great pattern — a plain-English restatement of the configuration,
  above the controls. **Extend it to every step**, not just Calculate. A Filter
  could read *"Keep records where Direction is exactly 'outbound'"*; a Get data
  step *"All Lead created records from Close (Acme)"*. This is the cheapest
  comprehension win available and the component already exists.

### 6.4 Combine — see §1

Splitting stack from match into two picker entries removes the checkbox
entirely, and the panel's warning *"Matching compares exactly two steps — this
Combine has 3 wired in"* becomes a constraint the UI can enforce up front
rather than a message after the fact.

### 6.5 Split into paths — correct, and correctly rare

The auto-created "Path conditions" head per branch is the right Zapier-style
move. The entry-mode dropdown living on the branch head rather than the hub is
also right. No changes proposed.

One copy note: branches default to *"Path A" / "Path B"*. Prompt for real names
by using placeholder text in the label inputs (*"e.g. Enterprise"*) rather than
prefilling a value the user will leave.

### 6.6 Time between — the best-designed step, one gap

Configuring it by picking variables — *Match records by*, *Start the clock on*,
*Stop the clock on* — is exactly right, and the `MomentInput` showing
"2. Calls dialed › occurredAt" solves the hardest ambiguity in the product
(two lanes, same field name) with no jargon at all.

The gap: **it is unusable until upstream steps are tested**, because
`momentGroups` derives entirely from `lastTest.outputSchema`. Fixing §4.2
(render `onTestUpstream`) matters more here than anywhere else in the builder.

---

## 7. Review & publish, and the payoff

### 7.1 The modal asks seven questions per metric

Name, Show as, Format, Time reference, Group by, Decimals, Goal — plus a
checkbox — for **each** endpoint, in a 512px-wide modal that scrolls. For a
user who wants one number on a dashboard, six of those seven have correct
defaults.

**Fix — progressive disclosure:**

```
  ☑  Speed to lead                              4h 45m
     Name  [ Speed to lead              ]
     ▸ Display options                          ← collapsed
```

"Display options" holds Show as / Format / Decimals / Goal / Group by. **Time
reference stays visible**, because it is the one setting that silently changes
which records count in which period — the code comment says exactly this and it
is right. Everything else is presentation.

### 7.2 "Time reference" is the hardest concept in the modal

Current label + hint: *"Time reference" / "Which date the dashboard's Today /
Last 7 days uses."* Accurate, but abstract on first read.

**Better:** label it **"Which date puts a record in a period?"** with the hint
*"A meeting can belong to 'today' by when it happens, or by when it was
booked."* — the concrete example is what makes it land, and it is already
written in your code comments.

### 7.3 The publish button hides its own consequence

**"Publish 1 metric"** is accurate but says nothing about what happens next.
Users hesitate at irreversible-sounding buttons.

**Fix:** a line above the button — *"This adds 1 tile to your dashboard and
keeps it updating automatically. You can edit or unpublish any time."* The
reassurance is true and the hesitation is real.

### 7.4 The dashboard tile is excellent

`FlowTile` is the best-designed component in the app. The em-dash-not-zero rule,
the "Updated 4 minutes ago" honesty marker, the import-progress bar with days
rather than a fake percentage, the "showing 6 largest of 11 groups" admission,
the error message with a "Fix in the editor →" link — this is the standard the
rest of the UI should be held to.

Two small things:
- The legacy `MetricTile` beside it does none of this (see §2.5). Once the
  classic builder is de-advertised, consider rendering legacy metrics through
  the same tile component.
- The tile's local `Tile` type omits `"duration"` from `format` and omits
  `durationDisplay` entirely, while `TileSpec` and `MetricSpecSchema` both carry
  them. It works at runtime because `row.tile` is cast from `unknown` and the
  fields ride through the spread — but it is a type that disagrees with its own
  data, and the next person to construct a tile literal will drop the duration
  fields silently.

---

## 8. Defects found

Ranked by user impact. None require backend changes.

| # | Severity | Defect | Status |
|---|---|---|---|
| 1 | **High** | `onTestUpstream` is threaded from `flow-canvas.tsx` → `ConfigPanel` → `NodeConfig` and never rendered. The documented cure for an empty field picker does not exist on screen. (§4.2) | ✅ fixed |
| 2 | **High** | "Needs setup" and "Ready to test" share one grey badge — a blocking state and a non-blocking state, visually identical. (§4.4) | ✅ fixed |
| 3 | **High** | Flows are absent from the header navigation; after the onboarding checklist disappears there is no visible route to them. (§2.1) | ✅ fixed |
| 4 | **Med** | A first step other than Get data creates a permanent dead-end card the user can only delete. (§3.1) | ✅ fixed |
| 5 | **Med** | Backspace deletes a configured step instantly, with no confirmation and no visible undo affordance. (§5.4) | ✅ fixed |
| 6 | **Med** | `Select` never scrolls the keyboard-active option into view — `listRef` is assigned and never read. Arrow-keying through Close's long option lists moves the highlight off-screen. | ✅ fixed |
| 7 | **Med** | Dashboard source pills and the Recent-activity table print raw machine strings (`gsheets`, `lead_created`) while the rest of the product humanises them. (§2.5) | ✅ fixed |
| 8 | **Med** | Legacy `MetricTile` prints unformatted numbers beside `FlowTile`'s formatted ones — same board, two number formats. (§2.5) | ✅ fixed |
| 9 | **Med** | A test can occupy the panel for 90 seconds with no elapsed time and no cancel. (§4.5) | ✅ fixed |
| 10 | **Low** | `README.md` claims the canvas has drag, connect, zoom controls and a minimap. It has none — nodes are undraggable and unconnectable by design, and no `<MiniMap>`/`<Controls>` is mounted. Fix the README, not the canvas. | ✅ fixed |
| 11 | **Low** | `NodeLibraryModal` runs an unconditional `requestAnimationFrame` loop for as long as it is open, re-measuring the anchor every frame even when the canvas is still. | ✅ fixed — loop still runs (the canvas can pan at any moment), but writes only on change |
| 12 | **Low** | Undo/Redo toolbar buttons never disable, so they look actionable with empty history. | ✅ fixed |
| 13 | **Low** | `FlowTile`'s local `Tile` type contradicts `TileSpec` on duration fields. (§7.4) | ✅ fixed |
| 14 | **Low** | No responsive handling anywhere in the builder: fixed `h-screen`, fixed panel and flyout widths, no breakpoints. (§5.5) | ✅ fixed |

---

## 9. What to do first

Sequenced so that each stage is independently shippable and each one is
testable by the people you're about to put in front of it.

**Stage 1 — navigation and first run** ✅ shipped
1. ✅ Add Flows to the header nav. (§2.1)
2. ✅ Remove "Classic metric" from the dashboard. (§2.2)
3. ✅ Real empty-canvas state; first step is always Get data. (§3.1)
4. ✅ Amber "Needs setup", grey "Not tested", green "Tested". (§4.4)
5. ✅ Humanise source and event-type strings on the dashboard, and run legacy
   metric tiles through the same formatter as flow tiles. (§2.5)

**Stage 2 — the build loop** ✅ shipped
6. ✅ Auto-test on Continue. (§4.1)
7. ✅ Render `onTestUpstream` — as a banner at the top of the panel rather than
   inside the picker's empty state, so the user meets it before opening a
   picker rather than after. (§4.2)
8. ✅ "Test flow" in the toolbar — sequential, in step order, skipping steps
   that need setup, doubling as the Stop control while it runs. (§4.3)
9. ✅ Elapsed time + Stop on a running test, with the narrow-your-range hint at
   30s. (§4.5)
10. ✅ Undo notice on step delete. (§5.4)

**Stage 3 — the taxonomy** ✅ shipped
11. ✅ Split Calculate into *Summarise records* / *Compare two numbers*. (§1)
12. ✅ Split Combine into *Combine data* / *Match against a list*, and replace
    the buried match checkbox with a named mode control. (§1)
13. ✅ Promote the time period to the top of Filter — mode and preset collapsed
    into one list, with "All time" as a real selectable answer. (§6.2)
14. ✅ Extend the plain-English summary to Filter, Get data, Combine, Paths and
    Time between. (§6.3)

Also landed with Stage 3: `NODE_META` is gone. It was the picker's per-type
table, and once the picker became a list of jobs its label half duplicated
`NODE_LABELS` while its blurb and keyword halves were read by nothing —
editable, plausible, and inert. `ALL_TYPES` now derives from `NODE_TYPES`.

**Stage 4 — canvas honesty** ✅ shipped
15. ✅ Selection-scoped reference edges (dashed, indigo, labelled with the slot
    they fill) + the compare card's own "2. Meetings ÷ 4. Booked" line. (§5.1)
16. ✅ "Goes to your dashboard" / "Not published" badge on terminal steps, with
    the rule extracted to `publishesToDashboard` and pinned. (§5.2)
17. ✅ Zoom in / out / fit cluster, bottom-left. Nodes stay undraggable and
    ports unconnectable — only the view controls that already existed are now
    visible. (§5.3)

**Stage 5 — publish and polish** ✅ shipped
18. ✅ Review & publish collapses five presentation settings behind "Display
    options"; name and the time reference stay in the open. (§7.1)
19. ✅ "Time reference" → "Which date puts a record in a period?", with the
    concrete meeting example, plus the publish reassurance line. (§7.2, §7.3)
20. ✅ Responsive pass: the panel yields below 484px of viewport, and the field
    browser overlays it rather than squeezing beside it when there is under
    280px of room — with a close button in its search row, since "click
    outside" stops being a way back once it covers its own trigger. (§5.5)

**Now run your user tests.** The mechanical friction that would otherwise have
dominated the feedback is gone; what surfaces from here will be about the
model, which is what is actually worth learning.

---

## 9b. The density pass (after the first round of screenshots)

A screenshot of the Match panel caught what a code read had not: the step's
own copy contradicted the mode it was in. That triggered a pass over every
label in the builder, on one rule — **the shortest wording that still means
one thing.**

**A bug the split had left behind.** The Combine panel opened with a standing
paragraph — *"Brings branches and other data steps back together — later steps
see records from all of them"* — rendered in **both** modes. So a step set to
"Keep only records that match" led with a sentence promising the opposite. The
paragraph is gone. (§9c removed the summary box that briefly replaced it: the
step's own name, icon and field labels already answer which of the two it is.)

**Labels cut to fit the narrowest place they appear.** A canvas card is 256px
and already spends most of it on a step number, an icon, a status and a menu.
"Match against a list" left about eleven characters, so the card read
`2. Match ...` — worse than nothing, because it takes the space, draws the eye
and withholds the answer. Now: Get data, Combine, **Match**, Filter, Split,
**Summarize**, **Compare**, Time between. The picker's blurb does the
explaining, once, at the moment of choosing. `NODE_LABELS` moved with them so
validation messages and cards can't drift apart. Pinned at ≤13 characters.

**The status badge became a dot.** "Needs setup" was 72px of a 256px card,
taken from the title, to say something the border colour and the (now amber)
hint line already said. The dot carries the state, the hint says what to do —
which is strictly more useful than the word "Needs setup" — and the full label
is in the tooltip and in the panel header, where there is room.

**Setup hints became fragments.** They were sentences inside twenty characters
of usable width, arriving as "Wire in the ...". *Pick an account. Needs two
steps. Add a condition. Pick two numbers.* No full stops — these are labels,
not prose.

**A new `Segmented` control** replaces the full-width dropdown on every binary
choice: Stack/Match, A number/A length of time, One number/A trend, Is in/Is
not in. A dropdown for two options costs a click to reveal an answer that would
have fitted on screen, and hides the alternative — which is the half that
teaches what the control is for. Longer or growing lists stay a `Select`.

**Icons now distinguish the two doors of each merged step**, since they share a
node type and would otherwise share a face: Combine keeps the merge arrows,
Match gets a Venn — the one picture everyone already reads as "only the part in
both". Summarize gets rising bars ("records become one number"), Compare gets
the division sign. The old Calculate glyph was trying to mean both halves at
once and read as neither. And an unconfigured Get data step — the picker's own
entry included — used to render a grey tile reading **"Ap"**, which looks like
a failed image; it now shows the database glyph until an app is chosen.

### 9c. The declutter pass

Screenshots again, and the rule tightened: **if the controls already say it,
delete it.**

**The step-summary box is gone.** §6.3 argued for extending Calculate's
plain-English restatement to every step. On screen it was clutter: *"All
records from Google Sheets · eliascroesus@gmail.com."* sat above an Account
picker reading exactly that, and *"Passes every record through — no conditions
yet."* sat above an empty condition list. A restatement earns its place only
when it composes something the controls show separately — which is true of a
two-number Compare (*"Meetings ÷ Booked × 100"*, naming two other steps) and
false of everything else. The box now renders for Compare alone. The
`recordSourceNote` survives, because "these records came from step 2, not the
step above" is the one thing no control on screen says.

**The Stack/Match switch is gone.** They are two entries in the picker; a mode
dropdown inside the config made them one step wearing two hats again, which is
the exact confusion the split existed to end. Which step you added is the
answer.

**Every subtitle under a control, deleted.** "Which column holds the date each
row happened on. Applies to every flow reading this sheet." · "Collapse records
sharing a value down to one." · "Ignores capitalization and extra spaces." ·
"A meeting can belong to 'today' by when it happens, or by when it was booked."
· the hints under "All time" and "Detect automatically". Where the fact was
load-bearing it moved into the label instead of sitting under it: Review &
publish's time reference is now simply **"Date the dashboard filters by"**, no
subtitle. The paragraph about adding several columns became six words.

**Date column collapses to its answer.** Asked about directly: a spreadsheet
row carries no timestamp, so something must decide which column dates it, and
that decision is stream-scoped — every flow reading the sheet shares it, which
is why it cannot live in Review & publish. But it is auto-detected and right
nearly always, so standing it up as a labelled field with a dropdown put a
question mark beside an answer. It is now one grey line — *Timing uses
"timestamp".* — with a **Change** that reveals the picker.

It is **not** the same setting as Review & publish's time reference. This one
decides what `occurredAt` *is* for a sheet row (and so what date filters,
backfill windows and dedupe ordering use). That one picks which date field a
single metric's dashboard pills bucket by.

**Canvas colour.** Status was encoded twice — a tinted card border *and* a dot
— so a five-step flow was a green card, an amber card, a grey card and a blue
one, four colours competing with four coloured step icons. Colour now belongs
to identity (which kind of step) and to the two states worth interrupting for:
amber outlines a step that blocks publish, red one that broke, everything else
is a plain neutral card. "Tested" gets no decoration at all — a canvas that
celebrates every working step has nothing left to point at the one that isn't.
Selection became a soft indigo halo rather than a hard ring at the same weight
as the status borders it had to be told apart from; edges went finer and
lighter; the dot grid receded so white cards float.

### 9d. Reverted, and a bug the screenshots caught

**The node design went back one step, at the owner's call.** §9c had taken the
status colour off the card outline on the argument that the dot already said
it. On a real canvas the flatter cards read as less legible, not calmer, so the
coloured borders, the blue selection ring, the tinted "On your dashboard" strip,
the heavier dot grid and the 2px edges are all restored. The label, icon, dot
and copy work from §9b/§9c stays.

**A real defect, introduced by §9c and visible in the screenshot: the kebab
menu lost its Delete.** Rounding the footer strip's corners meant putting
`overflow-hidden` on the card — and the kebab menu is a non-fixed popover
positioned *inside* that card, so it was clipped at the card's edge. Duplicate
fit; Delete did not. Nothing looked broken; the item simply was not there.

`position: fixed` is not the fix. React Flow's viewport is CSS-transformed, and
a fixed child of a transformed ancestor anchors to that ancestor rather than
the window — the same trap `flow-pop-in` already documents for the config
panel. The rule is that this card does not clip, and it now says so in place.

**App chrome.** The header was three undifferentiated grey links, so it could
not answer "where am I" on a product whose pages all render a white sheet with
a heading. It now has a wordmark, a filled pill on the active item (matched by
prefix so the builder still highlights Flows, and exactly for Dashboard so it
does not light up for every page under it), and a sticky translucent bar. In
the builder: Undo/Redo became icons, the save state got a dot, the back link
became an arrow, and **Review & publish is indigo** — it was the one
`neutral-900` button in a panel system built entirely on indigo, so the most
important control on screen was also the only one wearing a different brand.

### 9e. The UI kit, and the ability to see it

**I could not see any of this.** Every judgement up to here was made by reading
class names, and three defects shipped that a single look would have caught: a
clipped kebab menu, a `text-neutral-250` that resolved to no colour at all, and
a card label truncating to "2. Match …". That is now fixed at the root:

- `pnpm shot /design out.png` renders any unauthenticated route headlessly and
  writes a PNG (`scripts/screenshot.mjs`, Playwright).
- **`/design`** is the UI kit, rendered — every colour, size, radius and
  component in one scroll, built from the *same* tokens and components the
  product uses, so drift shows up there before a customer finds it. It reads no
  data and touches no session, which is exactly what makes it screenshot-able.

**The kit itself** lives in `globals.css` as Tailwind v4 `@theme` tokens, so
every token is also a utility class:

| Scale | Tokens | Rule |
|---|---|---|
| Accent | `brand-50…700` | One accent. Every primary action, selection and focus ring. |
| Ink | `ink-950…50` | The rail and any dark surface. Four elevation steps, cool-shifted. |
| Canvas | `canvas-bg/dot/edge` | So the builder's surface can't drift from its own grid. |
| Type | `micro 11 · tiny 12 · small 13 · base 14 · lead 15 · title 17 · display 24` | Seven sizes, nothing between. |
| Radius | `control 8 · card 12 · surface 16` | Three. |
| Elevation | `raised · lifted` | Two, plus `flow-shadow` for what floats over the canvas. |

The governing rule: **surfaces are neutral; chroma is reserved for identity
(which kind of step) and for state (what needs you).** A canvas where
everything is coloured can point at nothing.

**The rail is near-black, not a gradient.** It was `indigo-600 → violet-800`,
which competes with content, forces every coloured step icon to shout over it,
and dates fast. Near-black with a blue cast recedes and gives the one accent
something to mean — where Linear, Vercel and Supabase all landed. Widened
192px → 256px, the width those products converged on.

**One navigation, not two.** The flow editor rendered a rail; the other eight
pages rendered a top bar with its own links — and the two lists had already
drifted (the rail lacked Settings, the bar lacked Connections). `AppShell` now
frames every authenticated page with the rail, which also takes the account
controls: a top bar should say what you are *looking at*, and it cannot while
it is also carrying who you are and where you can go. `app-header.tsx` and
`main-nav.tsx` are deleted.

**The builder toolbar is pill groups**, Make-style: context on the left (back,
name, save state) and actions on the right (undo/redo, Test flow, publish),
floating on a hairline bar with no navigation in it at all.

**Font sizes were 9 ad-hoc values**, mostly arbitrary (`text-[10px]`,
`text-[13px]`, `text-[17px]`), so two labels doing the same job in two panels
were different sizes. All migrated to the scale; 10px folded into 11px, which
the kit declares as the floor for anything that is content. Two `text-base`
headlines that would have regressed 16px → 14px under the new scale were moved
up to `text-title` rather than shrunk.

### 9f. The editor is a canvas, so its chrome floats

The builder was carrying the app's 256px rail **and** a full-width top bar —
roughly a fifth of the screen spent framing the one page whose entire value is
room to work. Miro's answer, and Figma's: on a canvas the chrome floats *on*
the work rather than bounding it.

**Two islands, no bar.** Left says what this is — the wordmark (→ Dashboard),
the flow name, the save dot, and a ⋮ menu. Right says what you can do — undo /
redo, Test flow, the Live chip, and publish. The canvas is visible around and
between them, and nothing spans edge to edge.

**Navigation moved into the ⋮ menu**, because inside the editor it is the
rarest thing anyone wants; the rail was 256px of permanent cost for it. The
wordmark covers the common case (get me out of here) in one click.

**The right island slides when the config panel opens.** Both want the same
corner, and a Publish button behind a panel is a Publish button that does not
exist. Known and accepted: the field browser (z-30) still passes over the
island while open — it is transient, and closing it is how you get back to
publishing anyway.

**The publish error and warning banners** were full-width bands under the
header. With no header they are a floating card, centred under the islands.

Two things this round proves about the §9e tooling. The toolbar preview 500'd
on first render — a server component cannot hand function props to a client
one — and the screenshot loop caught it in the same minute it was written,
which is precisely the class of failure that shipped three times before the
loop existed. And `/design` now renders the *real* `FlowToolbar`, so the
builder's chrome is checkable without a session.

### 9g. The de-genericization pass

The owner's verdict on the first full look: "super AI and boring." Fair — and
diagnosable. What reads as "AI-built" is the absence of choices: system font,
stock Tailwind indigo, flat single-colour fills, uniform glow shadows. This
pass replaced each with a choice, grounded in live-extracted CSS from Linear,
Vercel, Stripe, Raycast, tldraw and Figma (three research agents pulled the
actual stylesheets).

**Inter, with Linear's identity settings.** `font-feature-settings: "cv01",
"ss03"` — verbatim from linear.app's live CSS; without those two features
"you get generic Inter." Body tracking −0.008em (Linear runs −0.011 to
−0.013em at UI sizes; no reference product goes further). Tabular numerals
are opt-in per element (`.tnum`), never global — Stripe's rule — applied to
the dashboard tiles whose numbers update in place.

**A chosen brand ramp.** Stock indigo-600 `#4f46e5` is the default of every
unstyled project. The new ramp is hand-tuned around a violet-iris hue
(`brand-600 #5b58d6`), and the sweep retired every `indigo-*` class in the
product — plus the flow builder's selection ring, which had been *blue* in an
indigo product since before the kit existed.

**Surfaces lit from the top.** `.btn-brand`: one-step vertical gradient,
inset highlight above, inset shade below, a darker seat-ring (the cross-brand
synthesis recipe — Raycast and Stripe ship near-identical structures). The
same treatment on every step-icon tile, so the whole interface shares one
light source — which is most of what "crafted" means. `.flow-shadow` was a
36px non-directional glow (haze); it is now Figma UI3's elevation-400,
near-verbatim: hairline ring + soft ambient + tight contact shadow (height).
Islands carry no `border` — the ring in the shadow IS the hairline, the
tldraw/Vercel border-as-shadow pattern.

**The rail became the 76px icon rail** (Make's size), on every screen
including the editor — which had dropped navigation into a ⋮ menu and left
the canvas with a bare left edge. Account moved to an avatar at the rail's
foot opening a light panel (workspace switcher, email, sign-out).

**The toolbar islands lost the ⋮** — a menu with two items is a drawer in
front of two buttons. Duplicate and Delete are now buttons on the left island
(delete confirms in a popover; both are the existing server actions, wired
with navigation on success and the toast on failure). Undo/redo moved to the
bottom-left cluster with zoom — canvas controls with canvas controls.

**Found while looking:** Next's dev-tools indicator renders at bottom-left —
the exact pixels of the rail's account avatar — and swallowed its clicks in
every dev session. Moved to bottom-right in `next.config.mjs`. This is the
fourth defect the screenshot loop has caught that reading code could not.

### 9h. Flat again, warmer, and flows you can switch off

**The gradients are gone.** The bevelled primary and the top-lit icon tiles
lasted one review. The reasoning that put them there ("flat reads as
unstyled") was half-right and wrong for this product: Linear's own primary is
a flat brand fill whose depth comes entirely from `filter: brightness()` on
hover, and on a canvas holding a dozen step tiles the bevel read as plastic.
`.btn-brand` is a flat fill; `tileStyle` is a flat colour.

**The rail is graphite, not near-black.** `#0b0c0f` was technically calm and
actually bleak — the whole left edge of the app read as a bar of absence. The
ink ladder lifts to `#23262d`, which keeps the contrast the icons need while
letting the rail read as a surface.

**The accent moved to Miro's register:** `brand-600 #4b52e0`, bluer and more
confident than the iris `#5b58d6` it replaced, which sat closer to lavender.
~5.8:1 under white text.

**Flows can be switched off — and it needed no migration.** The three states
already existed in two columns nobody was reading together:

| State | `status` | `publishedVersion` | Effect |
|---|---|---|---|
| Active | `published` | set | On the dashboard, recomputed by the sweep |
| Paused | `draft` | set | Tiles hidden, recomputes stopped, nothing destroyed |
| Draft | `draft` | `null` | Never published — cannot be turned on |

Both `publishedFlowTiles` and the materialize sweep already gate on
`flows.status`, so flipping it is the whole feature: the immutable version and
every stored result stay put, and switching back on restores the same numbers
from the same rows. Encoding "paused" as its own status value would have meant
a hand-applied migration and two columns that could disagree about one fact.
`flowState()` is the single reader, pinned and sabotage-verified.

**The flows list is a table** — the inspo's columns with Zapier's per-row
switch: filter tabs carrying live counts, an app-coloured icon per row, a
derived subtitle (`6 steps · Close CRM`, from the graph the list already
loads — `flows.description` exists on the table and has never been written),
the toggle, last-updated, and duplicate/delete. The toggle is optimistic and
reverts from the action's own answer, which is what happens on a
never-published flow where "on" is not available.

### 9i. shadcn: a real icon family, a real Button, real semantic tokens

Three things were still hand-made, and hand-made is what "AI-built" actually
looks like:

**Nine hand-drawn SVG paths.** Inconsistent optical weight, mismatched stroke
joins, and a "Calculate" mark that was three dots and a slash. Now **lucide**
— the family shadcn ships — mapped as literally as the set allows: `Database`
(records from a store), `Merge` (lanes into one line), `Blend` (two
overlapping sets, which *is* what matching keeps), `Filter`, `Split`,
`BarChart3`, `Divide`, `Timer`. Every remaining inline `<svg>` in the app went
too: nav, toolbar, zoom cluster, kebab, search, connection row. **Zero
hand-drawn SVGs remain.**

**A dozen hand-written button class strings** — `.btn-brand`, three bordered
secondaries, two greys, a red, an icon button re-declared in five files. They
had already drifted on radius, disabled treatment and focus. Now one `Button`
built with `cva`: variants `default · secondary · ghost · destructive ·
destructiveGhost · link`, sizes `sm · default · lg · icon · iconSm`.
Deliberately *not* a client component — it holds no state, so it renders in
server components too, which is where half the app's buttons live.

**Colours named as ramps.** Components said `bg-brand-600`; they now say
`bg-primary`. The shadcn semantic layer (`--primary`, `--muted`, `--border`,
`--ring`, `--destructive`…) sits over the primitives via `@theme inline`, so a
component names a *role* and the role resolves to the ramp — which is what
makes a theme change one file instead of a sweep across ninety components.

Plus `cn()` (clsx + tailwind-merge), so a passed `className` actually
overrides rather than racing the base class in stylesheet order.

**Motion, sparingly.** Every button dips 0.5px on press behind a
`prefers-reduced-motion` guard; the flow toggle slides on a spring curve
rather than linearly. Two rules, and they are most of the difference between
an interface that feels built and one that feels rendered.

### 9j. Colour, on purpose

Consistent and joyless is still joyless. The kit was correct — one accent,
neutral everything — and correct is not the same as wanting to open it.

**The rail carries the mood.** It has now been a saturated gradient, then
near-black, then graphite, and graphite was right about contrast and wrong
about feeling: a grey bar down the side of a grey app. The wash is back, but
*built* rather than picked — anchored on our own brand at the top, warming
through violet to fuchsia (`--gradient-rail`), on a rail whose icons, labels
and glass active-state were designed for it. The first attempt was none of
those things.

The rule that makes this work, and it is now written at the top of
`globals.css`: **the rail is the one surface allowed to be loud; everything
to the right of it stays neutral except for identity and state.** A canvas
where everything is coloured can point at nothing.

**Rounder.** control 8→10px, card 12→14px, surface 16→20px. Playful reads as
rounder before it reads as anything else.

**Four shadows, layered.** `raised · lifted · float · pop`, each a hairline
ring + soft ambient + tight contact rather than a single glow (the Figma UI3
structure from §9e's research). `flow-shadow` is now just `--shadow-float`, so
islands and panels share one recipe.

**State became tokens** (`success`, `warn`, with `-soft` and `-ink` pairs)
rather than raw palette picks — which is how three different greens end up on
one screen. Status is a filled pill now, not a dot and a grey word.

**A `success` button variant**, because running a thing and publishing it are
different kinds of act — Make and Zapier both give "run" its own colour rather
than a second grey. Test flow is green; publish stays the single strongest
thing on screen.

### 9k. The card, rebuilt — and a layout invariant it exposed

"Still looks the same" was correct, and the reason is worth recording: §9i–9j
changed **tokens** — colour, radius, shadow, icons — and never touched the
thing the canvas is actually made of. The step card was the same cramped
256px row it had been since the beginning: a 30px mark, a 14px title and a
2px dot in one 40px strip. Restyling a list item does not make it a card.

**The card is now a card.** 300px wide, 44px mark, the step number as its own
chip so it stops eating the title's width, the title on its own line at 15px,
the result below it. The kebab appears on hover, so a resting canvas is cards
and nothing else. The publish footer is a proper foot rather than a thin
stripe.

**"Add next step" is a ghost card**, not a pill — full width, dashed, with a
dashed icon well. Zapier's pattern, and it works because it shows the SHAPE of
what comes next rather than describing it.

**A regression the tests caught, and a coupling nobody had written down.**
Growing the card meant growing the canvas geometry — and raising the row
packing gap from 288 to 344 broke three-way splits, because branch lanes were
*placed* at `SPREAD = 320` and then *packed* at `MIN_GAP = 344`. The packer
shoved every lane after the first rightward and splits stopped being
symmetric about their hub.

Those two constants were always the same quantity — "how far apart do two
columns sit" — expressed twice, and the invariant `SPREAD >= MIN_GAP` existed
only implicitly in the fact that 320 > 288. They are one constant now (`COL`),
so they cannot disagree, and a new test pins the symmetry directly rather than
trusting a pixel value.

The kit gained a **canvas slice** — two connected cards, the connector, the
ghost step — because cards shown in isolation cannot reveal what was actually
wrong: the rhythm between them.

### 9l. The chrome, regrouped by job

Two more rounds of "still looks the same" had one cause: the chrome was
**two blobs**. Everything about the flow in a top-left pill, everything
pressable in a top-right one, and the canvas controls exiled to a cramped
bottom-left cluster. Restyling blobs keeps them blobs.

What the references actually do, measured rather than glanced at:

- **Miro** anchors four *jobs* to four *places*: board identity top-left,
  sharing top-right, tools to a vertical island on the left edge, view to a
  pill bottom-right. Its tool island is split again — undo/redo is its own
  separate surface below the tools.
- **Make** does identity top-left, sharing top-right, and puts **every run and
  view control in one horizontal bar pinned to the bottom centre**: "Run once"
  as a filled primary, a divider, then the quiet icon controls.

So the builder now has: **identity top-left** (back, name, save dot, ⋯ menu
holding duplicate/delete), **publish top-right** (Live chip + the one primary),
and **a bottom-centre bar** carrying everything you do to the canvas — Test
flow as a filled green primary with a play icon, then undo/redo, then zoom
out / **live zoom readout** / zoom in / fit.

Two things that fixes beyond looks:

- **Test flow was a ghost button beside Publish**, which framed the control
  you press twenty times an hour as Publish's poor relation. It is now the
  filled primary of its own bar.
- **Zoom and undo were in a corner cluster nobody would find.** They are under
  your hands, and the zoom readout — Miro's, and it earns the space — answers
  "where am I" after a pinch. Clicking it fits the flow.

Geometry is measured, not chosen: 6px island padding, 36px controls, 8px from
the viewport edge, one hairline divider per group. Deleting a flow became a
centred modal — it was a popover hanging off a menu item that had already
closed, which is a lot of consequence for a surface that small.

### 9m. Measured against the reference, item by item

Seven corrections, each checked against the screenshots rather than judged:

**One top island, not two.** Miro's top-left island runs wordmark → title →
⋮ → upload → **Upgrade**: identity *and* the call to action, in one surface.
Publish alone in the opposite corner read as an afterthought stranded across
the screen. Back, name, save dot, ⋯, Live chip and Review & publish are now
one island.

**Insets are one number.** Top was 8px, bottom 16px, and the left island's 8px
sat against the rail rather than a canvas edge — nothing lined up with
anything. All three edges are 12px.

**Icons are 20px and near-black.** They were 17px `neutral-600`, which is a
toolbar whispering; Miro's tool glyphs read as objects. Rail icons went 20→23px.

**The accent is Miro's blue** (`brand-600 #4262ff`). The ramp has walked from
stock indigo → blue-violet → here: a true bright blue with just enough violet
to stay ours.

**Radii went back down** — 8 / 12 / 16, Mirotone's own scale. The kit briefly
ran 10 / 14 / 20 on the theory that rounder reads as playful; against the
actual reference that read as *soft* rather than crisp. Miro is tighter than it
looks in memory.

**Test flow wears the primary blue**, matching Review & publish. They are the
two things you press, and they no longer compete for a corner — one is in the
top island, one anchors the bottom bar.

**The rail's selected state is a solid white tile with the brand glyph.** Miro
marks the selected tool with a *filled* tinted tile, not a translucent wash;
22% white on a coloured rail could not say "you are here" loudly enough. The
kit now renders the rail's active and rest states side by side, because the
selected treatment was otherwise only checkable on an authenticated route.

### 9n. Weight, grouping, and getting out of Make's palette

**Icons at Miro's weight.** 22px at stroke 2.25 in true black on the toolbar,
24px at 2.1 on the rail, 18px on the card kebab. They were 20px `neutral-900`
at default stroke — technically dark, visually thin. Miro's glyphs read as
objects sitting on the bar, and weight is most of how.

**The top island was a jumble because of grouping, not styling.** "Saved" sat
mid-island between the name and the ⋯, so five controls ran at one rhythm with
nothing for the eye to land on. Now three groups with air between them: back →
name (+ status) │ actions.

And the status is a **dot unless it has something to say**. "Saved" is the
answer to a question nobody asked — it now expands on hover, while "Saving…"
and "Unsaved" stay visible because they are not redundant with the dot, and
"Not saved" keeps its loud red chip because that one can cost work. That
single removal is most of what made the island read as cluttered.

**The rail left Make's palette.** It ran blue → violet → fuchsia, which is
Make's exact register and read as *theirs*. It now deepens our own accent into
navy — `#4262ff → #2f4ce0 → #22357f` — one hue family top to bottom, so it is
a colour with depth rather than a rainbow.

### 9o. Black, 60/30/10, and Miro's selected state

**Black is black.** `--foreground` was `#0a0a0a` — 96% black, which reads as
dark grey the moment a real black sits beside it, and leaves no room at the
top of the scale. It is `#000` now, and every `text-neutral-800/900` in the
app (seventeen files) became `text-foreground`. Things meant to recede use
`muted-foreground`; there is no middle any more.

**The rail is the 30 in a 60/30/10 split.** White canvas is the 60, the rail
is the 30, the blue accent is the 10 — and that only works if the rail is
*not* the accent. It has now been Make's violet→fuchsia (read as theirs), then
the accent blue itself (so primary buttons had nothing to pop against), and is
now deep indigo-navy: `#262c63 → #1c204a → #141733`. Unmistakably a colour
rather than a grey — greys read as bleak at that size — and far enough from
`#4262ff` that a blue button or a white selected tile on top of it reads
instantly.

**The save state is words, no dot.** A dot needs a legend; a word does not.
"Saved" / "Saving…" / "Unsaved" in muted text, and the loud red chip with
Retry when a save actually fails.

**The top island gained a board mark** — Miro's own island carries one before
the title, and without it our flow name was a bare text field floating between
two icon buttons, which is exactly why it read as an input rather than as the
thing the island is *about*.

**Controls at Miro's size**: 40px targets, 23px glyphs, 8px radius.

**Selected is a tinted fill, not a ring.** Miro marks a selected tool by
changing the *surface* — light blue fill, coloured glyph — and that reads
instantly where a ring does not, because the card already carries status
borders a ring has to compete with. Applied to the selected step card, the
picker's hover rows and the Select's keyboard-active row, so "highlighted"
means one thing everywhere.

---

### 9p. Bigger, whiter, and switchable — measured against the reference again

A second item-by-item pass against the Make/Miro screenshots, plus the two
reversals it forced.

**Both bars grew by the same amounts, together.** Island padding +50%
(`p-[9px]`), glyphs +20% (28px inside 44px targets), and every string in the
chrome — flow name, Saved, Review & publish, Test flow, the zoom readout — at
16px. The outer inset is `1rem` on all four sides and `panelInset` matches, so
the top island, the bottom bar and the config panel all sit the same distance
from the canvas edge. The back arrow is now the same 28px as the zoom glasses;
it had been smaller than the controls it sits above, which made the top bar
read as the lesser of the two surfaces.

**The board mark is gone** — added in 9o from Miro, removed on sight. Miro's
mark answers *which board is this* among thousands of thumbnails; our editor
opens exactly one flow at a time, so it was decoration in the one slot where
the eye lands first.

**Cards are `#ffffff`, and so is everything that looks like a card.** The
selected step no longer takes a `bg-brand-50` fill (9o's tinted-fill rule
survives for picker rows and Select's active row, where there is no competing
status border): selection is `border-brand-500` plus a 2px halo. The ghost
"Add next step", the `+` between nodes and the branch chips are opaque white
too. The `+` had been `opacity-40` until hover, which on a dotted canvas made
it a smudge with the dots showing through rather than a control.

**Flows switch on and off from the top island**, between the ⋯ and Review &
publish — a real `role="switch"`, disabled with an explanatory title until the
flow has been published once, optimistic then corrected from
`setFlowEnabledAction`. Publishing sets `status: "published"`, so the first
publish flips it on by itself. Three states off two existing columns and **no
migration**: `flowState()` reads `active` / `paused` / `draft` from `status` +
`publishedVersion`, and both `publishedFlowTiles` and `materializeStaleAll`
already gate on `status = 'published'`, so off means the tiles come back with
it rather than being destroyed.

**#3858FF**, exactly, as `--color-brand-600`, with the ramp rebuilt around it.

**The piss-yellow is orange now.** `--color-warn` `#f97316` on `#fff1e7` with
`#c2410c` ink, and `STATUS_META.setup` uses those tokens instead of raw
`amber-*`, so needs-attention reads as *warm* rather than as a stain.

**Nine distinct node hues.** `app` was slate `#475569` — grey, the absence of
identity, on the one step every single flow begins with. It is emerald now;
`output` is indigo. The picker reads as a palette rather than a list.

**Every field label is one style.** `text-small font-semibold text-foreground`,
in ConfigPanel's `Field`, the condition editor and Review & publish alike —
previously three variants of `text-xs font-medium text-neutral-600`, which put
the question in lighter type than the answer. Section heads are `text-micro
font-bold` at `neutral-500`.

**The rail is Make's geometry**: 76px wide, an 80px logo band that matches the
top bar's height so the two align across the seam, a 40px rounded tile per item
with the label beneath at 11px, and active highlighting *the tile only* — not
the full-width row, which is what made every previous version read as a nav
bar rather than as a dock.

---

### 9q. The rail, measured off the reference instead of estimated

The previous pass built the rail "like Make's" from memory and it was wrong on
every axis at once. Measured properly off the reference screenshot:

| | Make | Ours (before) |
|---|---|---|
| rail width | 80px | 76px |
| icon-centre to icon-centre | 67px | 58px |
| icon-centre to label-centre | 27px | 33px |
| tile → label gap | 0 | 4px |

The zero gap is the part that has to be derived rather than eyeballed: a 40px
tile and a 15px label line put their centres 20 + 7.5 = 27.5px apart **only if
they touch**. And the 15px line height is confirmed independently — Make's
two-line items (MCP Toolboxes, Data stores) sit at 82px pitch, exactly one
extra line above the 67px single-line pitch. So the construction is
40 + 15 = 55px per block with 12px between blocks, and every number in it
falls out of two measurements instead of taste.

Verified rendered, not assumed: 80.0 width, 67/67/67 pitch across all four
pairs with no accumulated drift, 27.5 on every item, tile tops at 79/146/213/280.

**Both bars came down ~16%** — the previous pass had grown them 50% on
request and they overshot. 7px island padding, 38px controls, 24px glyphs,
14px text, giving a 52px island against the old 62px. The back arrow stays
locked to the zoom glyphs' size and the zoom readout to Test flow's, because
those two pairings were asked for explicitly and a uniform scale is the only
way they survive a resize. The outer 16px inset is untouched — the ask was to
shrink the bars, not the air around them. The rail's logo band tracks the
island at 68px (16 + 52) so the two still line up across the seam.

### 9r. The design page was lying, and that is a defect class

The insert "+" was reported fixed and was not. `/design` renders **preview
copies** of builder chrome, the copy had been updated, and the real
`InsertEdge` still drew a 40%-opacity text "+" that the canvas dots showed
through. A screenshot of the kit is only evidence if the kit is honest, so an
audit went looking for every other instance:

- The **State** swatches were still amber-500/amber-300 after needs-attention
  moved to orange — the kit was a whole hue behind the product, on a page
  whose entire job is catching that. Now they read `border`, `dot` and `label`
  straight out of `STATUS_META`, so the drift cannot recur.
- The canvas preview drew a **connector and a "+" into the ghost step**. The
  product doesn't: the terminal "Add next step" hangs off the card at `mt-8`
  and is not an edge, so it has no insert control.
- Its **rhythm was 56px** where the real card-to-card gap is 160px
  (`ROW` 232 minus a 72px card) — on the one section sold as "the rhythm
  between them". It is 160 now.
- The dashed run was `neutral-300`; it now takes `--color-canvas-edge`, the
  same token `.react-flow__edge-path` strokes with.
- It rendered a **body line on an untested card**, a shape `FlowNodeCard`
  cannot produce, and coloured error hints grey instead of red.
- Kit inputs were `text-base` (38px) against every real input's 36px.
- Four pieces of **prose stated numbers that were no longer true**: a rail
  gradient described as "violet to fuchsia" two palettes after it became
  indigo-navy, an Ink note naming tooltips and an account panel that do not
  use Ink, "six variants" against a seven-variant Button, and "every input is
  8px" against a dozen 6px inputs in settings and onboarding.

Every duplication point now carries a one-line comment naming the real file it
must track. The rule this establishes: **a preview may simplify, but it may
never differ.** Simplifying is rendering three cards instead of a live graph.
Differing is styling the same element two ways — and that is indistinguishable
from a fix.

---

### 9s. The label pass, third time, done properly

"Make Account / Spreadsheet / Sheet-tab bolder, like the Configure text" was
asked three times and missed twice. Both misses were the same shape: I fixed
*some* labels, saw them change, and called it done.

The reference is the active Configure tab — `text-sm font-semibold
text-foreground`, i.e. **14px, semibold, true black**. `Field` in ConfigPanel —
the component behind every label in the user's screenshot — was `text-small
font-medium text-neutral-700`: **13px, medium, grey**. Wrong on all three
axes, while Review & publish and the condition editor had already been
corrected. The kit looked fixed; the product was not.

What actually closes it:

- **One string, `FIELD_LABEL`**, referenced by `Field` and by a new
  `FieldLabel` for the three places that lay their own control out. "Make the
  labels bolder" now has exactly one place to land.
- Three `SectionLabel` uses were doing `Field`'s job — "Time period", the
  branch mode, "Only continue if…" — rendering an 11px uppercase grey-400
  *question* above a 14px black *answer*. That inversion is the whole defect,
  and it was hiding behind a helper named after a different job.
- The sweep ran to the edges of the app: metrics/new, funnels/new,
  integrations, onboarding, the event-time picker, the type-to-confirm field.

**And it was verified adversarially rather than by spot-check** — an
independent pass enumerated every `<input>`, `<select>` and shared control in
`src/`, traced each one to the element that labels it, and reported that
element's classes. That is what caught the three `SectionLabel` sites; reading
the diff would not have. The exclusions are listed too — section headings,
helper blurbs, checkbox text beside its control, table headers — so they are
reviewable rather than silent.

**The rule, written above `Field`:** a label is the QUESTION and the input is
the ANSWER. The question may never be lighter than the answer.

### 9t. Sized to ask, not to Make

The rail is 100px with 10px of side air and a 30px rhythm; the labels are
12px. Those are the user's numbers, not Make's — Make's measured geometry
(the 40px tile, the label flush beneath it, 27px centre-to-centre) is what the
item is *built* from, and the width and rhythm are set on top of it. The
comment in `sidebar.tsx` says so explicitly, so nobody "corrects" it back.
The label went to `text-tiny`, the next size up in our own scale, rather than
to a new arbitrary value — the whole point of having seven sizes.

Both bars went up 10%: 8px padding, 42px controls, 26px glyphs, `text-lead`,
a 58px island. The rail's logo band follows to 74px so mark and island stay
level across the seam.

**One bug the measurement caught that no test could.** Moving the bar text
from arbitrary `text-[14px]` to the `text-lead` token brought the token's
24px line-height with it, and the zoom readout — the only control in the bar
without a fixed height — grew to 44px, making the bottom bar 60px against the
top island's 58px. Two pixels, on the one pair of surfaces that must agree.
It now carries `h-[42px]` like every one of its siblings. Switching from an
arbitrary value to a token is not a no-op: **tokens carry line-height too.**

Rendered and measured back, all green: rail 100.0 wide with 10/10 padding,
tiles 40×40 centred at x=50, pitch 86/86/86, label→next-tile gap 30/30/30,
labels 12px on a 16px line flush under the tile, logo band 74, both islands
58, bar text 15px, 108px of clear canvas between the two islands.

---

## 10. What not to change

Explicitly, so nobody optimises these away later:

- **The receipts.** `DedupeOutcome`, `PairingOutcome`, `CrossRefOutcome`, the
  truncation notice, `describeWindow`, the import-progress bar, the
  "6 largest of 11 groups" note, the em-dash-not-zero rule. These are the
  reason a customer will trust a number they can't verify themselves. If
  anything, make them *more* prominent.
- **Managed layout.** No free node dragging. It is why this can feel simple.
- **Asking instead of assuming** on dedupe direction, match side, and date
  column.
- **`NODE_LABELS` as the single vocabulary** that validation must speak, pinned
  by test.
- **No sample data.** The reasoning in `onboarding-checklist.tsx` is correct —
  fake rows would poison four real subsystems.
- **Publish issues that select the offending step.**
