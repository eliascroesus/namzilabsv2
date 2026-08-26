/**
 * WHICH CHARTS CAN HONESTLY DRAW A METRIC — asked by the picker, enforced by
 * the renderer, defined exactly once here.
 *
 * THE PROBLEM THIS EXISTS TO FIX. A published tile already carries a `viz`
 * field, and it is DECORATIVE: `flow-tile.tsx` chooses its mark from data
 * presence alone — series, then groups, then target — and never reads it. In
 * the whole repo `viz` changes behaviour in one place. The interface has been
 * apologising for it in prose ever since: `ReviewPublishModal` labels three of
 * its own options "Line chart (draws bars)", "Table (draws bars)", "Funnel
 * (draws bars)".
 *
 * A custom view cannot repeat that. Picking a chart is the entire interaction,
 * so a chart has to be a thing the tile actually draws — which means something
 * has to say which charts a given metric CAN draw, and something has to stop a
 * stored choice quietly turning into a different drawing when the data changes
 * underneath it. Both are here.
 *
 * ONLY FIVE CHARTS EXIST, AND THAT IS DELIBERATE. `charts.tsx` has four marks;
 * pie, line, area and table have no renderer at all. Offering them and drawing
 * bars is precisely the lie above, so they are absent until their marks are
 * written rather than present and dishonest.
 *
 * No `"use client"` — the same rule `grid.ts` and `board-shape.ts` carry. The
 * server computes availability for the picker and the client filters with it,
 * and a client module's export becomes a throwing stub in a server component.
 */

import type { TilePresentation } from "@/lib/flow/engine";

/** The charts a custom tile may be, in the order the picker offers them. */
export const CHARTS = [
  {
    id: "number",
    label: "Single number",
    blurb: "The headline figure, with its change since the period before.",
    w: 3,
    h: 4,
    minW: 2,
    minH: 3,
  },
  {
    id: "bar",
    label: "Bar chart",
    blurb: "One bar per period, so the shape of a trend is visible at a glance.",
    w: 6,
    h: 6,
    minW: 3,
    minH: 4,
  },
  {
    id: "category",
    label: "Breakdown",
    blurb: "One bar per group — by rep, by source, by stage.",
    w: 4,
    h: 6,
    minW: 3,
    minH: 4,
  },
  {
    id: "progress",
    label: "Progress to target",
    blurb: "How far the number has come toward the goal set on it.",
    w: 3,
    h: 4,
    minW: 2,
    minH: 3,
  },
  {
    id: "funnel",
    label: "Funnel",
    blurb: "Stage by stage, with the biggest drop called out.",
    w: 6,
    h: 6,
    minW: 4,
    minH: 5,
  },
] as const;

export type ChartId = (typeof CHARTS)[number]["id"];

export const CHART_IDS: ChartId[] = CHARTS.map((c) => c.id);

/** An unknown stored value degrades to the one chart every metric can draw. */
export function asChartId(value: unknown): ChartId {
  return CHART_IDS.includes(value as ChartId) ? (value as ChartId) : "number";
}

/**
 * WHAT A METRIC CAN ANSWER WITH — the only thing that decides which charts may
 * be offered for it.
 *
 * Deliberately a set of capabilities rather than one "kind", because a metric
 * can have several at once: a grouped metric has both a headline number and a
 * breakdown, and both are honest drawings of it.
 */
export type MetricShape = {
  /** A single figure. Every metric that can answer at all has one. */
  scalar: boolean;
  /** A value per time bucket. */
  series: boolean;
  /** A value per named group. */
  groups: boolean;
  /** A goal was set on it, so "how far along" is a real question. */
  target: boolean;
  /** A classic funnel metric, which is its own thing and nothing else's. */
  funnel: boolean;
};

export const NO_SHAPE: MetricShape = { scalar: false, series: false, groups: false, target: false, funnel: false };

/**
 * THE SHAPE OF A STORED FLOW TILE — ACROSS EVERY RANGE, NOT THE ACTIVE ONE.
 *
 * This is the subtle decision in the file, so it is written down. `byRange`
 * answers each period separately, and a metric can have a series under "Last 7
 * days" and none under "Today" simply because today is quiet. If availability
 * were computed from the ACTIVE range, a bar chart would become an illegal
 * chart the moment someone pressed Today — and the tile would have to do
 * something about it, on a board where nothing has actually changed.
 *
 * So legality is a property of the METRIC: can any period draw this? Emptiness
 * in the period you are looking at is a RENDER state — "no trend in this
 * period" — exactly as it already is for every tile on the groups board.
 *
 * Derived from the stored tile rather than from `outputShapeOf` in
 * `flow/shapes.ts`, which reads a flow GRAPH NODE: half the metrics on a board
 * are classic ones with no graph at all, and a tile that has been published is
 * a more direct answer than the definition that produced it.
 */
export function shapeOfTile(tile: unknown): MetricShape {
  const t = (tile ?? {}) as {
    value?: number;
    series?: unknown[];
    groups?: unknown[];
    target?: number | null;
    byRange?: Record<string, { value?: number; series?: unknown[]; groups?: unknown[] }>;
  };
  const slots = [t, ...Object.values(t.byRange ?? {})];
  return {
    scalar: slots.some((s) => typeof s.value === "number" && Number.isFinite(s.value)),
    series: slots.some((s) => Array.isArray(s.series) && s.series.length > 0),
    groups: slots.some((s) => Array.isArray(s.groups) && s.groups.length > 0),
    target: typeof t.target === "number" && Number.isFinite(t.target),
    funnel: false,
  };
}

/**
 * THE SHAPE OF A CLASSIC METRIC, which is computed live rather than stored.
 *
 * The classic engine produces only `scalar` or `series` (a non-null time bucket
 * is the whole difference) plus funnels, and has no notion of a grouped result
 * at all — so `groups` is false here by construction rather than by accident.
 */
export function shapeOfClassic(
  result: { kind: "scalar" } | { kind: "series"; series: unknown[] } | { stages: unknown[] } | null,
  target: number | null,
): MetricShape {
  if (result && "stages" in result) return { ...NO_SHAPE, funnel: true };
  return {
    scalar: result?.kind === "scalar" || result?.kind === "series",
    series: result?.kind === "series" && result.series.length > 0,
    groups: false,
    target: typeof target === "number" && Number.isFinite(target),
    funnel: false,
  };
}

/**
 * WHICH CHARTS THIS SHAPE MAY BE DRAWN AS, in the picker's own order.
 *
 * A FUNNEL IS ONLY EVER A FUNNEL. `FunnelView` eats a classic `FunnelResult`
 * and nothing else produces one, so a funnel metric offers that and stops.
 * Deriving a funnel from a grouped metric would be a confident lie unless the
 * groups genuinely are ordered stages, and nothing here can know that.
 *
 * `target` is not its own shape so much as a permission: a metric with a goal
 * can be drawn as progress, and one without cannot, because there is nothing to
 * be progressing toward.
 */
export function chartsFor(shape: MetricShape): ChartId[] {
  if (shape.funnel) return ["funnel"];
  const out: ChartId[] = [];
  if (shape.scalar) out.push("number");
  if (shape.series) out.push("bar");
  if (shape.groups) out.push("category");
  if (shape.target && shape.scalar) out.push("progress");
  return out;
}

/**
 * The footprint a chart lands at when it is added.
 *
 * `minW`/`minH` sit in the table beside these and have no accessor yet — the
 * resize gesture is the only thing that asks for a floor, and an exported
 * function nothing calls fails `check:orphans`. The data is here so the two
 * numbers are decided together; the reader arrives with the gesture.
 */
export function defaultSize(chart: ChartId): { w: number; h: number } {
  const c = CHARTS.find((k) => k.id === chart) ?? CHARTS[0];
  return { w: c.w, h: c.h };
}

/**
 * The presentation bag every mark and every formatter reads. A stored tile
 * satisfies it structurally, which is why `format={tile}` works throughout —
 * this alias exists so the custom renderer can say so in its own types.
 */
export type ChartFormatBag = Pick<TilePresentation, "format" | "currency" | "precision" | "unit" | "durationDisplay">;
