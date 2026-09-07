import { parseCustomRange } from "./range";

/**
 * ANSWERING A CUSTOM WINDOW OUT OF WHAT THE TILE ALREADY CARRIES.
 *
 * A flow tile's numbers are PRECOMPUTED. `materializeFlow` runs the flow once
 * over its whole history and then re-does only the final arithmetic per window,
 * storing six named ranges plus a value for every UTC day of the last two
 * calendar months (`byDay`, which is what the Calendar view draws). Nothing
 * computes a flow tile at read time, and the reason is written down in
 * `flow/types.ts`: a read-time run would re-query the whole history on every
 * page view, against a database that bills every byte it returns.
 *
 * So a window the customer drew has three possible answers, and this module is
 * the one place that decides which:
 *
 *   STORED     — the key already has a slot. A window that equals a preset was
 *                canonicalised back to it by `resolveRange`; a custom window
 *                computed earlier kept its slot. Nothing to do.
 *   SUMMED     — every day of the window is present in `byDay` and the metric
 *                is a COUNT. Add them up. No query, no flow run, instant.
 *   NEEDS-COMPUTE — anything else. The caller asks the server to materialize
 *                this one window and store it.
 *
 * WHY THE COUNT RULE IS NOT AN OPTIMISATION BUT THE WHOLE CORRECTNESS QUESTION.
 * Half of seven daily RATES is not the week's rate. The mean of seven daily
 * MEANS is not the week's mean. Only an additive measure survives being folded
 * across days, and `facts.kind` is the tile's own record of which it is —
 * `count` is additive, `ratio` and `duration` are not. The engine refuses to
 * fold the other two everywhere else (`withTrends`, `tileByRange`), and this
 * refuses them here for exactly the same reason. A tile with NO `facts` at all
 * is a tile published before that stamp existed: unknown is not `count`, so it
 * takes the slow path and gets a real answer rather than a plausible one.
 */

/** The shape of one stored range answer, as this module needs to read it. */
export type RangeSlotLike = {
  value?: number;
  records?: number;
  series?: Array<{ bucket: string; value: number }>;
  unit?: string;
  assembled?: boolean;
  groups?: unknown;
  unavailable?: string;
  undated?: number;
};

/** The slice of a stored tile the rules above read. Structural, so a real `TileSpec` satisfies it. */
export type DerivableTile = {
  facts?: { kind?: string };
  byRange?: Record<string, RangeSlotLike>;
  byDay?: Record<string, { value: number; records?: number }>;
};

export type Derivation = "stored" | "summed" | "needs-compute";

/** Every UTC day key the window covers, inclusive at both ends. */
function daysOf(start: number, end: number): string[] {
  const DAY_MS = 86_400_000;
  const out: string[] = [];
  for (let t = start; t <= end; t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export function deriveRangeSlot(
  tile: DerivableTile | null | undefined,
  key: string,
  now: Date = new Date(),
): { how: Derivation; slot: RangeSlotLike | null } {
  const stored = tile?.byRange?.[key];
  if (stored) return { how: "stored", slot: stored };

  const window = parseCustomRange(key, now);
  if (!window || !tile) return { how: "needs-compute", slot: null };
  // Only an additive measure may be folded. See the header.
  if (tile.facts?.kind !== "count") return { how: "needs-compute", slot: null };

  const byDay = tile.byDay;
  if (!byDay) return { how: "needs-compute", slot: null };
  const days = daysOf(window.start, window.end - 86_399_999);

  let value = 0;
  let records = 0;
  let everyDayCounted = true;
  const series: Array<{ bucket: string; value: number }> = [];
  for (const day of days) {
    const slot = byDay[day];
    /**
     * A MISSING DAY IS NOT A ZERO. `dayValues` DROPS a day it could not answer
     * and KEEPS a genuine zero, precisely so the two stay distinguishable — the
     * calendar draws them differently. Summing a window with a hole in it would
     * report a number lower than the truth, confidently, which is the failure
     * this whole module exists to avoid. It also catches the window reaching
     * past the two-month horizon `byDay` covers.
     */
    if (!slot) return { how: "needs-compute", slot: null };
    value += slot.value;
    if (slot.records == null) everyDayCounted = false;
    else records += slot.records;
    series.push({ bucket: day, value: slot.value });
  }

  return {
    how: "summed",
    slot: {
      value,
      // Only when EVERY day carried one — a partial count is worse than none.
      ...(everyDayCounted && records > 0 ? { records } : {}),
      /**
       * The day series comes free: it is the same numbers, in the same order,
       * that the sum was made of. `assembled: true` because it was built from
       * windows rather than measured as one — the flag the tile reads to
       * decide it may draw a SHAPE but must not quote a bucket-to-bucket
       * delta off it (`drawsItsSeries`, `deriveDelta`).
       */
      ...(series.length >= 2 ? { series, unit: "day", assembled: true } : {}),
    },
  };
}

/**
 * The same answer, folded back into a stored row so the tile components read it
 * exactly as they read a materialized one.
 *
 * WHY A ROW WRAPPER RATHER THAN A BRANCH INSIDE `FlowTile`. Three components
 * read `byRange` — `flow-tile.tsx`, `custom-tile.tsx` and `tileValueForRange`
 * (which the board's own value sort calls) — and a branch in one of them would
 * leave the other two disagreeing about what the same tile is worth under the
 * same window. Writing the slot INTO the row upstream means every reader sees
 * one answer and none of them needs to know a derivation happened.
 */
export function withDerivedRange<T extends { tile: unknown }>(row: T, key: string, now: Date = new Date()): T {
  const tile = (row.tile ?? {}) as DerivableTile;
  const { how, slot } = deriveRangeSlot(tile, key, now);
  if (how !== "summed" || !slot) return row;
  return {
    ...row,
    tile: {
      ...tile,
      byRange: { ...(tile.byRange ?? {}), [key]: slot },
      /**
       * `byDay` is dropped on the way out. It is what the sum was made FROM,
       * the tile has no other use for it on the dashboard, and it is the
       * heaviest thing in the jsonb — sixty numbers per tile that would
       * otherwise ride to the client on a render that already has its answer.
       */
      byDay: undefined,
    },
  };
}
