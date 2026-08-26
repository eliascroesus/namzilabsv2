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
/**
 * How many whole UTC days each backward pill spans, TODAY INCLUDED. "Last 7
 * days" is today and the six days before it, so it starts six midnights ago —
 * see `resolveRange` for why these are whole days rather than rolling hours.
 */
const WINDOW_DAYS: Record<"today" | "7d" | "30d" | "90d", number> = { today: 1, "7d": 7, "30d": 30, "90d": 90 };

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
 * NO PILL IS A ROLLING WINDOW ANY MORE, which is why `rollingMsOf` is gone from
 * this module rather than returning null from it.
 *
 * It existed to tell the materializer the exact instant a stored tile's numbers
 * could next change with no new data: a window ending at the CLOCK sheds the
 * record dated `t` at precisely `t + length`, and booking those moments is what
 * let a quiet flow stop re-reading its whole history every ten minutes. Every
 * window below is now anchored to midnight at BOTH ends, so membership cannot
 * change between midnights at all — and `tileByRange` already seeds
 * `nextChangeMs` with the next UTC midnight unconditionally. Shed times would
 * now be strictly redundant recomputes: the same tile, re-read at 14:07,
 * because a record aged out of a boundary that had not moved.
 *
 * The ENGINE keeps its rolling support (`rollingMs` on `tileByRange`'s window
 * argument, covered by tests/flow-range.test.ts). It is the dashboard that no
 * longer has a rolling window to describe.
 */

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
 * EVERY WINDOW IS A WHOLE NUMBER OF WHOLE UTC DAYS, ENDING TONIGHT. "Today" is
 * midnight to 23:59:59.999, not midnight to the clock, and "Last 7 days" is
 * today plus the six days before it.
 *
 * THIS REVERSES A DELIBERATE DECISION, so here is the one it reverses and why
 * it was wrong. The window used to end at NOW, the argument being that a period
 * still in progress holds fewer records than a finished one and pretending
 * otherwise reports a part-day as a whole one — which is exactly right when a
 * record is dated WHEN IT HAPPENED.
 *
 * Half this product's records are dated when they WILL happen. A Calendly
 * meeting booked for 16:00 is a row dated 16:00, and read at 13:00 it sat
 * outside a window that stopped at 13:00 — so the board showed 0 bookings on a
 * day with three of them, and drew "-100% vs yesterday" underneath, because
 * "Yesterday" is a complete day and was being compared against a half-finished
 * one. Reported as "it shows 0 until the meetings have happened".
 *
 * The engine had ALREADY conceded this in the place it hurt most: "All time" is
 * returned unfiltered by `tileByRange` precisely because "Calendly meetings are
 * dated when they will happen, so filtering would drop every future booking out
 * of the total". So All time counted that meeting, Today did not, and the
 * calendar — whose squares are whole days — counted it too. Three surfaces,
 * three answers, one stored tile. The windows are now the same windows, and
 * `tests/range-covers-scheduled.test.ts` pins each pill to the calendar squares
 * it should equal the sum of.
 *
 * THE START HAD TO MOVE WITH THE END. A window running from `now - 7 days` to
 * midnight tonight would span seven days plus however much of today had
 * elapsed — seven and a half days of data under a label reading seven, and a
 * total that changed all day without any data arriving.
 *
 * "All time" ends tonight too, and NOT at a far-future sentinel, even though it
 * means what it says. `tileByRange` derives its notion of "now" from the
 * largest end among the ranges it is handed (see its note): one sentinel here
 * would put every record in the past, book no crossings at all, and freeze
 * `nextChangeAt` in year 9999. The flow path never feels the bound anyway — it
 * flags `all` and returns the run untouched — and for classic metrics tonight
 * is both wider than the clock it replaced and consistent with every pill
 * beside it.
 *
 * "upcoming" is no longer among the keys this accepts — it falls through to the
 * default with every other string it does not recognise.
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
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  // 23:59:59.999 — the same last instant `calendarDayRanges` gives every one of
  // its squares, and the same hygiene "Yesterday" already used against "Today":
  // one millisecond short of the next midnight, so no record lands in two
  // windows and none falls between them.
  const endOfToday = new Date(startOfToday + DAY_MS - 1);
  const k: RangeKey =
    key === "today" || key === "yesterday" || key === "30d" || key === "90d" || key === "all" ? key : "7d";

  if (k === "all") return { key: k, range: { from: new Date(0), to: endOfToday } };
  if (k === "yesterday") {
    return {
      key: k,
      range: { from: new Date(startOfToday - DAY_MS), to: new Date(startOfToday - 1) },
    };
  }
  // today | 7d | 30d | 90d — n whole days back from tonight, today included.
  return { key: k, range: { from: new Date(startOfToday - (WINDOW_DAYS[k] - 1) * DAY_MS), to: endOfToday } };
}
