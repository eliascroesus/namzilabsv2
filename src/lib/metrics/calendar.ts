/**
 * THE CALENDAR'S DAY MATHS — one definition, used by the writer and the reader.
 *
 * The materializer stores a value per day on the tile (`byDay`); the calendar
 * page reads those days back and lays them out in a month grid. Both have to
 * agree about three things — which days exist, what a day is called, and where
 * a day sits in a week — and there is exactly one way for them to disagree:
 * two copies of this arithmetic. So there is one copy, here.
 *
 * DELIBERATELY PURE. No database, no `server-only`, no React: the client
 * component that draws the grid imports the same functions the server used to
 * write it. A "which day is this" helper that only runs on one side of the wire
 * is how a Sunday-first grid ends up rendering a Monday-first month.
 *
 * EVERY BOUNDARY IS UTC, because every date in this product is. `resolveRange`
 * says why at length: the whole pipeline dates records in UTC, and a calendar
 * that cut its days locally would put a booking in a different square depending
 * on who opened the page — and disagree with the same metric's dashboard tile,
 * which is the number this view exists to break down.
 */

/**
 * How far back the calendar can look: this month and the one before it.
 *
 * Not a soft default — it is the contract with the materializer, which only
 * stores days inside this window. Raising it here without raising it there
 * produces empty squares rather than an error, so the two are pinned together
 * by tests/calendar-window.test.ts.
 *
 * Two months is what the view is FOR: a day-by-day read of the current period
 * with the one before it to compare against. Anything deeper is a question for
 * the dashboard's ranges, and every extra month is another 30 windowing passes
 * on every materialize of every metric in the product.
 */
export const CALENDAR_MONTHS = 2;

const DAY_MS = 86_400_000;

/** A month, identified the way the tile keys its days: "2026-05". */
export type MonthKey = string;

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-05-04" — a UTC day, and the key a stored `byDay` entry is filed under. */
export function dayKey(d: Date | number): string {
  const t = typeof d === "number" ? new Date(d) : d;
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** "2026-05" — the month a day belongs to. */
export function monthKeyOf(d: Date | number): MonthKey {
  return dayKey(d).slice(0, 7);
}

/** The first instant of a month, in UTC. */
export function monthStart(key: MonthKey): Date {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}

/** How many days the month holds — day 0 of the next month is the last of this one. */
export function daysInMonth(key: MonthKey): number {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The month `back` months before the given one ("2026-01" → "2025-12"). */
export function monthBefore(key: MonthKey, back = 1): MonthKey {
  const [y, m] = key.split("-").map(Number);
  return monthKeyOf(new Date(Date.UTC(y, m - 1 - back, 1)));
}

/**
 * THE MONTHS THE CALENDAR MAY SHOW, oldest first — the window both halves
 * agree on. The last entry is always the current month, so the view opens on
 * it and "previous" can only step inside this list.
 */
export function calendarMonths(now: Date = new Date()): MonthKey[] {
  const current = monthKeyOf(now);
  const out: MonthKey[] = [];
  for (let i = CALENDAR_MONTHS - 1; i >= 1; i--) out.push(monthBefore(current, i));
  out.push(current);
  return out;
}

/** A month said the way a person says it: "May 2026". */
export function monthLabel(key: MonthKey): string {
  const d = monthStart(key);
  // Pinned locale, like every other formatter in the product (lib/format.ts):
  // the same month must not read "May" on one machine and "Mai" on another.
  return `${d.toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${d.getUTCFullYear()}`;
}

/**
 * The day ranges the materializer computes values for: every day of every month
 * the calendar can show.
 *
 * `future` is not decoration. `tileByRange` derives "now" from the largest end
 * among the ranges that actually END at now, and uses it to work out when the
 * stored numbers can next change by themselves. A day range covering the 31st
 * of a month we are three days into ends a week from now — hand that in as an
 * ordinary range and "now" jumps into the future, no crossing is ever tracked,
 * and the tile stores a `nextChangeAt` it can never reach: a number frozen for
 * good behind a green dot. Marking them tells that arithmetic to ignore their
 * ends, exactly as "Upcoming" does.
 *
 * They are still COMPUTED, because a future square is not empty by definition:
 * a Calendly meeting is dated when it will happen, so tomorrow's column can
 * hold a real, already-booked number. That is the whole reason the dashboard
 * grew an "Upcoming" pill.
 */
export function calendarDayRanges(
  now: Date = new Date(),
): Array<{ key: string; start: number; end: number; future?: boolean }> {
  const nowMs = now.getTime();
  const out: Array<{ key: string; start: number; end: number; future?: boolean }> = [];
  for (const month of calendarMonths(now)) {
    const first = monthStart(month);
    for (let i = 0; i < daysInMonth(month); i++) {
      const start = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate() + i);
      // Ends one millisecond before the next day begins — the same hygiene
      // "Yesterday" uses against "Today", so no record is counted in two squares.
      const end = start + DAY_MS - 1;
      out.push({ key: dayKey(start), start, end, ...(end > nowMs ? { future: true } : {}) });
    }
  }
  return out;
}

/** One square of the grid. `null` days are the leading/trailing blanks of a month. */
export type GridDay = { key: string; date: number; ms: number } | null;

/**
 * A month as SUNDAY-FIRST WEEKS, blanks included.
 *
 * The blanks are part of the answer, not padding to be trimmed: a calendar
 * whose 1st sits under "Sun" when it was a Friday is not a calendar. Rows are
 * emitted until the month is used up — five for most months, six when a long
 * month starts late — and never a trailing row of pure blanks.
 */
export function monthGrid(month: MonthKey): GridDay[][] {
  const first = monthStart(month);
  const lead = first.getUTCDay(); // 0 = Sunday
  const days = daysInMonth(month);
  const cells: GridDay[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= days; d++) {
    const ms = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), d);
    cells.push({ key: dayKey(ms), date: d, ms });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: GridDay[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Sunday-first, matching `monthGrid`. Short enough to survive a narrow column. */
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
