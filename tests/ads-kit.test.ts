import { describe, it, expect } from "vitest";
import { dailyReportWalk, dateInZone, metricNumber, reportRowId, reportShape, ymdUtc } from "@/connectors/kit/ads";
import type { CanonicalEvent } from "@/connectors/types";

const DAY = 86_400_000;

const row = (id: string, spend: number) => ({ id, spend });
const mapper =
  (shape: string) =>
  (r: { id: string; spend: number }): CanonicalEvent => ({
    eventId: reportRowId("t", ["stream", "acct", shape, "2026-09-01", r.id]),
    eventType: "t.row",
    occurredAt: new Date("2026-09-01T00:00:00Z"),
    value: r.spend,
  });

describe("the row identity is a function of WHAT a row is, never of what it is worth", () => {
  it("survives a restatement — the property the trailing re-read depends on", () => {
    /**
     * THE WHOLE DESIGN IN ONE ASSERTION. Meta revises the last 28 days, so the
     * same day is read again and again with different numbers. If the id moved
     * with the value, every sweep would INSERT rather than update and a month of
     * spend would multiply by the number of sweeps that saw it.
     */
    const first = mapper("shapeA")(row("camp1", 100));
    const restated = mapper("shapeA")(row("camp1", 137.42));
    expect(restated.eventId).toBe(first.eventId);
    expect(restated.value).not.toBe(first.value);
  });

  it("separates two differently-grouped reports over the same account and day", () => {
    // `date x campaign` and `date x country` are different facts. Colliding
    // them would have each overwrite the other with differently-grouped numbers.
    const byCampaign = reportShape(["date", "campaign"], ["spend"]);
    const byCountry = reportShape(["date", "country"], ["spend"]);
    expect(byCampaign).not.toBe(byCountry);
    expect(mapper(byCampaign)(row("x", 1)).eventId).not.toBe(mapper(byCountry)(row("x", 1)).eventId);
  });

  it("gives one report one shape however its dimensions are ordered", () => {
    // A flow that reorders its own dimension list requests the identical report;
    // two shapes for it would duplicate that flow's entire history.
    expect(reportShape(["date", "campaign"], ["spend", "clicks"])).toBe(
      reportShape(["campaign", "date"], ["clicks", "spend"]),
    );
  });

  it("cannot be confused by a separator that occurs inside a value", () => {
    /**
     * Campaign names contain colons, commas, spaces and emoji. Joined on any
     * printable character, `["a:b","c"]` and `["a","b:c"]` hash identically —
     * two real campaigns sharing one row, silently, for ever.
     */
    expect(reportRowId("t", ["a:b", "c"])).not.toBe(reportRowId("t", ["a", "b:c"]));
    expect(reportRowId("t", ["a,b", "c"])).not.toBe(reportRowId("t", ["a", "b,c"]));
    expect(reportRowId("t", ["Summer | 2026", "x"])).not.toBe(reportRowId("t", ["Summer", "| 2026", "x"]));
  });

  it("keeps an absent part in its place rather than closing the gap", () => {
    // ["a", null, "b"] is an account-level row with no entity; ["a", "b"] is a
    // different tuple entirely. Filtering the null merges them.
    expect(reportRowId("t", ["a", null, "b"])).not.toBe(reportRowId("t", ["a", "b"]));
  });

  it("treats an empty string as the real value it is", () => {
    // `(not set)`, an unattributed row, a campaign with no name — normalising
    // these away merges genuinely different rows.
    expect(reportRowId("t", ["a", ""])).not.toBe(reportRowId("t", ["a"]));
  });
});

describe("a partial read never retires anything", () => {
  const serve = (pages: Array<{ id: string; spend: number }[]>) => {
    let n = 0;
    return async () => {
      const rows = pages[n] ?? [];
      const next = n < pages.length - 1 ? String(++n) : null;
      return { rows, next };
    };
  };

  it("declares the window only when it reached the end of it", async () => {
    const res = await dailyReportWalk({
      trailingDays: 7,
      maxPages: 5,
      fetchPage: serve([[row("a", 1)], [row("b", 2)]]),
      map: mapper("s"),
    });
    expect(res.records).toHaveLength(2);
    expect(res.mirrorScope, "a complete read must license retirement").toBeDefined();
    expect(res.retireOutsideWindow).toBeDefined();
    expect(res.incomplete).toBeUndefined();
  });

  it("declares NOTHING when the page budget ran out first", async () => {
    /**
     * THE DATA-LOSS GUARD. A walk stopped by its budget read a PREFIX of the
     * window. Declaring the whole window off a prefix tombstones every row past
     * the last page reached — on a sweep that reports no error, and worst on
     * the biggest accounts, whose reports are the ones that run out of pages.
     */
    const res = await dailyReportWalk({
      trailingDays: 7,
      maxPages: 1,
      fetchPage: serve([[row("a", 1)], [row("b", 2)], [row("c", 3)]]),
      map: mapper("s"),
    });
    expect(res.records).toHaveLength(1);
    expect(res.incomplete).toBe(true);
    expect(res.mirrorScope, "a prefix must not license retiring the window").toBeUndefined();
    expect(res.retireOutsideWindow).toBeUndefined();
  });

  it("stops on the wall-clock deadline without declaring the window", async () => {
    let clock = 1_000;
    const res = await dailyReportWalk({
      trailingDays: 7,
      maxPages: 9,
      budget: { maxCalls: 9, deadlineMs: 1_500, nowMs: () => (clock += 400) },
      fetchPage: serve([[row("a", 1)], [row("b", 2)], [row("c", 3)]]),
      map: mapper("s"),
    });
    expect(res.incomplete).toBe(true);
    expect(res.retireOutsideWindow).toBeUndefined();
  });

  it("spends one value on both the request bound and the retirement", async () => {
    /**
     * `types.ts` requires this of anything honouring `windowFloor`: split the
     * two and a deliberately deepened import is retired by the very next sweep,
     * because the declared window still describes the default.
     */
    const seen: Array<{ from: Date; to: Date }> = [];
    const floor = new Date(Date.now() - 90 * DAY);
    const res = await dailyReportWalk({
      trailingDays: 7,
      windowFloor: floor,
      maxPages: 2,
      fetchPage: async ({ from, to }) => {
        seen.push({ from, to });
        return { rows: [row("a", 1)], next: null };
      },
      map: mapper("s"),
    });
    expect(seen[0].from.getTime()).toBe(floor.getTime());
    expect(res.retireOutsideWindow!.from.getTime()).toBe(floor.getTime());
  });

  it("ignores a windowFloor shallower than the provider's restatement period", async () => {
    // A 1-day floor against Meta's 28-day revision window would freeze rows at
    // values Meta has since changed. The DEEPER of the two always wins.
    const seen: Date[] = [];
    await dailyReportWalk({
      trailingDays: 28,
      windowFloor: new Date(Date.now() - 1 * DAY),
      maxPages: 1,
      fetchPage: async ({ from }) => {
        seen.push(from);
        return { rows: [], next: null };
      },
      map: mapper("s"),
    });
    expect(Date.now() - seen[0].getTime()).toBeGreaterThan(27 * DAY);
  });

  it("keeps one entry per row id when a provider restates one inside a walk", async () => {
    const res = await dailyReportWalk({
      trailingDays: 7,
      maxPages: 3,
      fetchPage: serve([[row("a", 1)], [row("a", 9)]]),
      map: mapper("s"),
    });
    expect(res.records).toHaveLength(1);
    expect(res.records[0].value, "the last reading wins, not the first").toBe(9);
  });
});

describe("a report date is the AD ACCOUNT's day, not UTC's", () => {
  it("resolves a negative offset to the correct instant", () => {
    // 1 Sep 2026 in Los Angeles began at 07:00 UTC. Parsed as UTC, every row on
    // every account west of London lands on the previous day, permanently.
    expect(dateInZone("2026-09-01", "America/Los_Angeles")!.toISOString()).toBe("2026-09-01T07:00:00.000Z");
  });

  it("resolves a positive offset, and moves with daylight saving", () => {
    // Stockholm is +02:00 in September and +01:00 in January. A fixed offset
    // drifts an hour every spring; this is why the zone is asked, not assumed.
    expect(dateInZone("2026-09-01", "Europe/Stockholm")!.toISOString()).toBe("2026-08-31T22:00:00.000Z");
    expect(dateInZone("2026-01-01", "Europe/Stockholm")!.toISOString()).toBe("2025-12-31T23:00:00.000Z");
  });

  it("falls back to UTC rather than losing the row over an unknown zone", () => {
    expect(dateInZone("2026-09-01", "Not/AZone")!.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("refuses a malformed date instead of inventing one", () => {
    expect(dateInZone("01/09/2026", "UTC")).toBeNull();
    expect(dateInZone("", "UTC")).toBeNull();
  });

  it("formats a window bound the way every one of these APIs wants it", () => {
    expect(ymdUtc(new Date("2026-09-21T23:30:00Z"))).toBe("2026-09-21");
  });
});

describe("a metric that is absent is not a metric that is zero", () => {
  it("reads the strings these APIs return for numbers", () => {
    expect(metricNumber("12.5")).toBe(12.5);
    expect(metricNumber(7)).toBe(7);
  });

  it("answers null for absent, blank and unparseable — never 0", () => {
    // A day with no data and a day with zero spend are different facts, and
    // only one of them should average as a zero.
    expect(metricNumber(undefined)).toBeNull();
    expect(metricNumber("")).toBeNull();
    expect(metricNumber("   ")).toBeNull();
    expect(metricNumber("n/a")).toBeNull();
    expect(metricNumber(null)).toBeNull();
  });
});
