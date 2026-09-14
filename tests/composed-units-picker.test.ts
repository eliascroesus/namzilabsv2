import { describe, expect, it } from "vitest";
import { COMPOSED_CHARTS, composedChartsBarred, countsThings } from "@/lib/board/tile-config";
import { unitsKey } from "@/lib/board/compose";
import { partsOnOffer } from "@/lib/board/picker";
import type { CustomTileOption } from "@/lib/board/types";

/**
 * WHAT THE PICKER MAY OFFER A CHART BUILT FROM SEVERAL METRICS.
 *
 * Two rules used to be enforced in the wrong places, and both showed up as a
 * list that offered something the next press refused.
 *
 * ONE: "counts things" is a funnel's rule and a pie's rule, never a ranked
 * chart's — `composeRanked` has skipped it since the day it was written, in as
 * many words, because nothing in a ranked chart is divided by anything. The
 * PICKER did not know that and subtracted every composed chart from any metric
 * whose facts said it was not a tally, so a percentage or a currency metric was
 * offered no ranked chart at all.
 *
 * TWO: bars share an axis, so `composeRanked` insists on one unit and refuses a
 * chart mixing dollars with counts. The parts list did not filter on units, so
 * the way to discover that rule was to hit it.
 */

const option = (over: Partial<CustomTileOption> = {}): CustomTileOption => ({
  key: "flow:f1:n1",
  title: "Total Leads",
  charts: ["number", "ranked", "pie", "pipeline"],
  units: unitsKey({ format: "number" }),
  ...over,
});

describe("which composed charts a metric's facts rule out", () => {
  it("keeps ranked bars for a metric that is not a tally", () => {
    /**
     * A rate, a duration, an average. `composeRanked` takes all three — "Speed
     * to Lead" per rep is exactly the chart somebody wants — so hiding the
     * chart was the picker being stricter than the thing it was picking for.
     */
    expect(composedChartsBarred({ countable: false })).not.toContain("ranked");
  });

  it("still rules out the two charts that do arithmetic across their members", () => {
    // A conversion divides one member by the next; a share divides one by the
    // sum. A percentage in either is nonsense and stays refused.
    expect(composedChartsBarred({ countable: false })).toEqual(expect.arrayContaining(["pie", "pipeline"]));
  });

  it("rules out nothing for a tally, or for a tile not yet restamped", () => {
    // NEGATIVE, so absence still draws — a tile that has never been recomputed
    // keeps every chart it had.
    expect(composedChartsBarred({ countable: true })).toEqual([]);
    expect(composedChartsBarred({})).toEqual([]);
    expect(composedChartsBarred(undefined)).toEqual([]);
  });

  it("agrees with the rule compose.ts applies, chart for chart", () => {
    // The one assertion that would catch the two drifting apart again: every
    // composing chart either counts things or does not, and `composedChartsBarred`
    // bars exactly the ones that do.
    expect(COMPOSED_CHARTS.filter(countsThings).sort()).toEqual(["pie", "pipeline"]);
    expect(countsThings("ranked")).toBe(false);
  });
});

describe("what the parts list offers", () => {
  const leads = option({ key: "a", title: "Leads", units: unitsKey({ format: "number" }) });
  const booked = option({ key: "b", title: "Booked", units: unitsKey({ format: "number" }) });
  const bookingRate = option({ key: "c", title: "Booking rate", units: unitsKey({ format: "percent" }) });
  const closeRate = option({ key: "d", title: "Close Rate", units: unitsKey({ format: "percent" }) });
  const revenueUsd = option({ key: "e", title: "Revenue", units: unitsKey({ format: "currency", currency: "USD" }) });
  const revenueEur = option({ key: "f", title: "Revenue EU", units: unitsKey({ format: "currency", currency: "EUR" }) });
  const all = [leads, booked, bookingRate, closeRate, revenueUsd, revenueEur];

  it("offers only metrics measured the same way as the one already there", () => {
    // The whole ask: pick a percentage, and adding more lists percentages.
    const out = partsOnOffer(all, { need: "ranked", exclude: ["c"], units: bookingRate.units });
    expect(out.map((o) => o.title)).toEqual(["Close Rate"]);
  });

  it("does not mix currencies, which is the same rule one level down", () => {
    /**
     * `unitsAgree` keys on the currency too, so $12,400 beside €12,400 is
     * refused at render. Two bars labelled "Revenue" drawn to one axis is
     * exactly the confidently-wrong drawing that rule exists to prevent.
     */
    const out = partsOnOffer(all, { need: "ranked", exclude: ["e"], units: revenueUsd.units });
    expect(out.map((o) => o.title)).toEqual([]);
  });

  it("offers counts to a count, and no percentages among them", () => {
    const out = partsOnOffer(all, { need: "ranked", exclude: ["a"], units: leads.units });
    expect(out.map((o) => o.title)).toEqual(["Booked"]);
  });

  it("drops what is already spoken for", () => {
    // A metric cannot be its own bar twice.
    const out = partsOnOffer(all, { need: "ranked", exclude: ["a", "b"], units: leads.units });
    expect(out).toEqual([]);
  });

  it("keeps the chart's own legality rule as well as the units one", () => {
    // A percentage is drawable as ranked but not as a pipeline, and asking for
    // a pipeline must not be rescued by the units matching.
    const notRanked = option({ key: "g", title: "Odd one", charts: ["number"], units: unitsKey({ format: "percent" }) });
    const out = partsOnOffer([...all, notRanked], { need: "ranked", exclude: ["c"], units: bookingRate.units });
    expect(out.map((o) => o.title)).toEqual(["Close Rate"]);
  });

  it("filters on nothing but the chart when no units are named", () => {
    // Every caller that predates composition passes no units and must keep the
    // behaviour it had.
    const out = partsOnOffer(all, { need: "ranked" });
    expect(out).toHaveLength(6);
  });
});

describe("how two metrics are judged to be measured alike", () => {
  it("separates the formats a bar chart must not mix", () => {
    expect(unitsKey({ format: "percent" })).not.toBe(unitsKey({ format: "number" }));
    expect(unitsKey({ format: "currency", currency: "USD" })).not.toBe(
      unitsKey({ format: "currency", currency: "EUR" }),
    );
    expect(unitsKey({ format: "duration", unit: "minutes" })).not.toBe(unitsKey({ format: "duration", unit: "hours" }));
  });

  it("treats an unstated format as a plain number, the way the renderer does", () => {
    // `custom-tile.tsx` falls back to "number", so the picker must agree or a
    // legacy tile would be barred from a chart it draws correctly.
    expect(unitsKey({})).toBe(unitsKey({ format: "number" }));
  });
});
