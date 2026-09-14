import { describe, it, expect } from "vitest";
import { rangeDays } from "@/lib/metrics/range";

/**
 * THE TWO DAYS THE PERIOD CONTROL'S CALENDAR SHOULD LIGHT UP.
 *
 * The picker already draws a band for a window the customer DREW — it takes a
 * `{ from, to }` and paints the edges and the wash between them. What it could
 * not draw was a PRESET: the call site built its value out of
 * `parseCustomRange`, which answers `null` for "7d", so opening the popover on
 * "Last 7 days" showed an empty grid and "Pick a start date." over a board that
 * was very clearly showing seven days of numbers.
 *
 * `rangeDays` is the missing half: whatever spelling the URL carries, which two
 * UTC days is the board standing on. Every date here is asserted as a day KEY
 * rather than through a formatter, for the same reason the rest of this suite
 * does — TZ=UTC hides a picker doing its maths in local time, and the server
 * would disagree across a midnight for anyone west of Greenwich.
 */
const NOW = new Date("2026-09-14T13:45:00.000Z");

describe("which days a range covers", () => {
  it("lights up the whole of a preset window, today included", () => {
    // Seven days ENDING today, so the 8th and the 14th are both in it — the
    // exact band the board's own "Tue, Sep 8 - Mon, Sep 14" subtitle claims.
    expect(rangeDays("7d", NOW)).toEqual({ from: "2026-09-08", to: "2026-09-14" });
    expect(rangeDays("30d", NOW)).toEqual({ from: "2026-08-16", to: "2026-09-14" });
    expect(rangeDays("90d", NOW)).toEqual({ from: "2026-06-17", to: "2026-09-14" });
  });

  it("reads a one-day preset as the same day twice", () => {
    // The picker's own grammar for a single day, so "Today" draws one filled
    // square rather than nothing.
    expect(rangeDays("today", NOW)).toEqual({ from: "2026-09-14", to: "2026-09-14" });
    expect(rangeDays("yesterday", NOW)).toEqual({ from: "2026-09-13", to: "2026-09-13" });
  });

  it("keeps answering for a window the customer drew", () => {
    expect(rangeDays("2026-08-03..2026-08-14", NOW)).toEqual({ from: "2026-08-03", to: "2026-08-14" });
  });

  it("answers a drawn window that happens to equal a preset with the same days", () => {
    /**
     * `resolveRange` canonicalises such a key BACK to the preset — that is what
     * keeps the board on a precomputed slot. The days must survive the round
     * trip anyway, or picking Sep 8-14 by hand would light up nothing.
     */
    expect(rangeDays("2026-09-08..2026-09-14", NOW)).toEqual({ from: "2026-09-08", to: "2026-09-14" });
  });

  it("refuses all-time, because no calendar can draw it", () => {
    // Its window opens at the epoch. A band from 1970 would paint every month
    // blue and say nothing about where you are.
    expect(rangeDays("all", NOW)).toBeNull();
  });

  it("shows the window the board is actually on when the key is junk", () => {
    /**
     * An unrecognised key resolves to 7d everywhere else — the board renders
     * seven days and `labelForRange` prints "Last 7 days". The calendar has to
     * agree with the numbers on screen, not with the URL's typo.
     */
    expect(rangeDays("nonsense", NOW)).toEqual({ from: "2026-09-08", to: "2026-09-14" });
    expect(rangeDays(undefined, NOW)).toEqual({ from: "2026-09-08", to: "2026-09-14" });
  });

  it("clamps a drawn window whose end is in the future", () => {
    // `parseCustomRange` already clamps; this pins that the picker is handed
    // the clamped end rather than a day it would render disabled.
    expect(rangeDays("2026-09-10..2026-09-30", NOW)).toEqual({ from: "2026-09-10", to: "2026-09-14" });
  });
});
