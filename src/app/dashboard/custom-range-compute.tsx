"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { computeRangeAction } from "@/app/dashboard/flows/actions";

/**
 * THE SECOND HALF OF THE HYBRID — asking the server for the windows the board
 * could not answer from what it already had.
 *
 * A window the customer drew on the calendar is answered three ways (see
 * `lib/metrics/derive-range.ts`): a stored slot, a sum of the tile's own day
 * values, or a computation. The first two happen during the render and cost
 * nothing. This is the third: it names the flows whose tiles arrived without a
 * slot, asks the server to materialize that one window for them, and refreshes.
 *
 * IT RENDERS NOTHING. The tiles already say what they are doing — a tile with
 * no slot for the active range prints its own "not computed for this range"
 * line — and a second, page-level spinner over a board that is still showing
 * every OTHER number correctly would be a bigger claim than the truth.
 *
 * ONCE PER (WINDOW, SET OF FLOWS), NOT ONCE PER RENDER. `router.refresh()`
 * re-runs the server component, which renders this again with a shorter list —
 * and if the last flow could not be computed at all (an errored flow recomputes
 * to the same error) that list never empties. The ref is what stops that
 * becoming a loop.
 *
 * THE KEY USED TO BE THE RANGE ALONE, which broke the thing people actually do:
 * draw a two-week window on one view, then switch to another. Switching a view
 * is a client-side navigation on the SAME route, so this component is never
 * remounted and its ref survives — the new view's flows arrived carrying the
 * same `rangeKey`, the guard said "already asked", and nothing was ever
 * computed for them. Every tile on the new view sat printing "not computed for
 * this range" under a picker that said two weeks, which reads exactly like the
 * range having been thrown away on the way over.
 *
 * Keying on the FLOWS as well as the window fixes that without reopening the
 * loop: a different view is a different set and arms it again, while a refresh
 * that computed nothing returns the identical set and does not.
 *
 * THE ACTION IS BOUNDED at ten flows per call and gated on the caller's own
 * per-metric visibility; a board with more fills in over successive refreshes
 * rather than holding one request open for all of them.
 */
export function CustomRangeCompute({ rangeKey, flowIds }: { rangeKey: string; flowIds: string[] }) {
  const router = useRouter();
  const asked = useRef<string | null>(null);
  /**
   * Sorted, so the same set in a different order is the same key — the server
   * builds this list from a query whose order is not promised.
   */
  const key = `${rangeKey}|${[...flowIds].sort().join(",")}`;

  useEffect(() => {
    if (flowIds.length === 0 || asked.current === key) return;
    asked.current = key;
    let cancelled = false;
    void computeRangeAction(rangeKey, flowIds).then(() => {
      // A navigation away mid-flight must not pull the page out from under
      // whatever replaced it.
      if (!cancelled) router.refresh();
    });
    return () => {
      cancelled = true;
    };
    /**
     * `key` IS the dependency — it is a complete summary of `rangeKey` and
     * `flowIds`, as a string, so it compares by value.
     *
     * LISTING `flowIds` ITSELF WOULD BREAK THE REFRESH. It is a fresh array on
     * every render, so the effect would re-run on every render, and each re-run
     * fires the PREVIOUS one's cleanup — setting `cancelled` on the request
     * still in flight. The computation would finish on the server and the board
     * would never be told, which is the one failure nobody could see.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, router]);

  return null;
}
