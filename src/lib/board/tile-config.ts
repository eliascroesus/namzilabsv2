import { z } from "zod";
import { GROUP_ACCENT, GROUP_COLOR_KEYS } from "@/components/flow/node-accent";
import { MATERIALIZED_RANGES, type RangeKey } from "@/lib/metrics/range";
import type { ChartId } from "./charts";

/**
 * A CUSTOM TILE'S PRESENTATION — everything about HOW its number is shown,
 * chosen on the view rather than inside the flow.
 *
 * This is the other half of the facts/presentation seam. The flow spec states
 * what a number IS (`TileFacts`, stamped on the tile at materialize); this bag
 * states how one tile draws it, and it lives in the `config` jsonb that
 * `dashboard_tiles` already carries — no migration, and CUSTOM VIEWS ONLY: the
 * groups board keeps `FlowTile` doing its best with what it has, because
 * nobody chose a chart there.
 *
 * The tile's CHART is deliberately not in this bag — it has been a column of
 * its own since the table was born, and mirroring it here would be two sources
 * of truth for the one choice the whole feature turns on.
 *
 * THERE IS NO `currency` KEY, AND THAT IS A REFUSAL, NOT AN OMISSION.
 * `formatMetricValue` relabels but never converts: a $12,400 metric restyled
 * "EUR" would print €12,400 — a confidently wrong number of exactly the kind
 * this feature exists to eliminate. Currency stays a publish-time property of
 * the metric.
 *
 * Consumers of most keys arrive with the chart kit; `title` is read today.
 * The schema lands first so every write from now on is validated and every
 * stored bag is parseable, whichever build wrote it.
 */

const KEYS = {
  /** The name on the card. Absent = follow the metric's own name. */
  title: z.string().trim().min(1).max(60),
  /** Decimal places, capped where legibility ends. */
  precision: z.number().int().min(0).max(4),
  /** A GROUP_ACCENT key — a key, not a hex, so a palette re-solve restyles every board at once. */
  color: z.string().refine((c) => Object.hasOwn(GROUP_ACCENT, c)),
  /** The tile's own goal. Seeded from the flow's target; null clears it. */
  target: z.number().finite().nullable(),
  showDelta: z.boolean(),
  showGoal: z.boolean(),
  showLabels: z.boolean(),
  showSpark: z.boolean(),
  /** Grouped charts: how the rows are ordered. "stored" is the materializer's order. */
  sort: z.enum(["stored", "value_desc", "value_asc", "label_asc"]),
  /** Grouped charts: how many rows before the honesty footer takes over. */
  limit: z.number().int().min(1).max(50),
  donut: z.boolean(),
  legend: z.enum(["right", "bottom", "none"]),
  /**
   * THIS TILE'S OWN PERIOD, overriding the board's pills.
   *
   * Costs nothing to store and nothing to compute: every materialized range
   * already rides in the tile's `byRange`, so an override is a different key
   * read from data the client is holding — no round trip, no second query.
   * FLOW TILES ONLY, and that is a hard limit rather than a policy: a classic
   * metric is computed live for the ONE range the page resolved, so a stored
   * override would be read against a window nobody computed. The panel does
   * not offer it for classic tiles and the renderer ignores it for them.
   */
  rangeKey: z.enum(MATERIALIZED_RANGES as [RangeKey, ...RangeKey[]]),
  /**
   * A BLOCK'S CONTENT — the heading's words, or the note's paragraph.
   *
   * It lives in `config` like every other presentation key, and goes through
   * the same per-key parser: a corrupt `text` costs `text` and nothing else,
   * so a block with a bad value falls back to its placeholder rather than
   * taking the tile's colour and title down with it.
   *
   * One cap for both kinds. 2000 is a paragraph or two — past that it is not a
   * note on a dashboard, and the cap is what stops a tile row growing without
   * bound in a jsonb column read on every render.
   */
  text: z.string().trim().min(1).max(2000),
  /**
   * WHICH WAY A FUNNEL RUNS — and it is a real choice rather than a preference.
   *
   * "down" stacks the stages and lets WIDTH carry the count: the classic
   * silhouette, which reads as a narrowing at a glance and holds eight stages
   * in a tall tile.
   *
   * "across" runs them left to right and lets HEIGHT carry it. That is the
   * arrangement with room for a stage's name ABOVE its own section and the
   * conversion figure IN the gap between two sections, which is where a reader
   * looking for a drop-off actually looks. It is the better shape for three or
   * four stages on a wide tile and the worse one for eight on a narrow one,
   * which is exactly why it is a setting and not a rule.
   */
  flow: z.enum(["down", "across"]),
  /**
   * THE OTHER METRICS THIS TILE IS COMPOSED FROM — a funnel's stages 2..N, or
   * a pie's named slices. The tile's OWN `tile_key` column is the first member:
   * stage 1 of a funnel, the whole of a pie.
   *
   * Storing them here rather than materializing a grouped metric is the central
   * bet of the feature, and it is a cost argument. The board already holds every
   * published tile in memory (`flowByKey`), so resolving a stage is a `Map.get`
   * — zero extra round trips, zero flow runs, zero widened selects. Publishing
   * the same breakdown as a grouped metric would write a `groups` array into the
   * tile AND into all six `byRange` slots of a jsonb column read on every render
   * by every viewer, whether or not anyone ever draws it.
   *
   * `flow:` KEYS ONLY, and that regex is load-bearing twice over. Classic
   * metrics are absent from `tileOptions` because they recompute live, so one
   * could never be picked here anyway — and restricting the shape is what makes
   * the permission check free: `tileKeysAllowed` answers a `flow:` key from
   * `access.canSeeMetric` alone and issues its one query only for `metric:`
   * keys. A config bag that could carry a metric id would have put a database
   * round trip on every board write.
   *
   * DEDUPED IN THE SCHEMA, not in the panel. Every export of a `"use server"`
   * module is a public endpoint, so the picker's `exclude` prop is a courtesy
   * to the author and this is the actual rule. A metric appearing twice in one
   * funnel is not a drawing anyone meant; in a pie it silently double-counts
   * itself against the whole.
   *
   * The cap here is the widest any chart accepts (7, for an 8-stage funnel).
   * Per-chart floors and ceilings live in `PARTS_SLOT` below, because a pie's
   * limit is a fact about the pie rather than about the storage.
   */
  parts: z
    .array(z.string().regex(/^flow:[^:]+:.+$/).max(200))
    .min(1)
    .max(7)
    .refine((a) => new Set(a).size === a.length, "A metric can only appear once."),
} as const;

export type TileConfig = { [K in keyof typeof KEYS]?: z.infer<(typeof KEYS)[K]> };

export const TILE_CONFIG_KEYS = Object.keys(KEYS) as Array<keyof typeof KEYS>;

/**
 * EACH KNOWN KEY PARSES INDEPENDENTLY, AND THAT IS THE WHOLE DESIGN.
 *
 * A single `z.object(...).safeParse` is all-or-nothing: one corrupt `limit`
 * written by a buggy build — or by a hand in the SQL editor — would erase a
 * perfectly good `color` and render the tile with every default at once, which
 * reads as "my settings vanished". Here a bad value costs exactly its own key.
 *
 * UNKNOWN KEYS ARE IGNORED ON READ AND MUST BE PRESERVED ON WRITE — forward
 * compatibility in both directions. A key added by a future release must not
 * make today's build render a default-everything tile (ignored covers that),
 * and today's build must not strip it while editing a neighbour (the write
 * path merges with jsonb `||` rather than replacing the bag — see
 * `setCustomTileAction`, which learned that the hard way with `title`).
 *
 * NEVER throws. The worst input — null, a string, an array — parses to the
 * empty config, which renders as every default: exactly what a tile with no
 * choices made should look like.
 */
export function parseTileConfig(raw: unknown): TileConfig {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) return {};
  const bag = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of TILE_CONFIG_KEYS) {
    if (!(key in bag)) continue;
    const parsed = KEYS[key].safeParse(bag[key]);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as TileConfig;
}

/**
 * The tile's accent, resolved from its stored palette KEY.
 *
 * A key, never a hex — re-solving a hue for contrast then restyles every board
 * at once with no backfill, and a key this palette has since dropped degrades
 * to the kit's own mark colour instead of rendering `undefined` into a style
 * attribute. The same argument `node-accent.ts` makes for group colours.
 *
 * EVERYTHING IT RETURNS IS THEME-AWARE, AND THAT IS THE 8 SEP LESSON. Both
 * branches below returned a fixed hex for one commit, and both were wrong on
 * light for the same reason: this function runs on the SERVER, which cannot
 * know which theme the browser will paint. A value solved for the console is
 * not a value at all on white. See each branch for its own numbers.
 */
export function accentOf(color?: string): string {
  /**
   * `Object.hasOwn`, not `in` — `in` walks the prototype chain, so "constructor"
   * and "toString" passed the schema and then resolved to a FUNCTION here,
   * which React stringifies into the style attribute. An own-property check
   * closes the write path and degrades anything already stored to the default.
   */
  const hue = color && Object.hasOwn(GROUP_ACCENT, color) ? GROUP_ACCENT[color] : null;
  /**
   * THE SAME COLOUR IN BOTH THEMES, AND THAT IS THE FIGMA'S OWN CALL.
   *
   * This returned `var(--marker)` for a day — and back then that meant TWO
   * values, the lime on dark and a solved-down #4F7A00 on light, because
   * #B6FF56 measures 1.20:1 on white and a mark
   * owes 3:1. Sampling the LIGHT frame settles it against me: node 58:5824
   * drew its bars and its legend dot at #B6FF56, the same lime as
   * the dark frame, on a white card. Elias asked for it directly too ("make
   * sure the charts are like our theme color the lime green one").
   *
   * So it is followed, and the deviation is RECORDED rather than silently
   * substituted — the same treatment as the two Figma greys in BRAND_KIT's
   * substitutions table, with the sign reversed: those were refused because
   * they carry TEXT, and a chart mark is a large filled shape whose job is to
   * be identified rather than read. A 46px brand bar on white is unmistakable
   * at 1.20:1; a 14px label at the same ratio would not be.
   *
   * What still protects the reading is that no chart carries meaning by colour
   * alone: every value goes through `formatMetricValue` into a tooltip and a
   * headline, and the axis labels are `--muted-foreground`.
   */
  return hue ?? "var(--color-brand-400)";
}


/**
 * THE COLOUR A NEWLY CREATED TILE WEARS.
 *
 * Every tile used to land on the column's `grey` default, so a fresh board was
 * a dozen identical grey cards and the customer had to colour each one by hand
 * before the board could be read at a glance. A tile now arrives wearing one.
 *
 * CHOSEN AT CREATION, NOT AT RENDER. A colour re-rolled on every read would
 * change under the customer while they are looking at it, and would differ
 * between two people opening the same board — this is workspace furniture, and
 * furniture that moves is a bug. Storing it at insert makes it a fact about
 * the tile rather than a property of the moment it was drawn.
 *
 * Stored as a KEY like every other tile colour, so re-solving the palette for
 * a new surface restyles every board at once with no backfill — which is what
 * the 8 September re-cut actually did.
 *
 * `grey` is excluded deliberately. It is the "no colour" default an unknown key
 * degrades to, so handing it out as a CHOICE would make "never set" and
 * "deliberately neutral" indistinguishable for ever after. The column keeps its
 * `grey` default for rows written by anything but this function.
 */
export function randomTileColour(): string {
  const hues = GROUP_COLOR_KEYS.filter((k) => k !== "grey");
  return hues[Math.floor(Math.random() * hues.length)];
}

/**
 * THE PIE'S SLICE ORDER — fixed, never cycled per tile.
 *
 * Categorical colour has one job: the same entity reads as the same colour
 * everywhere. Rotating the sequence per tile would repaint "Enterprise" green
 * on one chart and pink on the next, which is worse than no colour at all. So
 * the order is a constant, drawn from the palette by KEY (no new hexes), and
 * chosen for separation rather than for walking the wheel: adjacent entries
 * are far apart in hue, and "Other" is always the neutral grey so the
 * roll-up never competes with a real group for attention.
 */
export const SLICE_ORDER = ["blue", "orange", "teal", "violet", "amber", "indigo", "pink", "olive"] as const;

export function sliceAccent(index: number, label?: string): string {
  if (label === "Other") return GROUP_ACCENT.grey;
  return GROUP_ACCENT[SLICE_ORDER[index % SLICE_ORDER.length]] ?? GROUP_ACCENT.grey;
}

/**
 * WHICH SETTINGS EACH CHART ACTUALLY USES — one table, read by BOTH sides.
 *
 * The panel reads it to decide what to OFFER; the renderer reads it to decide
 * what to HONOUR. That is the whole point of writing it down once, and it is
 * the same rule `chartsFor` enforces one level up: a question asked in two
 * places gets two answers eventually.
 *
 * The failure it prevents is specific and quiet. Set a colour on a bar chart,
 * switch the tile to a pie, and the stored `color` is still there — the pie
 * draws from `SLICE_ORDER` and cannot use it. Without this table the panel
 * would keep showing a colour picker that changes nothing, which is a control
 * lying about what it does. With it, the picker is simply not offered, and
 * `honoured()` drops the key before the mark ever sees it, so a stale setting
 * from a previous chart cannot leak into the next one either.
 *
 * A key is listed ONLY where the mark reads it — checked against the marks:
 * `PieChart` and `GoalBar` take no accent, so `pie` and `progress` offer no
 * colour; `FunnelView` takes its result and a `composed` flag DERIVED at render
 * from whether a composition drew it — never a stored key — so `funnel` offers
 * only the two settings every tile has plus `parts`; `ChartTable` formats
 * nothing itself, so it takes `precision` (which reaches it through the format bag) but not `sort`
 * or `limit`, which it does not apply.
 *
 * `title` and `rangeKey` are on every chart because they are properties of the
 * TILE rather than of the drawing. `rangeKey` is additionally gated on the
 * source being a flow — see its note above; that is a fact about the data, not
 * about the chart, so it lives at the call site rather than in this table.
 */
const EVERY_TILE = ["title", "rangeKey"] as const;

export const CONFIG_FIELDS = {
  number: [...EVERY_TILE, "color", "precision", "showDelta", "showSpark", "showGoal", "target"],
  line: [...EVERY_TILE, "color", "precision", "showGoal", "target"],
  area: [...EVERY_TILE, "color", "precision", "showGoal", "target"],
  bar: [...EVERY_TILE, "color", "precision", "showGoal", "target", "showLabels"],
  category: [...EVERY_TILE, "color", "precision", "sort", "limit"],
  pie: [...EVERY_TILE, "precision", "limit", "donut", "legend", "parts"],
  progress: [...EVERY_TILE, "precision", "target"],
  funnel: [...EVERY_TILE, "parts", "flow"],
  pipeline: [...EVERY_TILE, "color", "parts", "flow"],
  table: [...EVERY_TILE, "precision"],

  /**
   * BLOCKS OFFER NO PERIOD, because they answer no question about data — a
   * heading pinned to "Last 7 days" is a control with nothing behind it. They
   * are the reason `EVERY_TILE` is a constant to spread rather than a rule
   * applied blindly to every row in this table.
   *
   * `title` stays on all three even though the panel does not show it: it is
   * what the tile MENU renames, and what the panel's own header reads. A
   * divider has nothing else — no content, no colour, no size beyond the grid's
   * — and that is the honest entry rather than an omission.
   */
  heading: ["title", "text"],
  text: ["title", "text"],
  divider: ["title"],
} as const satisfies Record<ChartId, readonly (keyof TileConfig)[]>;

/**
 * HOW MANY PARTS EACH CHART TAKES — the slot, in Looker Studio's sense.
 *
 * `CONFIG_FIELDS` above says WHETHER a chart reads `parts`; this says how many
 * it can hold, which is a different question with different answers per chart
 * and is read in three places: the panel (to print the cap and disable Add),
 * `compose.ts` (to refuse below the floor) and the renderer (to refuse above
 * the ceiling — see below).
 *
 * `satisfies Record<ChartId, …>` so a chart added to the registry without a row
 * here is a type error rather than a silent `undefined` that reads as zero.
 *
 * THE PIE'S 5 IS ARITHMETIC, NOT TASTE. Five named slices plus the residual is
 * six arcs, which is exactly `pieSlices`' default cap — and that equality is
 * what makes a double-"Other" impossible. Allow a sixth part and `pieSlices`
 * would roll the overflow into its own slice named "Other" while composition
 * has already added a residual by that name: two grey wedges, one label, and
 * `sliceAccent` painting both with the roll-up's reserved grey.
 *
 * THE CEILING IS ENFORCED AT RENDER TOO, and that is not belt-and-braces. The
 * panel caps what it will ADD, but changing a composed funnel to a pie changes
 * the chart column and nothing else — `honoured()` keeps `parts` because the
 * pie's row lists it, and the stored array's 7 entries sail past a cap that was
 * only ever checked while adding.
 */
export const PARTS_SLOT = {
  number: { min: 0, max: 0 },
  line: { min: 0, max: 0 },
  area: { min: 0, max: 0 },
  bar: { min: 0, max: 0 },
  category: { min: 0, max: 0 },
  /** 5 named slices + the residual = 6 arcs, `pieSlices`' own cap. */
  pie: { min: 2, max: 5 },
  progress: { min: 0, max: 0 },
  /** 7 parts + the anchor = 8 stages, which is what a funnel tile holds before it scrolls. */
  funnel: { min: 1, max: 7 },
  pipeline: { min: 1, max: 7 },
  table: { min: 0, max: 0 },
  heading: { min: 0, max: 0 },
  text: { min: 0, max: 0 },
  divider: { min: 0, max: 0 },
} as const satisfies Record<ChartId, { min: number; max: number }>;

/** True when this chart is drawn from `config.parts` rather than from its own data. */
export function composes(chart: ChartId): boolean {
  return PARTS_SLOT[chart].max > 0;
}

/**
 * The charts that can only be built out of several metrics — derived from the
 * table above rather than listed a second time, so adding a composing chart
 * cannot leave this behind.
 *
 * The picker subtracts these from a metric that is not a tally of things (see
 * `tileOptions`), which is the one composition rule `chartsFor` cannot apply:
 * it reads shape, never facts, and whether a number can be a funnel stage is a
 * fact about the number.
 */
export const COMPOSED_CHARTS: ChartId[] = (Object.keys(PARTS_SLOT) as ChartId[]).filter(composes);

/** What this chart offers, in the order the panel should show it. */
export function fieldsFor(chart: ChartId): readonly (keyof TileConfig)[] {
  return CONFIG_FIELDS[chart] ?? EVERY_TILE;
}

/**
 * The config a chart is allowed to see — every other key dropped.
 *
 * The renderer calls this instead of reading the raw bag, so a setting left
 * behind by a previous chart cannot change what the current one draws. Cheap
 * enough to run per render: ten keys, one pass.
 */
export function honoured(chart: ChartId, config: TileConfig): TileConfig {
  const allowed = new Set<string>(fieldsFor(chart));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) if (allowed.has(k)) out[k] = v;
  return out as TileConfig;
}
