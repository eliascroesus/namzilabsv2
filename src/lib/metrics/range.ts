import type { DateRange } from "./compute";

/**
 * "upcoming" was a seventh member here. It is gone from the type as well as
 * from the two lists below, because nothing can construct it any more —
 * `resolveRange` falls back for it like any other unrecognised string — and a
 * type that advertises a key no code path produces is a promise the module
 * cannot keep. `isForwardRange` survives as the seam; see its own note.
 */
export type RangeKey = "today" | "yesterday" | "7d" | "30d" | "90d" | "all";

/**
 * THE PILLS ON THE BOARD. Every one of them looks BACKWARD, and that is the
 * rule rather than an accident of which six got written.
 *
 * "Upcoming" used to sit at the end of this list. It was a correct answer to a
 * real question — All time silently contains future-dated records, so a
 * workspace could read 29.4% all-time against 21.4% over seven days with
 * nothing on the board explaining the gap — but it answered it in the wrong
 * room. A dashboard tile is a RESULT: one number, stamped with when it was
 * last true. A meeting booked for Friday is not a result, and a headline
 * figure that silently mixes what happened with what is merely scheduled is
 * the same trap the delta guard below exists to catch, one level up.
 *
 * The forward view lives on the Calendar, which is shaped for it — days, laid
 * out, with the ones still to come drawn quieter than the ones that happened
 * (see `future` in CalendarBoard's DayCell). That is the same fact given a
 * surface that can say "not yet" about it.
 *
 * The key itself is NOT retired — see `RangeKey`, `resolveRange` and
 * `isForwardRange`, all of which still handle it. A bookmarked
 * `?range=upcoming` has to resolve to a real window rather than throw.
 */
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
 * can switch instantly instead of re-running a flow per click.
 *
 * WHAT A KEY HERE COSTS: one more windowing pass over records the materializer
 * already holds in memory — NOT another graph run. `tileByRange` runs the graph
 * once over the whole history and then re-does only the final arithmetic per
 * range (`reexecPure`, which touches no database). This comment used to say
 * "one extra graph run per materialize", which was true of the first
 * implementation and has been wrong since that one was replaced; a stale cost
 * model is how a range gets left out for a price it no longer has.
 *
 * IT ALSO COSTS A SLOT IN EVERY STORED TILE'S JSONB, FOREVER, and that is the
 * half the cost model above was missing. `flow_results.tile` is read on every
 * dashboard render and every freshness refresh, and Neon bills what it
 * returns — so a key nothing can select is bytes on the wire for every tile of
 * every workspace, permanently. That is why "upcoming" left this list at the
 * same time it left `RANGE_OPTIONS`: no pill can ask for it.
 *
 * The calendar is unaffected and does not read this constant. Its day slots
 * come from `calendarDayRanges`, an independent list assembled beside this one
 * in materialize.ts — which is exactly why the forward view survives the pill's
 * removal.
 */
export const MATERIALIZED_RANGES: RangeKey[] = ["today", "yesterday", "7d", "30d", "90d", "all"];

const DAY_MS = 86_400_000;
const ROLLING: Record<"7d" | "30d" | "90d", number> = { "7d": 7, "30d": 30, "90d": 90 };

/**
 * WHICH RANGES LOOK FORWARD — asked in three places, answered here once.
 *
 * NOTHING SELECTABLE IS FORWARD TODAY, so this returns false for every key the
 * board can produce. It is kept, rather than deleted along with the pill, for
 * two reasons that are not sentiment:
 *
 *  - It is the SEAM. The two callers encode real, non-obvious rules that a
 *    forward range needs and a backward one must not have — the materializer
 *    tells `tileByRange` that such a range's end is a sentinel rather than the
 *    clock (`future`), without which every crossing it books lands beyond the
 *    horizon; and the tile suppresses "vs prior", because a comparison's rules
 *    invert when the still-filling bucket is the FIRST one and the period has
 *    had nothing happen in it yet. Re-adding a forward range is then one line
 *    here instead of a rediscovery of both rules.
 *  - Deleting it would make `future` a hardcoded `false` at the materializer's
 *    call site, which reads as "this range is backward" rather than as "no
 *    range is forward" — and those are different claims.
 *
 * The forward view itself did not go anywhere: it is the Calendar, whose
 * squares come from `calendarDayRanges` and are drawn quieter for days still to
 * come. The engine's own forward handling is likewise untouched and stays
 * covered by tests/flow-range.test.ts, which builds its window directly.
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
 * EVERY RANGE ENDS AT NOW OR EARLIER, and "upcoming" is no longer among the
 * keys this accepts — it falls through to the default with every other string
 * it does not recognise.
 *
 * KEEPING IT RESOLVABLE WAS THE WRONG CALL, and the reasoning that produced it
 * is worth writing down because it sounds right. When the pill was removed the
 * key was deliberately left working here, so that a bookmarked
 * `?range=upcoming` would "resolve to a real window rather than throw". What it
 * actually bought was a state nobody can leave: the key is gone from
 * `MATERIALIZED_RANGES`, so no stored tile has a slot under it, so
 * `flow-tile.tsx` renders every metric as "—" with "Not computed yet for this
 * range — Refresh to compute it" — and pressing Refresh re-materializes the six
 * ranges that exist and changes nothing, forever. A 500 is honest by
 * comparison; this is the board lying about which button fixes it. It also
 * mislabelled `metrics/[id]`, whose lede looks the key up in `RANGE_OPTIONS`
 * and falls back to "last 30 days" — so the page named a window it was not
 * showing.
 *
 * Falling back is the whole fix: an old link now opens the default board with
 * the matching pill lit, which is what every other unrecognised key has always
 * done and what a stale bookmark should do.
 *
 * `RangeKey`, `isForwardRange` and `FAR_FUTURE` all stay. They are the seam a
 * forward range is re-added through, and `isForwardRange` still gates the
 * materializer's `future` flag and the tile's delta guard — both correct and
 * both currently inert.
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
