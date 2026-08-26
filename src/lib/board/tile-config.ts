import { z } from "zod";
import { GROUP_ACCENT } from "@/components/flow/node-accent";
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
 */
export function accentOf(color?: string): string {
  /**
   * `Object.hasOwn`, not `in` — `in` walks the prototype chain, so "constructor"
   * and "toString" passed the schema and then resolved to a FUNCTION here,
   * which React stringifies into the style attribute. An own-property check
   * closes the write path and degrades anything already stored to the default.
   */
  return color && Object.hasOwn(GROUP_ACCENT, color) ? GROUP_ACCENT[color] : "var(--color-brand-600)";
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
 * colour; `FunnelView` takes nothing but its result, so `funnel` offers only
 * the two settings every tile has; `ChartTable` formats nothing itself, so it
 * takes `precision` (which reaches it through the format bag) but not `sort`
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
  pie: [...EVERY_TILE, "precision", "limit", "donut", "legend"],
  progress: [...EVERY_TILE, "precision", "target"],
  funnel: [...EVERY_TILE],
  pipeline: [...EVERY_TILE, "color"],
  table: [...EVERY_TILE, "precision"],
} as const satisfies Record<ChartId, readonly (keyof TileConfig)[]>;

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
