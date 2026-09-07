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
 * ONCE PER KEY, NOT ONCE PER RENDER. `router.refresh()` re-runs the server
 * component, which renders this again with a shorter list — and if the last
 * flow could not be computed at all (an errored flow recomputes to the same
 * error) that list never empties. The ref keys on the range, so switching
 * windows arms it again and re-rendering the same window does not.
 *
 * THE ACTION IS BOUNDED at ten flows per call and gated on the caller's own
 * per-metric visibility; a board with more fills in over successive refreshes
 * rather than holding one request open for all of them.
 */
export function CustomRangeCompute({ rangeKey, flowIds }: { rangeKey: string; flowIds: string[] }) {
  const router = useRouter();
  const asked = useRef<string | null>(null);

  useEffect(() => {
    if (flowIds.length === 0 || asked.current === rangeKey) return;
    asked.current = rangeKey;
    let cancelled = false;
    void computeRangeAction(rangeKey, flowIds).then(() => {
      // A navigation away mid-flight must not pull the page out from under
      // whatever replaced it.
      if (!cancelled) router.refresh();
    });
    return () => {
      cancelled = true;
    };
    // `flowIds` is a fresh array on every render; the ref is what makes this
    // fire once, so the array is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey, router]);

  return null;
}
