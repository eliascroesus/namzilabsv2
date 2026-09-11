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
 * `widensAt` LIVED HERE AND HAS BEEN DELETED — recorded because the argument it
 * carried is worth more than the function was, and because a cap is the kind of
 * thing that gets reinvented.
 *
 * It named the stages that were bigger than stage 1, so the renderers could cut
 * their bars visibly and the tile could print "…is larger than the first stage,
 * so its bar is capped". All of that existed to survive a width rule that
 * measured against the FIRST stage and clamped at 100%: a stage at 340% drew
 * exactly as long as one at 100%, which is the worst class of chart bug — the
 * reader is told two stages are equal, and nothing about the drawing looks
 * wrong.
 *
 * THE LESSON THAT OUTLIVES IT: a clamp on a length channel is a broken axis
 * wearing a different hat, and no amount of annotation repairs it. `stageWidths`
 * measures against the LARGEST stage instead, which cannot overflow, so there is
 * nothing to cut, nothing to name and nothing to apologise for. If anyone is
 * ever tempted to reintroduce share-of-first, this is what it costs.
 */
