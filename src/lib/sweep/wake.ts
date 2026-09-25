import { revalidateTag } from "next/cache";
import { after } from "next/server";

/**
 * THE TAG ON THE SWEEP GATE'S CACHED ANSWERS — see `gate.ts`.
 *
 * In its own tiny module, with no database import, so the writers that clear
 * it (the cadence, the materializer, the backfill queue, the connection
 * lifecycle) pull in nothing but Next.
 */
export const SWEEP_WAKE_TAG = "sweep:next-wake";

/**
 * TELL THE SWEEP TO LOOK AGAIN — call after any write to a column that decides
 * when sweep work is due: a connection's `status`, `pausedUntil` or
 * `nextSweepAt`; a backfill job's `status`; a result's `status`, `tile` or
 * `computedAt`; and any insert into those tables.
 *
 * The ten-minute crons skip the database while the cached "next thing due" is
 * in the future (`gate.ts`). A write that moved that moment earlier without
 * saying so would leave the crons asleep past it — the one way the gate could
 * delay real work — so every such writer calls this, and
 * `tests/sweep-gate.test.ts` fails when a new one appears that does not.
 *
 * ═══ WHY `after()` ═══
 *
 * 1. IT CANNOT RE-RENDER A BOARD. `revalidateTag` inside a Server Action marks
 *    the action's own response as revalidated, and Next re-renders the page
 *    into it — the mid-drag race `nav-views.ts` documents at length. An
 *    `after()` callback runs once the response has closed, so the page is
 *    untouched: the only thing cleared is the sweep's cache.
 * 2. IT WORKS WHERE A WRITE MIGHT HAPPEN DURING RENDER. `revalidateTag` throws
 *    in a render, and a throw here would be swallowed — a silent miss. Inside
 *    `after()` the render has finished, and Next allows it.
 * 3. IT LANDS AFTER THE WRITE. The invalidation is flushed once the request is
 *    done, so the next cache fill cannot read the database from before the
 *    write it is announcing.
 *
 * `expire: 0`, NOT the "max" profile: stale-while-revalidate would hand the
 * next cron the OLD answer once more while it refreshed — a tick of delay this
 * exists to prevent.
 *
 * NEVER THROWS. Outside a Next request (tests, scripts) there is no cache to
 * clear and `after` refuses; the cached answer still expires on its own within
 * the hour (`gate.ts`). Many calls in one request are fine — Next flushes one
 * invalidation per tag.
 */
export function wakeSweeper(): void {
  try {
    after(() => {
      try {
        revalidateTag(SWEEP_WAKE_TAG, { expire: 0 });
      } catch (e) {
        // Loud, because this is the failure that would let the gate sleep
        // through real work (bounded by the hour-long ceiling in gate.ts).
        console.error("[sweep-wake] could not clear the sweep gate's cache", e);
      }
    });
  } catch {
    /* no request scope — nothing cached here to clear */
  }
}
