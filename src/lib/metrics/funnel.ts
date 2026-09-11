/**
 * THE ARITHMETIC OF A FUNNEL, WITH NO IDEA WHERE THE NUMBERS CAME FROM.
 *
 * Two callers need it and they could not be further apart. `computeFunnel`
 * (compute.ts) gets its counts from one `count(distinct subject)` per stage
 * against the events table; `composeFunnel` (board/compose.ts) gets them from
 * published tiles the board is already holding in memory, in the browser. So
 * this module takes an array of numbers and imports NOTHING — no db, no drizzle,
 * no schema — which is what lets a client component use it without dragging the
 * server's query builder into the bundle.
 *
 * It exists because the alternative was writing the conversion arithmetic twice
 * and letting the two drift, and because `compute.ts` is FROZEN: it may take
 * bug fixes and get smaller, not grow a second consumer's helper.
 */

export type FunnelStage = {
  label: string;
  count: number;
  /** Share of stage 1. The reader's "how much of the top got here". */
  conversionFromFirst: number;
  /** Share of the stage immediately above. Where a drop actually happened. */
  conversionFromPrev: number;
};

export type FunnelResult = {
  stages: FunnelStage[];
  /** Stage index with the largest absolute drop from the previous stage. */
  bottleneckIndex: number | null;
};

/**
 * Stages and conversions from ordered counts.
 *
 * A ZERO DROP IS NOT A BOTTLENECK, and that was a live bug for as long as this
 * arithmetic has existed. `worstDrop` started at -1 and the test was
 * `drop > worstDrop`, so a drop of ZERO beat it: every flat funnel — two stages
 * with the same count, which is exactly what a healthy one looks like — printed
 * a red "Biggest drop-off" pill over stage 2, and so did every funnel whose
 * stages were all zero because nothing had happened yet that day.
 *
 * Requiring `drop > 0` says the true thing: when nobody fell out between any
 * two stages, there is no biggest drop-off to point at, and `bottleneckIndex`
 * is null. `FunnelView` and `Pipeline` already draw nothing for null.
 *
 * The guards below are PostHog's: a zero denominator yields 0, never NaN and
 * never Infinity, because a funnel whose first stage is empty has no shares to
 * report rather than infinite ones.
 */
export function funnelFromCounts(members: Array<{ label: string; count: number }>): FunnelResult {
  const counts = members.map((m) => m.count);
  const first = counts[0] ?? 0;
  let bottleneckIndex: number | null = null;
  let worstDrop = 0;

  const stages = members.map((m, i) => {
    const prev = i === 0 ? counts[i] : counts[i - 1];
    if (i > 0) {
      const drop = (counts[i - 1] ?? 0) - counts[i];
      if (drop > worstDrop) {
        worstDrop = drop;
        bottleneckIndex = i;
      }
    }
    return {
      label: m.label,
      count: counts[i],
      conversionFromFirst: first > 0 ? counts[i] / first : 0,
      conversionFromPrev: prev > 0 ? counts[i] / prev : 0,
    };
  });

  return { stages, bottleneckIndex };
}

/**
 * WHICH STAGES ARE BIGGER THAN THE TOP OF THE FUNNEL — by index, never
 * including 0.
 *
 * A funnel is a claim that each stage is a subset of the one above it. A
 * COMPOSED funnel cannot enforce that: its stages are independent metrics
 * counted over the same window, so "Booked Leads" may legitimately exceed
 * "Total Leads" when a booking came from a lead created last month. The
 * drawing has no way to express that — both renderers size a bar as a share of
 * stage 1 inside an `overflow-hidden` track, so anything over 100% CLIPS and
 * reads as "exactly the same as stage 1", which is worse than wrong because it
 * looks correct.
 *
 * So the caller clamps the geometry and says this out loud instead.
 *
 * COMPARED AGAINST THE FIRST STAGE, NOT THE PREVIOUS ONE. Adjacent comparison
 * misses the case that actually clips: 100 -> 400 -> 250 names stage 2 and stays
 * silent about stage 3, which is 250% of the top and clipped just as flat.
 */
export function widensAt(stages: Array<{ count: number }>): number[] {
  const first = stages[0]?.count ?? 0;
  if (first <= 0) return [];
  return stages.map((s, i) => (i > 0 && s.count > first ? i : -1)).filter((i) => i >= 0);
}
