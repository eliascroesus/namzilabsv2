import type { DateRange } from "./compute";

export type RangeKey = "today" | "yesterday" | "7d" | "30d" | "90d" | "all" | "upcoming";

export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "all", label: "All time" },
  /**
   * LAST, AND DIRECTLY AFTER "All time" — a placement, not an afterthought.
   *
   * The six before it walk in one direction: each is a wider slice of the past
   * than the one to its left, and that walk is the only ordering the row has.
   * Dropping the single forward-looking option into the middle of it (or first,
   * where it would read as the default) costs that ordering and buys nothing.
   *
   * Beside "All time" is also where it belongs by MEANING, because All time is
   * the only other option that contains future-dated records: it is returned
   * unfiltered, so a meeting booked for next week is already inside it. That is
   * how one workspace read 29.4% all-time against 21.4% over the last 7 days
   * with nothing on the board to explain the gap. "Upcoming" is that
   * difference, now addressable on its own.
   */
  { key: "upcoming", label: "Upcoming" },
];

/**
 * The ranges a published tile is pre-computed for, so the dashboard's pills
 * can switch instantly instead of re-running a flow per click.
 *
 * WHAT A KEY HERE COSTS: one more windowing pass over records the materializer
 * already holds in memory — NOT another graph run. `tileByRange` runs the graph
 * once over the whole history and then re-does only the final arithmetic per
 * range (`reexecPure`, which touches no database). This comment used to say
 * "one extra graph run per materialize", which was true of the first
 * implementation and has been wrong since that one was replaced; a stale cost
 * model is how a range gets left out for a price it no longer has.
 */
export const MATERIALIZED_RANGES: RangeKey[] = ["today", "yesterday", "7d", "30d", "90d", "all", "upcoming"];

const DAY_MS = 86_400_000;
const ROLLING: Record<"7d" | "30d" | "90d", number> = { "7d": 7, "30d": 30, "90d": 90 };

/**
 * The upper bound of "Upcoming": the last instant of year 9999.
 *
 * A `DateRange` is two real Dates and both ends travel — `keep()` in the flow
 * engine compares them as numbers, but `compute.ts` binds them straight into
 * SQL as `occurred_at <= $n`, so this end has to be something Postgres parses.
 * Infinity is not a Date. `new Date(8_640_000_000_000_000)` — the JS maximum —
 * is one, but it serialises as `+275760-09-13T00:00:00.000Z`, the ISO
 * extended-year spelling, which Postgres rejects. Year 9999 is the last year
 * that renders as four plain digits through every serialiser in the path, and
 * it is eight thousand years past anything a calendar will book.
 *
 * A record dated beyond it would drop out of Upcoming. That is a visible
 * omission from a forward-looking pill, not a wrong number under a backward
 * one, and it cannot happen without a source inventing dates.
 */
const FAR_FUTURE = new Date("9999-12-31T23:59:59.999Z");

/**
 * WHICH RANGES LOOK FORWARD — asked in three places, answered here once.
 *
 * The materializer needs it to tell `tileByRange` that this range's end is a
 * sentinel and not the clock (`future`), or every crossing it books lands
 * beyond the horizon. The tile needs it because a comparison's rules invert:
 * the still-filling bucket of a forward series is the FIRST one, and "vs prior"
 * has no meaning for a period nothing has happened in yet. Three copies of
 * `key === "upcoming"` is how one of those places gets missed when a second
 * forward range is added.
 */
export function isForwardRange(key: string | undefined): boolean {
  return key === "upcoming";
}

/**
 * The length of a rolling range, or null for the fixed ones. A rolling
 * window's start moves with the clock, so a record dated `t` falls out of it
 * at exactly `t + length` — the fact the materializer uses to compute the
 * precise moment a stored tile's numbers can next change without any new data
 * arriving. Fixed ranges (today/yesterday/all) only ever change membership at
 * a UTC midnight, which the caller accounts for separately.
 *
 * "Upcoming" answers null with the fixed ones, and not because it is static —
 * its START moves with the clock. It is simply not a BACKWARD window, so
 * nothing falls out of it at a fixed offset from a record's own date; a record
 * leaves it at exactly its own timestamp, which is the same instant it enters
 * every now-ended range. `trackCrossing` in engine.ts already books that moment
 * from the record itself. A length here would invent shed times (`t + length`)
 * that describe nothing.
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
 *
 * Every range but "Upcoming" ends at now or earlier. Calendars date a record by
 * when it WILL happen, so that cap made every future booking invisible on six
 * of the seven pills while "All time" counted them silently — the one range
 * that is deliberately never re-filtered.
 */
export function resolveRange(key: string | undefined): { key: RangeKey; range: DateRange } {
  const now = new Date();
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const k: RangeKey =
    key === "today" || key === "yesterday" || key === "30d" || key === "90d" || key === "all" || key === "upcoming"
      ? key
      : "7d";

  if (k === "all") return { key: k, range: { from: new Date(0), to: now } };
  if (k === "upcoming") {
    return {
      key: k,
      // Strictly after now — the same one-millisecond hygiene "Yesterday" uses
      // against "Today". A record dated exactly now belongs to the ranges that
      // END at now, and must not also be reported as still to come.
      //
      // The bound is COPIED, because a Date is mutable and every other branch
      // here hands back a fresh one: a caller that nudged this end would
      // otherwise move it for every range resolved afterwards in the process.
      range: { from: new Date(now.getTime() + 1), to: new Date(FAR_FUTURE) },
    };
  }
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
