# UX pass — widths, copy, activity, and the split-drag fix

Written 2026-08-25, against `main`. Scope: the authenticated app's chrome and
copy, the shared page-width system, one new route, and two defects in the flow
builder's drag model. **No engine, connector or ingestion behaviour changes**,
with one deliberate exception noted in §5 (a stored-tile slot nothing reads).

Read alongside `docs/UX_AUDIT.md`, which this continues, and
`docs/BRAND_KIT.md`, whose gates (`check:ui`) this must not break.

---

## 0. The verdict in one paragraph

The visual language is settled and the engine is ahead of both. What is left
between a stranger and their first useful minute is **naming and doors**: the
rail says one word and the page says another, a button called "New flow" does
not make a flow, and a retired builder is still reachable by URL. Around that
sits a layer of explanatory prose that says what the control beside it already
says, and a page-width cap that makes a 27-inch display render a laptop layout.
None of it is deep. All of it is friction on the first sitting.

---

## 1. Audit findings

| # | Finding | Where | This pass |
|---|---|---|---|
| 1 | Rail says **Apps**, page title says **Integrations** | `sidebar.tsx:49` / `integrations/page.tsx:100` | Fixed (§3) |
| 2 | **"New flow" does not create a flow** — it navigates to Flows, where you press "Create flow" | `dashboard/page.tsx:360` | Flagged only |
| 3 | Retired metric builder still live at `/dashboard/metrics/new`, `/dashboard/funnels/new` | those routes | Flagged only |
| 4 | Every page capped at 1152px | `ui/page.tsx:32` | Fixed (§2) |
| 5 | Builder offers both a floating `+` and an "Add next step" card for one action | flow canvas | Flagged only — the builder is not redesigned |

Findings 2 and 3 are real first-use traps but both are **route/product**
decisions rather than a UI pass, and #5 falls under the standing rule that the
builder is tidied and fixed, never redesigned. All three are recorded here so
the next pass does not rediscover them.

**What is already right and is not touched:** the empty-dashboard checklist;
the `null`-vs-`[]` discipline that keeps a database outage from rendering as
"your data is gone"; the freshness-vs-unpublished distinction on a tile; the
warm-canvas material system.

---

## 2. Width — boards fill, forms stay narrow

`PageContainer` has two modes, and **every route already picks the right one**:
boards and lists take `default`, forms take `narrow`. So the change is to the
container itself, not to nine call sites.

- `default` loses its `max-w-6xl` cap and runs to the gutter.
- `narrow` keeps `max-w-3xl` at every width. A form does not get better wider,
  and a 2000px-wide email input is worse than a 700px one.
- The gutter steps: `px-4 · sm:px-6 · lg:px-8 · 2xl:px-12`.

A `3xl` breakpoint (1920px) is added to `@theme` in `globals.css` rather than
spelled as an arbitrary variant, so the class reads `3xl:grid-cols-5` and stays
inside the kit's token discipline.

**One grid rhythm, everywhere it already applies:**

```
base 1  ·  sm 2  ·  xl 3  ·  2xl 4  ·  3xl 5
```

applied to the dashboard tiles, the flows board, and the connector catalogue —
the three places that already shared `sm:grid-cols-2 xl:grid-cols-3`.

**Skeletons move with it or the page jumps on load.** `shell-skeleton.tsx`
mirrors the container's classes by hand, and `dashboard/loading.tsx` and
`board-controls.tsx` mirror the tile grid. All three are part of this change,
not follow-ups. `tests/page-width.test.ts` pins every mirror, because this pair
has now drifted twice on its own.

**A shared constant must be readable on the server.** `DAY_CELL_H` first lived
in `CalendarBoard.tsx`, which is `"use client"`, and was imported by
`calendar/loading.tsx`, which is a server component. A `"use client"` module's
exports are not values on the server — the flight loader swaps each for a client
reference, and interpolating one into a `className` does not throw; it
**stringifies the function**, so all 35 day cells shipped a ~264-character class
holding `function(){throw …}` and no height. It now lives in `day-cell.ts`, a
module with no directive, following the rule `flow/panel-chrome.tsx` already
documents for `PANEL_SHELL`. The pin checks the *directive position*, not the
presence of the phrase, so the module can discuss the hazard in prose.

---

## 3. Copy

The rule: **a lede that restates the `h1` is deleted; a hint that restates its
own control's label is deleted; anything load-bearing is relocated, never
dropped.**

**Deleted:** the ledes on Dashboard, Calendar, Flows, Apps and Settings; the
Ranks subtitle; the `Permissions` and `Metrics` group hints in the rank editor;
the invite-form paragraph; the "Your connections" section heading.

**Shortened:** the invite-created banner to `Invitation sent to <email>.` (the
copyable link is already below, under Pending invitations);
`History imported — everything the source still offers.` to
`History imported.`; every connector's `historyNote` to its first sentence —
Whop's becomes exactly `First sync reaches back 90 days.`

**Relocated:** the disconnect-keeps-data vs delete-is-permanent difference
moves out of the page and into the two confirm dialogs in `ConnectionRow.tsx`,
which is where a person is actually deciding. The Calendar's "dates are UTC"
becomes a `UTC` chip beside the month label.

**Kept, deliberately:** the onboarding checklist, whose entire job is telling a
stranger what to do next; and the custom-webhook note, which shows for the one
connector whose URL *is* the product.

**Page title:** `Integrations` becomes `Apps`, matching the rail item that is
the only way in. The rank-gate empty state changes with it.

---

## 4. Ranks become Roles

User-facing strings only: the section reads **Roles**, the button reads
**Create role**, and every "rank" in a label, placeholder, toast, aria-label or
confirm line becomes "role".

The `Member` badge in the Members list retires, because WorkOS's role and a
workspace rank would otherwise both be called "role" on one screen. The
**Owner** pill stays — that is a different and genuinely useful fact.

`workspaceRanks`, `rankAssignments`, `RanksPanel`, `canManageRanks` and the
`rank_assignments` table keep their names. Renaming them is a migration and a
diff across the permission model for no user-visible benefit.

---

## 5. Activity gets its own route

New `/dashboard/activity` and a rail item after Calendar. It shows the recent
event feed at 50 rows (up from 6), keeps the connection count and the
per-connection dead-letter links, and gains a source filter.

**This is cheaper than what it replaces, which is why it is allowed to be
deeper.** Measured, not assumed:

- The dashboard **loses two queries** — the `events` read and
  `unresolvedDeadLetterCountsByConnection`. That page re-renders on every
  freshness version change (`FreshnessPoller` → `router.refresh()`), so it is
  the hottest render path in the product.
- Activity adds three narrow reads **only when visited**: 50 rows across the
  same five columns is roughly 5KB of egress per visit.
- It carries **no `FreshnessPoller`**. The page does not poll.
- The source filter reuses `connectedSources`, which reads `connections` (tens
  of rows) — not a scan of `events`.

No new table, no new index, no background job.

### "Upcoming" is removed

Dropped from `RANGE_OPTIONS`, so the dashboard's range track goes from seven
pills to six. The future is visible on the Calendar, which is where a
forward-looking question belongs.

**Also dropped from `MATERIALIZED_RANGES`**, which removes one slot from every
stored tile's jsonb permanently. Verified safe:

- The calendar's future days come from `calendarDayRanges`, an independent list
  (`materialize.ts:281`), not from this constant.
- `calendar-days.test.ts:359` asserts against the constant itself, so it stays
  green by construction.

**Correction — `resolveRange` falls back rather than resolving.** This document
first said the key would stay resolvable so a bookmarked `?range=upcoming`
"resolves to a real window instead of throwing". That was wrong, and adversarial
review caught it. With the key gone from `MATERIALIZED_RANGES`, no stored tile
carries the slot, so such a link rendered every metric as "—" under *"Not
computed yet for this range — Refresh to compute it"* — and Refresh
re-materializes the six ranges that exist and can never produce it. It also
mislabelled `metrics/[id]`, whose lede looks the key up in `RANGE_OPTIONS` and
fell back to "last 30 days" while showing something else. A 500 would have been
more honest than a board naming a button that cannot work.

So `resolveRange` no longer recognises `"upcoming"`; it falls through to the
default like any other unrecognised string, and the key leaves `RangeKey` with
the now-unreachable branch and `FAR_FUTURE`. `isForwardRange` **stays** — it is
the seam a forward range returns through, and it keeps the materializer's
`future` flag reading as "no range is forward" rather than as a hardcoded claim
about one range. The engine's own forward handling is untouched and stays
covered by `flow-range.test.ts`, which builds its window directly.

---

## 6. The split-drag defects

The canvas computes every card's position from the wiring, so a drag chooses a
**place in the order**, never a coordinate. Both defects live in that model.

### (a) Path heads are draggable and should not be

A node that is the direct target of a Split's handle — the "Path A" / "Path B"
cards — gets `draggable: false` in `displayNodes`. Steps *inside* a path keep
their drag, so reordering within a branch still works.

### (b) Moving a Split strands its branches

`moveWiring` detaches through `bridgeEdgesFor`, which bridges the Split's parent
to **all** its outgoing targets. For a Split those targets are the path heads,
so both branches get re-parented onto the old chain while the Split travels
away empty. That is the observed bug exactly.

**Fix:** a Split detaches by removing only its **incoming** edges; its branch
edges travel with it. On landing, the step the drop target used to feed attaches
to the **tail of the first path** — walk the first handle's chain to its last
node and wire that node to the displaced step. The "Path A" card keeps its
position as the branch's first step, which is what its name promises.

### (b2) The second ring — branches that rejoin

Found by adversarial review after the first fix landed, and it is the same
hazard one level deeper. The guard in (c) below checks only the **drop target**.
It does not check the step being **displaced**.

Branches rejoin: the commonest non-trivial shape here is a Split whose paths
both feed one Combine, and that Combine often takes a second source directly.
Drop the hub under that source and `outgoing.target` is the Combine — already
downstream of the hub through its own branches. Re-homing it under path A's tail
wires the end of the subtree back into its middle:

```
src -> U,  hub{pA -> fA -> a1 -> U, pB -> fB},  U -> m
drop hub after src   ==>   adds m -> U, against an existing U -> m
```

Degenerate version, same cause: when path A's tail *is* the displaced node, the
added edge is literally `X -> X`. `computeVerticalLayout`'s Kahn pass then never
assigns those nodes a depth and defaults them to 0, so a Combine and its
downstream step jump to the top row — and the cyclic graph is what gets stored.

**Fix:** a displaced step already inside the hub's subtree is not re-homed at
all. It is reachable from the hub by definition, so cutting the direct
`after → target` edge cannot orphan it. Both shapes are pinned, with a DFS cycle
check rather than an assertion about one specific edge.

### (c) A cycle guard that was genuinely unnecessary before

`moveWiring`'s docstring argues that no cycle is reachable because a node is
fully detached — and therefore has no descendants — before it is reinserted.
**That reasoning stops holding the moment a Split keeps its subtree.** Dropping
a Split inside its own branch would close a loop.

So `slotFor` excludes any slot whose anchor is inside the dragged Split's own
descendants, and the docstring is corrected rather than left asserting
something that is no longer true.

### Tests

`tests/flow-canvas-utils.test.ts` gains cases for: a Split carrying its subtree,
the displaced step landing at the tail of path A, and the cycle refusal. The
existing `moveWiring` chain-reorder tests are unchanged and must stay green —
if any of them moves, the fix has leaked into the plain-node path.

---

## 7. Verification

The repo's bar, all five, before anything is called done:

```
pnpm typecheck
pnpm test
pnpm build
pnpm check:ui
pnpm check:orphans
```

Behavioural changes are sabotage-verified in this repo's convention: break the
pin, confirm it fails alone, restore it. Every fix in §6, §2 and §5 was put
through that loop.

### Adversarial review

The working diff was reviewed by five independent lenses (split-drag
correctness, width/responsive, copy completeness, cost claims, dead code), and
every candidate finding was then handed to a separate agent prompted to
**refute** it. Eight were refuted; five survived, covering three distinct
defects — all three were real, all three were mine, and all three are fixed
above:

| Defect | Where | Section |
|---|---|---|
| Split re-homed a displaced step into its own subtree, closing a cycle | `graph-utils.ts` | §6(b2) |
| Server skeleton read a `"use client"` export, stringifying a function into 35 class attributes | `calendar/loading.tsx` | §2 |
| `?range=upcoming` became an unreachable "Refresh to compute it" state | `range.ts` | §5 |

The first is worth recording as a process point: the change in §6(b) is what
*created* that hazard, by making a Split retain descendants it previously shed.
The function's own docstring had argued no cycle was reachable — an argument
that was true before the change and that the change quietly invalidated. Guards
whose justification is "the old structure made this impossible" need re-reading
whenever the structure moves.

---

## 8. What this pass does not do

- Does not collapse the two-click "New flow" (finding 2).
- Does not retire or redirect the classic metric/funnel builder routes
  (finding 3).
- Does not touch the builder's `+` / "Add next step" duplication (finding 5),
  or any other part of the builder's design. The two changes in §6 are defect
  fixes to the drag model and nothing else.
- Does not rename any database table, column, or permission identifier.
