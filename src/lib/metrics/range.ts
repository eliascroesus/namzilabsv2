import type { DateRange } from "./compute";

export type RangeKey = "today" | "yesterday" | "7d" | "30d" | "90d" | "all";

export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "all", label: "All time" },
];

/**
 * The ranges a published tile is pre-computed for, so the dashboard's pills
 * can switch instantly instead of re-running a flow per click. Every key here
 * costs one extra graph run per materialize — narrow ones are cheap, and
 * "all" reuses the run the materializer already did.
 */
export const MATERIALIZED_RANGES: RangeKey[] = ["today", "yesterday", "7d", "30d", "90d", "all"];

const DAY_MS = 86_400_000;
const ROLLING: Record<"7d" | "30d" | "90d", number> = { "7d": 7, "30d": 30, "90d": 90 };

/**
 * The length of a rolling range, or null for the fixed ones. A rolling
 * window's start moves with the clock, so a record dated `t` falls out of it
 * at exactly `t + length` — the fact the materializer uses to compute the
 * precise moment a stored tile's numbers can next change without any new data
 * arriving. Fixed ranges (today/yesterday/all) only ever change membership at
 * a UTC midnight, which the caller accounts for separately.
 */
export function rollingMsOf(key: RangeKey): number | null {
  return key === "7d" || key === "30d" || key === "90d" ? ROLLING[key] * DAY_MS : null;
}

/**
 * Resolve a range key to a concrete {from, to} window.
 *
 * DAY BOUNDARIES ARE UTC, and they are computed exactly the way the flow
 * engine computes its own `today` / `yesterday` presets (`timeWindow` in
 * engine.ts). The whole product dates records in UTC; a dashboard that
 * defined "today" locally would put a different number beside the same
 * metric depending on who opened it, and disagree with the identical preset
 * inside a flow. One definition, both places.
 *
 * "Today" runs to NOW, not to end-of-day — a period still in progress holds
 * fewer records than a finished one, which is the whole reason "Yesterday"
 * is offered beside it.
 */
export function resolveRange(key: string | undefined): { key: RangeKey; range: DateRange } {
  const now = new Date();
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const k: RangeKey =
    key === "today" || key === "yesterday" || key === "30d" || key === "90d" || key === "all" ? key : "7d";

  if (k === "all") return { key: k, range: { from: new Date(0), to: now } };
  if (k === "today") return { key: k, range: { from: startOfToday, to: now } };
  if (k === "yesterday") {
    return {
      key: k,
      // Ends one millisecond before today begins, so a record at 23:59:59.999
      // is inside yesterday and midnight exactly is not counted twice.
      range: { from: new Date(startOfToday.getTime() - DAY_MS), to: new Date(startOfToday.getTime() - 1) },
    };
  }
  return { key: k, range: { from: new Date(now.getTime() - ROLLING[k] * DAY_MS), to: now } };
}
