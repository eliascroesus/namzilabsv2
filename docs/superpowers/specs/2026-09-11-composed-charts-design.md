# Composed funnels and pies

**Date:** 2026-09-11
**Status:** design approved, ready to plan

## The problem, measured

All 18 published flow tiles in production are `scalar+series` (17) or `scalar` (1).
**Zero** carry a non-empty `groups` array. **Zero** carry `facts.ordered`. No workspace
has a classic metric at all.

`chartsFor` offers `pie` and `category` only when `shape.groups` is true, and `funnel`
/ `pipeline` only when `shape.funnel` is true — which `shapeOfTile` hardcodes to `false`
(`src/lib/board/charts.ts:273`). So five of the ten chart types are offered on **no tile
that exists**. The renderers are complete and good; nothing can reach them.

The reason the grouped door is empty is not a data accident. `NODE_LIBRARY`
(`src/components/flow/node-meta.ts:78`) has eight entries — Get data, Combine, Match,
Filter, Split, Summarize, Calculate, Time between. **`group` is not one of them.** The
engine handles `case "group"` and `buildTile` writes `tile.groups`; the step picker
simply never offers the node. A user cannot build a grouped metric today.

## The decision

**Compose a funnel or a pie at render time from scalar tiles the board already holds in
memory.** Do not materialize new stored shapes, do not add an engine node, do not publish
anything.

This is decisive on cost. `publishedFlowTiles` already selects every published tile and
`page.tsx` already builds `flowByKey` over all of them, so resolving a funnel's stages is
N `Map.get`s against a map that exists whether or not anyone composed anything: **zero
extra round trips, zero extra flow runs, zero widened selects.** The alternative —
publishing grouped metrics — writes a `groups` array into the tile and into all six
`byRange` slots of a jsonb column read on every render by every viewer, ~1.5KB per
metric, whether or not the breakdown is ever drawn. Against the standing Neon egress
constraint that is the wrong trade.

Stored cost is opt-in: ~450B in `dashboard_tiles.config` on a composed tile, nothing on a
board with no composed tiles.

### The anchor

The tile's existing `tile_key` column is the anchor: **stage 1** of a funnel, **the
whole** of a pie. One new config key, `parts`, holds the ordered sibling keys.

This buys zero changes to `tileKeySchema`, `canvasRowFate`, `visibilityKeyOf`,
`attentionOf` and page.tsx's naming branches — the row still points at a real metric, so
`DeadTile` and `attentionOf` keep working. It costs one ambiguity: switching a composed
tile from funnel to pie reinterprets the anchor from "stage 1" to "the whole", which is a
different claim. The panel labels the anchor chip per chart ("Stage 1 · Total Leads" vs
"Whole · Total Leads") so the reinterpretation is visible.

### Composition writes into `w`, not past it

`composeFunnel` produces a `FunnelResult` assigned to **`w.funnel`**; `composePie`
produces `Array<{label, value}>` assigned to **`w.groups`**, before `hasGroups` is
computed at `custom-tile.tsx:301`.

This is the whole integration. `PieChart groups={w.groups!}`, `pieFooter`, `tableRows`,
`BarsHorizontal` and the existing empty-reason rungs then work **unchanged** — a composed
pie can be drawn as a `category` bar chart or listed as a `table` for free, and no rung
has to be re-ordered. The alternative (a parallel `composed.groups` prop) made the
composed pie unreachable behind the existing `!hasGroups` rung at `custom-tile.tsx:373`.

## Data model

### Two new facts, derived where `kind` already is

`facts.kind` **cannot** gate this. The repo says so itself at `src/lib/flow/engine.ts:1721`:

> `facts.kind` is "count" for `sum`, `avg`, `median`, `min`, `max` and `count_distinct` alike.

`seedMetricFacts` (`src/lib/flow/types.ts:457`) answers `ratio` only for `op`
percentage/percent_change and `duration` only for `resultKind` duration. Everything else
is `count`. So a pie whose whole is *Avg Deal Size* ($8,400) and whose part is *Avg Deal
Size, SMB* ($2,200) would pass every kind check and draw a **74% "Other" slice of an
average**.

`TileFacts` gains two booleans, derived from the `cfg.op` that function already reads
(`DATASET_FORMULA_OPS = count | count_distinct | sum | avg | median | min | max`):

```ts
countable: op is count | count_distinct | sum   // may be a funnel stage
additive:  op is count | sum                    // parts may sum to a whole
```

`count_distinct` is countable but **not** additive: a subject appearing in two parts is
counted twice, so the parts cannot tile the whole.

Because `seedMetricFacts` runs *at materialize, for every metric, every time — so stale
specs heal with no republish*, every existing tile picks these up on its next refresh.
**No migration, no backfill, no republish.** A tile that has not yet been re-materialized
carries neither flag; composition refuses for that member until it has, which is the
correct conservative default.

### The config key

One new entry in `KEYS` (`src/lib/board/tile-config.ts:32`):

```ts
parts: z.array(z.string().regex(/^flow:[^:]+:.+$/).max(200))
        .min(1).max(7)
        .refine((a) => new Set(a).size === a.length, "A metric can only appear once.")
```

`flow:`-only on purpose: classic metrics are already excluded from `tileOptions`
(`src/app/dashboard/page.tsx:902`) because they recompute live, and restricting the regex
is what makes the permission check cost zero queries — `tileKeysAllowed` returns
immediately after `access.canSeeMetric` for a `flow:` key and only issues its one query
for `metric:` keys.

`parseTileConfig` needs no change (it safeParses per key); `TileConfig` and
`TILE_CONFIG_KEYS` derive automatically.

`CONFIG_FIELDS` gains `parts` on `funnel`, `pipeline` and `pie`. The `limit` control is
hidden when `parts` is set, because a composed pie's "Other" is an exact residual, not a
top-N roll-up.

### The wire

`CustomTileSource`'s flow variant gains:

```ts
parts?: Array<{
  label: string
  timeField: string | null
  format: ChartFormatBag
  countable: boolean
  additive: boolean
  undated: number
  byRange: Record<string, number | null>   // six materialized + the active key
}>
```

Carrying all six materialized ranges is what preserves the board's zero-round-trip range
switch. **Plus the active `rangeKey`**, resolved after `withDerivedRange` has run, so a
drawn calendar window does not blank every composed tile (`derive-range.ts` writes the
summed slot at a key that is not in `MATERIALIZED_RANGES`).

Carrying each part's **own** format bag is what stops the currency lie: without it a
composed pie whose whole is Revenue (USD) and whose part is Deals Closed (37) prints that
slice as **$37**. ~40B per part against a confidently wrong number.

A part whose key no longer resolves in `flowByKey` — unpublished, deleted, or hidden by
rank — is simply absent, and the renderer refuses.

## Rules

### Legality

`chartsFor` becomes `CHART_IDS.filter(id => set.has(id) && !BLOCK_IDS.includes(id))`.
Canonical order replaces push order — behaviour-neutral across all 32 shape combinations,
and it makes pie-from-two-doors dedupe free.

| # | Rule | Change |
|---|---|---|
| A1 | `shape.funnel` -> `["funnel","pipeline"]`, exclusive | **unchanged.** `shapeOfTile`'s `funnel:false` stays. No stored tile changes legality; no live board starts printing "change the chart". |
| A2 | `shape.composable` -> `+ funnel, pipeline, pie` | **new flag**, set true only by `shapeOfTile`, false by `shapeOfClassic` — the mirror of how `funnel` is already handled. Not a widening of `scalar`: that would offer funnel/pie on classic tiles which can never be composed, since the parts picker deliberately holds no classic metrics. |
| A3 | `shape.series` -> `line, area, bar, table` | unchanged |
| A4 | `shape.groups` -> `category, pie, table` | unchanged |
| A5 | `shape.target && shape.scalar` -> `progress` | unchanged |

Whether parts have been chosen is a **configuration** question answered at render, not a
legality question — the Looker Studio slot model, where an unconfigured chart reports
"configuration incomplete" rather than being hidden.

### The parts slot

`PARTS_SLOT satisfies Record<ChartId, {min,max}>` so a missing row is a type error.

- `funnel` / `pipeline`: **1–7 parts** (8 stages with the anchor)
- `pie`: **2–5 parts** (5 named slices + 1 residual = 6 arcs, exactly `pieSlices`' cap,
  which makes a double-"Other" arithmetically impossible)
- everything else: `{0,0}`

The cap is **shown, not hit**: the section header reads "Stages (4 of 8)" and the Add
button disables at the cap. `PARTS_SLOT[chart].max` is enforced **at render as well**,
because a funnel->pie chart switch carries 7 parts past the pie's cap of 5 and
`honoured()` keeps them.

### Draw or refuse

All refusals live in `src/lib/board/compose.ts` as **pure functions returning a reason
string**, not as JSX branches — so each one is unit-testable and provable-red, per the
standing note that tests here pass vacuously. `custom-tile.tsx` carries a single
`composeRefusal ?? …` slot spliced **above** the `!hasGroups` rung.

**Both charts**

| Rule | Refusal |
|---|---|
| a member's facts carry no `countable` stamp yet | "A stage hasn't been recomputed since this became possible — press Refresh all." |
| any member `!countable` | "A funnel counts things; {name} is a length of time." / "…is a rate." |
| any member has no `byRange` at all | "A stage has never been computed for a period." (no per-tile legacy all-time fallback may leak into a composition) |
| members disagree on format / currency / unit | "These metrics are measured in different units." |

**Funnel**

| Rule | Refusal |
|---|---|
| `parts.length < 1` | "Add at least one more stage in the tile's settings." |
| any stage value `null` | "A stage has no number in this period." (zero and missing must never render identically) |
| `stages[0] <= 0` | "The first stage is zero in this period, so there is nothing for the later stages to be a share of." |

**Pie**

| Rule | Refusal |
|---|---|
| `parts.length < 2` | "A pie needs at least two parts — add them in the tile's settings." |
| any member `!additive` | "Shares have to add up; {name} is an average." |
| any value `null` | "A part has no number in this period." |
| `whole <= 0` | "The whole is zero in this period — there are no shares of it." |
| any part `< 0` | "A part below zero isn't a share of the whole." |
| `sum(parts) > whole + eps` | "These parts add up to more than the whole." |

`eps = max(whole * 0.005, 0.5)`. **The residual row is always appended when non-zero at
display precision** — never epsilon-suppressed, because `pieSlices` normalises to the sum
of what it is handed, so hiding a small residual silently reports every slice as a share
of sum(parts) rather than of the whole while the headline still states the whole.

### Disclosure — always on, not a caveat

Two sentences that are **not** suppressible, because the failures behind them cannot be
detected from stored facts:

- **Funnel:** "Each stage is counted independently over this period, not followed as a
  cohort." A composed funnel is a stage snapshot: a subject can be counted in two stages
  and a later stage can legitimately exceed an earlier one. This is the same property the
  *classic* funnel already has — `computeFunnel` issues one independent
  `count(distinct subject)` per stage with no sequencing — so this makes an existing
  imprecision explicit rather than introducing one.
- **Pie:** "Other is {anchor} minus the named parts. Parts are assumed not to overlap."
  `Total Leads` with parts `Ads Leads` + `Booked Leads` is arithmetically
  indistinguishable from a real partition, and `pieSlices` closes the circle at 100%
  regardless. Unpreventable, so disclosure is mandatory.

Additionally: when members are dated by different `timeField`s, print it — "Stages are
dated by different fields (created_at, booked_at)" — and sum every member's `undated` into
the existing warning rather than disclosing only the anchor's.

### Rising stages

`conversionFromPrev` is **suppressed on the composed path** and relabelled "vs prev",
printed as a ratio rather than a percentage when it exceeds 100%. A per-row "% from prev"
rendered N times in the typography of a conversion rate outvotes one footer caveat.

`widensAt(stages)` lives in compose.ts (unit-testable) and names **any stage exceeding the
first**, not only one exceeding its predecessor.

## Phases

### Phase 0 — cheap correctness, shippable alone, no new feature

- `bottleneckIndex` starts at `worstDrop = -1`, so `drop > worstDrop` is true at
  `drop === 0`: **every flat funnel prints a red "Biggest drop-off" pill on stage 2**.
  Require `drop > 0`. This changes live classic funnels — a visible fix, called out rather
  than slipped in.
- `stageWidths` has a 4% floor and **no ceiling** (`src/lib/board/scale.ts:376`), so a
  stage larger than the first overflows the Pipeline card. Clamp at 100 — **and in
  `FunnelView` too**, which computes its own width and clips silently inside an
  `overflow-hidden` track, so a 300% stage reads as exactly 100%.
- Extract `funnelFromCounts` from `computeFunnel` so composition and the classic engine
  share one arithmetic.
- Refactor `chartsFor` to the filter form (behaviour-neutral).
- `pipeline.tsx` keys rows by `label`; two flows may publish the same name. Key by index,
  as `FunnelView` already does.

### Phase 1 — the composed funnel

`countable`/`additive` stamps; the `parts` key; `PARTS_SLOT`; `composable` on
`MetricShape`; `compose.ts` with `composeFunnel` + `widensAt`; `source.parts` resolved
server-side from the existing `flowByKey`; `w.funnel` assignment and the refusal slot; the
disclosure footers; **`tileKeysAllowed` extended over `parsed.parts`**; the Stages editor;
`eligible`/`exclude` props on `MetricList`.

**`editTile` must round-trip on a parts change.** It currently refreshes only when
`patch.tileKey !== undefined`; a config-only patch is overlay-only by design. `parts` is
not presentation over data in hand — the numbers live in `source.parts`, built on the
server — so without this, reordering stages draws the **old order under the new labels**.

**Security, same commit:** `tileKeysAllowed` runs only on `patch.tileKey`; keys arriving
inside `patch.config` are checked by no visibility rule at all. Shipping `parts` without
extending that check hands any caller a read path into flows their rank hides — the leak
C20 closed for `tileKey`. The `access` handle is already in scope and the check costs zero
queries.

### Phase 2 — the composed pie

`composePie` with the whole/residual/epsilon rules, the `additive` gate, `w.groups`
assignment, the residual and MECE footers, the panel section relabelled "Parts". The panel
and picker from Phase 1 are reused verbatim. Verify by composing Ads Leads + Organic Leads
against Total Leads; if it refuses, the refusal is correct and those metrics genuinely do
not tile.

A zero-valued part must appear in the legend at 0% rather than vanishing — `pieSlices`
filters `value > 0`, and a named part going missing is the same class of failure as a
missing stage drawn as 0.

### Phase 3 — deferred, on request only

`accent` on `FunnelView`; `precision` threaded through both funnel renderers (they
hardcode `{format:"number"}`).

### Phase 4 — deferred, and the price is the reason

The grouped-metric door: add `group` to `NODE_LIBRARY`, teach `shapeOfTile` to read
`facts.ordered`, make the funnel branch additive. This writes a `groups` array into the
tile and all six `byRange` slots of a jsonb column read on every render; it needs a flow
run per publish; **it touches the builder, which is off-limits without asking**; and
`groupByCategories` produces mutually exclusive buckets — a partition, not a narrowing
funnel — so `conversionFromPrev` over them is nonsense without a cumulative-from-the-tail
pass.

## Testing

Per the standing note that tests here pass vacuously: every new legality rule gets an
assertion **proven red against the unmodified code first**. `tests/board-charts.test.ts`
walks shape combinations with a literal `32`; widening `MetricShape` with `composable`
makes that cover a fraction of the space — it becomes `1 << Object.keys(NO_SHAPE).length`.

Per the standing note that source tests cannot see layout: an 8-stage funnel, a 6-arc pie
with a residual, and a stage clamped to 100% are **layout** claims no check here can see.
Run `pnpm geometry`, and look at the board.
