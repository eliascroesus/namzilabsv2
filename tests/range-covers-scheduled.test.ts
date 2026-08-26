import { describe, it, expect } from "vitest";
import { resolveRange, RANGE_OPTIONS, MATERIALIZED_RANGES } from "@/lib/metrics/range";
import { calendarDayRanges } from "@/lib/metrics/calendar";

/**
 * THE TEST THAT WOULD HAVE CAUGHT IT.
 *
 * The dashboard read zero for metrics the calendar showed three of, on the same
 * day, from the same stored tile. Reported as "it shows 0 until the meetings
 * have happened".
 *
 * Both halves of a tile are computed by ONE `tileByRange` call over ONE run of
 * the flow — `byRange` for the pills, `byDay` for the calendar — so the numbers
 * could only ever disagree if the WINDOWS disagreed. They did:
 *
 *   calendar day  [dayStart, dayStart + 24h - 1]   the whole day
 *   dashboard     [dayStart, NOW]                  however much has elapsed
 *
 * That is invisible in a product whose records are dated when something
 * HAPPENED, and wrong in one that ingests Calendly meetings, which are dated
 * when they WILL happen. A 16:00 booking read at 13:00 sat inside the calendar
 * square and outside "Today", so the board reported 0 bookings on a day with
 * three of them and, because "Yesterday" is a COMPLETE day, drew "-100% vs
 * yesterday" underneath it.
 *
 * The old behaviour was deliberate and had its own test asserting the window
 * "runs to now, not to end of day" — the reasoning being that a period still in
 * progress holds fewer records than a finished one. That reasoning is sound for
 * events and backwards for bookings, and `engine.ts` had already conceded the
 * point in the one place it hurt most: "All time" is returned UNFILTERED
 * precisely because "Calendly meetings are dated when they will happen, so
 * filtering would drop every future booking out of the total". All time
 * counted the 16:00 meeting; Today did not; the calendar did. Three answers.
 *
 * So the windows are now the same windows. Every backward range is a whole
 * number of whole UTC days ending with today, which makes each pill exactly a
 * sum of calendar squares — the property this file pins, because it is the one
 * the reporter used to notice the bug in the first place.
 */

const DAY_MS = 86_400_000;
const startOfTodayUtc = () => {
  const n = new Date();
  return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
};

describe("a dashboard pill covers the same instants as the calendar squares under it", () => {
  it("'Today' is the calendar's square for today, to the millisecond", () => {
    const { range } = resolveRange("today");
    const today = startOfTodayUtc();
    const square = calendarDayRanges(new Date()).find((d) => d.start === today);

    expect(square, "calendarDayRanges must contain today").toBeDefined();
    // Sabotage: end the pill at `now` — the shipped bug. The square runs to
    // 23:59:59.999 and the pill stopped at the clock, so every record booked
    // for later today was in one and not the other.
    expect(range.from.getTime()).toBe(square!.start);
    expect(range.to.getTime()).toBe(square!.end);
  });

  it("counts a meeting booked for later today, which is the whole report", () => {
    const { range } = resolveRange("today");
    // 23:30 today. Unless this suite runs in the last half hour of a UTC day,
    // that is in the future; either way it is a booking made for today and it
    // belongs to today on every surface that shows today.
    const meeting = startOfTodayUtc() + 23.5 * 60 * 60 * 1000;
    const inside = (r: { from: Date; to: Date }, t: number) => t >= r.from.getTime() && t <= r.to.getTime();

    expect(inside(range, meeting), "a booking made for later today must count today").toBe(true);
    // ...and it cannot appear in Today while missing from the wider windows
    // that contain Today, which is what an end-at-the-clock 7d would have done.
    for (const key of ["7d", "30d", "90d"]) {
      expect(inside(resolveRange(key).range, meeting), `${key} must contain a booking it is wide enough to hold`).toBe(true);
    }
  });

  it("every backward pill is a whole number of whole days ending tonight", () => {
    const endOfToday = startOfTodayUtc() + DAY_MS - 1;
    // The lengths the labels promise: "Last 7 days" is seven days INCLUDING
    // today, so it starts six midnights ago. A rolling `now - 7*24h` end-dated
    // at midnight tonight would have spanned seven days plus however much of
    // today had elapsed — seven and a half days of data under a label that says
    // seven, which is why the start had to move when the end did.
    for (const [key, days] of [["today", 1], ["7d", 7], ["30d", 30], ["90d", 90]] as const) {
      const { range } = resolveRange(key);
      expect(range.to.getTime(), `${key} ends at the end of today`).toBe(endOfToday);
      expect(range.from.getTime(), `${key} spans ${days} whole days`).toBe(startOfTodayUtc() - (days - 1) * DAY_MS);
      expect(range.to.getTime() - range.from.getTime()).toBe(days * DAY_MS - 1);
    }
  });

  it("still never counts one instant in two pills, and never loses one between them", () => {
    const yesterday = resolveRange("yesterday").range;
    const today = resolveRange("today").range;
    // Midnight belongs to today and to today alone.
    expect(yesterday.to.getTime()).toBe(today.from.getTime() - 1);
    expect(yesterday.from.getTime()).toBe(startOfTodayUtc() - DAY_MS);
  });

  it("a wider pill contains a narrower one, so no metric can shrink as the window grows", () => {
    // The nesting that stops "Today: 3, Last 7 days: 1" — the shape the bug
    // produced whenever today's bookings were ahead of the clock.
    const nest = ["today", "7d", "30d", "90d"].map((k) => resolveRange(k).range);
    for (let i = 1; i < nest.length; i++) {
      expect(nest[i].from.getTime()).toBeLessThanOrEqual(nest[i - 1].from.getTime());
      expect(nest[i].to.getTime()).toBeGreaterThanOrEqual(nest[i - 1].to.getTime());
    }
  });

  it("the pills and the materialized slots are still the same six", () => {
    // Guards the fix's blast radius: this changed what a window MEANS, and must
    // not have changed which windows exist — a seventh key here is a slot in
    // every stored tile's jsonb forever. See MATERIALIZED_RANGES' own note.
    expect(RANGE_OPTIONS.map((r) => r.key).sort()).toEqual([...MATERIALIZED_RANGES].sort());
  });
});
