import { describe, it, expect } from "vitest";
import {
  CUSTOM_RANGE_MAX_DAYS,
  customRangeKey,
  labelForRange,
  parseCustomRange,
  resolveRange,
} from "@/lib/metrics/range";
import { deriveRangeSlot, withDerivedRange } from "@/lib/metrics/derive-range";

/**
 * A WINDOW THE CUSTOMER DREW — 7 Sep 2026.
 *
 * The period control was six presets; the owner asked for a calendar: "click on
 * one date and then to another date or same day". This covers the two pure
 * halves of that — the key's grammar, and the rule that decides whether a tile
 * can answer such a window out of what it already carries.
 *
 * The suite runs with TZ=UTC and no DOM, so a picker that did its day maths in
 * LOCAL time would pass every one of these and still disagree with the server
 * across a midnight. That is why every date here is asserted as a UTC instant
 * rather than through a formatter.
 */
const NOW = new Date("2026-09-07T13:45:00.000Z");
const DAY = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso}T00:00:00.000Z`);

describe("the custom range's grammar", () => {
  it("parses a pair into whole UTC days, last millisecond included", () => {
    const r = parseCustomRange("2026-08-03..2026-08-14", NOW)!;
    expect(r.key).toBe("2026-08-03..2026-08-14");
    expect(r.start).toBe(utc("2026-08-03"));
    // 23:59:59.999 — the same hygiene every preset and every calendar square
    // uses, so no record lands in two windows and none falls between them.
    expect(r.end).toBe(utc("2026-08-14") + DAY - 1);
  });

  it("reads the same day twice as one day", () => {
    const r = parseCustomRange("2026-08-14..2026-08-14", NOW)!;
    expect(r.end - r.start).toBe(DAY - 1);
  });

  it("normalises a pair dragged right to left", () => {
    // The same window, drawn backwards. Refusing it would be the interface
    // disagreeing with the gesture that produced it.
    expect(parseCustomRange("2026-08-14..2026-08-03", NOW)!.key).toBe("2026-08-03..2026-08-14");
    expect(customRangeKey("2026-08-14", "2026-08-03")).toBe("2026-08-03..2026-08-14");
  });

  it("refuses a date that does not exist", () => {
    /**
     * `Date.UTC(2026, 1, 30)` is happily 2 March. Without the round-trip a
     * hand-edited URL would silently answer for a window nobody asked about.
     */
    expect(parseCustomRange("2026-02-30..2026-03-01", NOW)).toBeNull();
    expect(parseCustomRange("2026-13-01..2026-13-02", NOW)).toBeNull();
    expect(parseCustomRange("not-a-range", NOW)).toBeNull();
    expect(parseCustomRange(undefined, NOW)).toBeNull();
    expect(parseCustomRange("2026-08-03-2026-08-14", NOW), "one dot is not the spelling").toBeNull();
  });

  it("clamps an end past today rather than reaching into the future", () => {
    // A tile is a RESULT; the forward surface is the Calendar. A window ending
    // past tonight would also have to carry `future` through the materializer's
    // crossing arithmetic or freeze `nextChangeAt` beyond reach.
    const r = parseCustomRange("2026-09-01..2027-01-01", NOW)!;
    expect(r.key).toBe("2026-09-01..2026-09-07");
    expect(r.end).toBe(utc("2026-09-07") + DAY - 1);
  });

  it("refuses a span wider than a trend can be assembled for", () => {
    // `bucketWindowsFor` returns [] past 1200 days, so a wider window would
    // render a figure with no chart and no unit — a half-answer.
    const wide = new Date(utc("2026-09-07") - (CUSTOM_RANGE_MAX_DAYS + 1) * DAY).toISOString().slice(0, 10);
    expect(parseCustomRange(`${wide}..2026-09-07`, NOW)).toBeNull();
  });
});

describe("resolveRange, widened", () => {
  it("still falls back to 7d for everything it does not recognise", () => {
    // The pins in tests/metrics.test.ts say the same; repeated here because the
    // custom branch runs FIRST and must not swallow them.
    for (const k of ["upcoming", "lastweek", "", undefined]) {
      expect(resolveRange(k, NOW).key).toBe("7d");
      expect(resolveRange(k, NOW).preset).toBe("7d");
    }
  });

  it("canonicalises a picked window that IS a preset back to the preset", () => {
    /**
     * Picking today twice spells `2026-09-07..2026-09-07`, which is "Today" —
     * and "Today" has a stored slot on every tile while the dated spelling has
     * none. Without this the calendar would compute a window the board already
     * knew, and two URLs would cache the same answer separately forever.
     */
    expect(resolveRange("2026-09-07..2026-09-07", NOW).key).toBe("today");
    expect(resolveRange("2026-09-01..2026-09-07", NOW).key).toBe("7d");
    expect(resolveRange("2026-09-06..2026-09-06", NOW).key).toBe("yesterday");
  });

  it("keeps a genuine custom window, and says it has no preset", () => {
    const r = resolveRange("2026-08-03..2026-08-14", NOW);
    expect(r.key).toBe("2026-08-03..2026-08-14");
    expect(r.preset).toBeNull();
    expect(r.range.from.getTime()).toBe(utc("2026-08-03"));
  });
});

describe("what the control says on its face", () => {
  it("names a preset with the preset's own words", () => {
    expect(labelForRange("today", NOW)).toBe("Today");
    expect(labelForRange("7d", NOW)).toBe("Last 7 days");
  });

  it("states one day, one year, and two years, in that order of verbosity", () => {
    expect(labelForRange("2026-08-14..2026-08-14", NOW)).toBe("Aug 14, 2026");
    expect(labelForRange("2026-08-03..2026-08-14", NOW)).toBe("Aug 3 – Aug 14, 2026");
    expect(labelForRange("2025-12-28..2026-01-04", NOW)).toBe("Dec 28, 2025 – Jan 4, 2026");
  });

  it("formats in UTC, not the reader's zone", () => {
    // `formatDate` in lib/format is LOCAL, and every window here is a UTC day —
    // west of Greenwich it would print the day before the one that was picked.
    expect(labelForRange("2026-01-01..2026-01-01", NOW)).toBe("Jan 1, 2026");
  });

  it("falls back with the key it could not read", () => {
    expect(labelForRange("nonsense", NOW)).toBe("Last 7 days");
  });
});

describe("which windows a tile can answer without a flow run", () => {
  const days = (from: string, n: number, value: number, records?: number) => {
    const out: Record<string, { value: number; records?: number }> = {};
    for (let i = 0; i < n; i++) {
      const k = new Date(utc(from) + i * DAY).toISOString().slice(0, 10);
      out[k] = records == null ? { value } : { value, records };
    }
    return out;
  };
  const KEY = "2026-08-03..2026-08-05";

  it("prefers a stored slot over any derivation", () => {
    const t = { facts: { kind: "count" }, byRange: { [KEY]: { value: 99 } }, byDay: days("2026-08-03", 3, 1) };
    expect(deriveRangeSlot(t, KEY, NOW)).toEqual({ how: "stored", slot: { value: 99 } });
  });

  it("sums a COUNT whose every day is present", () => {
    const t = { facts: { kind: "count" }, byDay: days("2026-08-03", 3, 4, 2) };
    const { how, slot } = deriveRangeSlot(t, KEY, NOW);
    expect(how).toBe("summed");
    expect(slot!.value).toBe(12);
    expect(slot!.records).toBe(6);
    // The day series comes free — the same numbers the sum was made of.
    expect(slot!.series).toEqual([
      { bucket: "2026-08-03", value: 4 },
      { bucket: "2026-08-04", value: 4 },
      { bucket: "2026-08-05", value: 4 },
    ]);
    // Built from windows rather than measured as one, which is what stops the
    // tile quoting a bucket-to-bucket delta off it.
    expect(slot!.assembled).toBe(true);
    expect(slot!.unit).toBe("day");
  });

  it("REFUSES a rate or a duration, however complete the days are", () => {
    /**
     * THE CORRECTNESS RULE, not an optimisation. Half of seven daily rates is
     * not the week's rate; the mean of seven means is not the week's mean. Only
     * an additive measure survives being folded, and the engine refuses the
     * other two everywhere else for the same reason.
     */
    for (const kind of ["ratio", "duration"]) {
      const t = { facts: { kind }, byDay: days("2026-08-03", 3, 4, 2) };
      expect(deriveRangeSlot(t, KEY, NOW).how, `${kind} must not be summed`).toBe("needs-compute");
    }
  });

  it("treats an absent `facts` as unknown rather than as a count", () => {
    // Every tile published before that stamp existed has none. Unknown is not
    // count, so it takes the slow path and gets a real answer.
    expect(deriveRangeSlot({ byDay: days("2026-08-03", 3, 4) }, KEY, NOW).how).toBe("needs-compute");
  });

  it("refuses a window with a hole in it, because a missing day is not a zero", () => {
    /**
     * `dayValues` DROPS a day it could not answer and KEEPS a genuine zero,
     * precisely so the two stay distinguishable. Summing over a hole reports a
     * number lower than the truth, confidently.
     */
    const byDay = days("2026-08-03", 3, 4);
    delete byDay["2026-08-04"];
    expect(deriveRangeSlot({ facts: { kind: "count" }, byDay }, KEY, NOW).how).toBe("needs-compute");
  });

  it("refuses a window that reaches past the stored day horizon", () => {
    // Two calendar months of days are stored; older than that there is nothing
    // to sum, which the missing-day rule catches for free.
    const t = { facts: { kind: "count" }, byDay: days("2026-08-03", 3, 4) };
    expect(deriveRangeSlot(t, "2025-01-01..2025-01-03", NOW).how).toBe("needs-compute");
  });

  it("keeps a single-day window a number, with no series to draw", () => {
    // One point is not a trend, and the tile refuses to draw one anyway.
    const t = { facts: { kind: "count" }, byDay: days("2026-08-03", 1, 7) };
    const { how, slot } = deriveRangeSlot(t, "2026-08-03..2026-08-03", NOW);
    expect(how).toBe("summed");
    expect(slot!.value).toBe(7);
    expect(slot!.series).toBeUndefined();
  });

  it("writes the answer into the row and drops the day map it was made from", () => {
    /**
     * Upstream of the components on purpose: three of them read `byRange`, and a
     * branch in one would leave the other two disagreeing about what the same
     * tile is worth. `byDay` goes because it is the heaviest thing in the jsonb
     * and the render already has its answer.
     */
    const row = { flowId: "f1", tile: { facts: { kind: "count" }, byDay: days("2026-08-03", 3, 5) } };
    const out = withDerivedRange(row, KEY, NOW) as typeof row & {
      tile: { byRange: Record<string, { value: number }>; byDay?: unknown };
    };
    expect(out.tile.byRange[KEY].value).toBe(15);
    expect(out.tile.byDay).toBeUndefined();
    expect(out.flowId, "the rest of the row is untouched").toBe("f1");
  });

  it("leaves a row it cannot answer exactly as it was", () => {
    // So the tile renders its own "not computed for this range" state rather
    // than a confident number nobody computed.
    const row = { tile: { facts: { kind: "ratio" }, byDay: days("2026-08-03", 3, 5) } };
    expect(withDerivedRange(row, KEY, NOW)).toBe(row);
  });
});
