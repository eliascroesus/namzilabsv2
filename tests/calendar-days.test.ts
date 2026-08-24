import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb } from "./helpers/testdb";
import { connections, events } from "@/db/schema";
import { runFlow, tileByRange, type TilePresentation } from "@/lib/flow/engine";
import { parseGraph } from "@/lib/flow/types";
import {
  CALENDAR_MONTHS,
  calendarDayRanges,
  calendarMonths,
  dayKey,
  daysInMonth,
  monthBefore,
  monthGrid,
  monthLabel,
} from "@/lib/metrics/calendar";
import { MATERIALIZED_RANGES } from "@/lib/metrics/range";
import { materializeFlow } from "@/lib/flow/materialize";
import { flowResults, flows, flowVersions } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { DB } from "@/db/types";

/**
 * THE CALENDAR'S DAYS.
 *
 * The view is a plain read of numbers the materializer already stored, which
 * makes it fast and makes it fragile in exactly one place: the WRITER and the
 * READER have to agree about which days exist and what they are called. Two
 * copies of that arithmetic is the only way this feature breaks silently — a
 * square that renders empty because the value was filed under a key nobody
 * looks up is indistinguishable from a day with no data.
 *
 * So these tests pin the contract from both ends: the pure day maths, and one
 * end-to-end run proving a day square gets the number that day's records
 * actually produce.
 */

/**
 * A FIXED CLOCK. Every one of these assertions is about day boundaries, and a
 * fixture pinned to the real wall clock is a test that passes all afternoon and
 * fails at 00:46 — the exact trap tests/flow-range.test.ts documents. Mid-month
 * and mid-afternoon UTC, so "today" has both a past and a future inside its own
 * month.
 */
const NOW = new Date("2026-08-18T14:00:00Z");
const DAY = 86_400_000;

describe("the two-month window", () => {
  it("ends on the current month and reaches back CALENDAR_MONTHS - 1", () => {
    const months = calendarMonths(NOW);
    expect(months).toHaveLength(CALENDAR_MONTHS);
    expect(months[months.length - 1]).toBe("2026-08");
    expect(months[0]).toBe("2026-07");
  });

  it("steps across a year boundary rather than to month zero", () => {
    // The off-by-one that a naive `month - 1` produces is invisible for eleven
    // months of the year and then turns January's "previous" into month 0.
    expect(monthBefore("2026-01")).toBe("2025-12");
    expect(calendarMonths(new Date("2026-01-04T00:00:00Z"))).toEqual(["2025-12", "2026-01"]);
  });

  it("counts February the way the calendar does, leap year included", () => {
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);
    expect(daysInMonth("2026-08")).toBe(31);
  });

  it("names a month in a pinned locale", () => {
    // Same rule as every formatter in lib/format.ts: the label must not read
    // "August" on one machine and "août" on another.
    expect(monthLabel("2026-08")).toBe("August 2026");
  });
});

describe("the day ranges handed to the materializer", () => {
  const ranges = calendarDayRanges(NOW);

  it("covers every day of both months, once", () => {
    expect(ranges).toHaveLength(daysInMonth("2026-07") + daysInMonth("2026-08"));
    expect(new Set(ranges.map((r) => r.key)).size).toBe(ranges.length);
    expect(ranges[0].key).toBe("2026-07-01");
    expect(ranges[ranges.length - 1].key).toBe("2026-08-31");
  });

  it("cuts each day at UTC midnight and stops one millisecond short of the next", () => {
    const d = ranges.find((r) => r.key === "2026-08-18")!;
    expect(new Date(d.start).toISOString()).toBe("2026-08-18T00:00:00.000Z");
    expect(new Date(d.end).toISOString()).toBe("2026-08-18T23:59:59.999Z");
    // No overlap with the next day, or a record at midnight lands in two squares.
    const next = ranges.find((r) => r.key === "2026-08-19")!;
    expect(next.start).toBe(d.end + 1);
  });

  /**
   * THE FLAG THAT KEEPS TILES FROM FREEZING.
   *
   * `tileByRange` takes "now" to be the largest end among the ranges that are
   * NOT marked future, and stores the next moment the numbers can change by
   * themselves. A day range covering the 31st of a month we are on the 18th of
   * ends thirteen days out — unflagged, it becomes "now", no crossing is ever
   * in the future, and `nextChangeAt` is written far enough ahead that the tile
   * never expires again. Behind a green dot.
   */
  it("marks days that end in the future, and only those", () => {
    const future = ranges.filter((r) => r.future).map((r) => r.key);
    expect(future[0]).toBe("2026-08-18"); // today ends tonight, which is still ahead
    expect(future).toContain("2026-08-31");
    expect(future).not.toContain("2026-08-17");
    expect(future).not.toContain("2026-07-31");
  });

  it("never collides with a dashboard range key", () => {
    // The materializer asks for both in ONE call and splits the answer by key.
    // A day called "today" would be filed as a pill and lost from the calendar.
    const days = new Set(ranges.map((r) => r.key));
    for (const key of MATERIALIZED_RANGES) expect(days.has(key)).toBe(false);
  });
});

describe("the month grid", () => {
  it("puts the 1st under the weekday it actually fell on", () => {
    // 1 August 2026 is a Saturday: six blanks, then the 1st in the last column.
    const weeks = monthGrid("2026-08");
    expect(weeks[0].slice(0, 6).every((d) => d === null)).toBe(true);
    expect(weeks[0][6]).toMatchObject({ date: 1, key: "2026-08-01" });
  });

  it("emits whole weeks and no trailing row of pure blanks", () => {
    for (const month of ["2026-01", "2026-02", "2026-08", "2028-02"]) {
      const weeks = monthGrid(month);
      for (const w of weeks) expect(w).toHaveLength(7);
      expect(weeks[weeks.length - 1].some((d) => d !== null)).toBe(true);
      expect(weeks.flat().filter((d) => d !== null)).toHaveLength(daysInMonth(month));
    }
  });

  it("agrees with dayKey about every square it draws", () => {
    // The grid's keys ARE the lookup into the stored day map. If these two ever
    // spell a day differently, every square renders empty and nothing throws.
    for (const day of monthGrid("2026-08").flat()) {
      if (day) expect(day.key).toBe(dayKey(day.ms));
    }
  });
});

describe("a day square carries that day's own number", () => {
  let db: DB;
  let close: () => Promise<void>;
  const ORG = "org_calendar";
  const CONN = randomUUID();

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    await db.insert(connections).values({ id: CONN, orgId: ORG, source: "close", name: "Close", status: "active", authType: "apiKey" });
  });
  afterEach(async () => {
    await close();
  });

  const at = (iso: string) => Date.parse(iso);
  async function ev(occurredAt: number, key: string) {
    await db.insert(events).values({
      eventId: `cal:${randomUUID()}`,
      orgId: ORG,
      connectionId: CONN,
      source: "close",
      eventType: "lead_created",
      subject: key,
      occurredAt: new Date(occurredAt),
      properties: { lead_id: key },
    });
  }

  const SPEC: TilePresentation = { name: "Leads", viz: "number", format: "number", precision: 0, target: null };
  const GRAPH = {
    nodes: [
      { id: "leads", type: "app", data: { config: { connectionId: CONN, source: "close", eventType: "lead_created" } } },
      { id: "count", type: "calculate", data: { config: { mode: "number", aggregation: "count" } } },
    ],
    edges: [{ id: "leads->count", source: "leads", target: "count" }],
  };

  it("counts each day separately, and says how many records it counted", async () => {
    await ev(at("2026-08-17T09:00:00Z"), "A");
    await ev(at("2026-08-17T21:30:00Z"), "B");
    await ev(at("2026-08-18T02:00:00Z"), "C");
    // Last month, to prove the window reaches back a whole month rather than
    // however many days happen to be in view.
    await ev(at("2026-07-02T12:00:00Z"), "D");

    const g = parseGraph(GRAPH);
    const run = await runFlow({ db, orgId: ORG }, g);
    const { byRange } = tileByRange(g, run.nodes, "count", SPEC, [
      // The dashboard's own "today", so `now` is the fixed clock rather than
      // the largest day end — exactly the pairing the materializer passes.
      { key: "today", start: at("2026-08-18T00:00:00Z"), end: NOW.getTime() },
      ...calendarDayRanges(NOW),
    ]);

    expect(byRange["2026-08-17"].value).toBe(2);
    expect(byRange["2026-08-17"].records).toBe(2);
    expect(byRange["2026-08-18"].value).toBe(1);
    expect(byRange["2026-07-02"].value).toBe(1);
    // A day nothing happened on is a real answer — zero, not silence. The
    // calendar draws the two differently and the difference is the point.
    expect(byRange["2026-08-16"].value).toBe(0);
    expect(byRange["2026-07-01"].value).toBe(0);
  });

  /**
   * A record dated 23:59:59.999 belongs to that day and a record dated the next
   * midnight does not. Both squares are on screen at once, so an off-by-one
   * millisecond here is a number visibly in the wrong box.
   */
  it("files a record on the right side of midnight", async () => {
    await ev(at("2026-08-16T23:59:59.999Z"), "late");
    await ev(at("2026-08-17T00:00:00.000Z"), "early");

    const g = parseGraph(GRAPH);
    const run = await runFlow({ db, orgId: ORG }, g);
    const { byRange } = tileByRange(g, run.nodes, "count", SPEC, [
      { key: "today", start: at("2026-08-18T00:00:00Z"), end: NOW.getTime() },
      ...calendarDayRanges(NOW),
    ]);

    expect(byRange["2026-08-16"].value).toBe(1);
    expect(byRange["2026-08-17"].value).toBe(1);
  });

  /**
   * THE REASON THE FUTURE FLAG EXISTS, proven rather than asserted about.
   *
   * With the month's remaining days handed in unflagged, `now` becomes the end
   * of the 31st and every crossing computed from the records lands in the past
   * — so the tile stores a next-change moment nearly two weeks out and stops
   * refreshing until then.
   */
  it("keeps the next-change moment inside today when the month runs on past it", async () => {
    await ev(at("2026-08-17T09:00:00Z"), "A");

    const g = parseGraph(GRAPH);
    const run = await runFlow({ db, orgId: ORG }, g);
    const { nextChangeMs } = tileByRange(g, run.nodes, "count", SPEC, [
      { key: "today", start: at("2026-08-18T00:00:00Z"), end: NOW.getTime() },
      ...calendarDayRanges(NOW),
    ]);

    // The next UTC midnight after the fixed clock, and nothing later.
    expect(nextChangeMs).toBe(at("2026-08-19T00:00:00Z"));
    expect(nextChangeMs - NOW.getTime()).toBeLessThanOrEqual(DAY);
  });
});

/**
 * THE STORED HALF — what the calendar page actually reads.
 *
 * `tileByRange` answering a day range is one thing; the number surviving into
 * `flow_results.tile.byDay`, under keys the grid looks up, is the thing the
 * view depends on. The split between the dashboard's pills and the calendar's
 * days happens in the materializer, and nothing else checks it: put a day key
 * in `byRange` and the dashboard grows sixty phantom pills; leave `byDay` out
 * and every square is empty with no error anywhere.
 */
describe("materializeFlow stores the days on the tile", () => {
  let db: DB;
  let close: () => Promise<void>;
  const ORG = "org_calendar_store";

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => {
    await close();
  });

  it("files days under byDay and keeps byRange to the dashboard's own keys", async () => {
    const connId = randomUUID();
    await db.insert(connections).values({ id: connId, orgId: ORG, source: "webhook", name: "Hook", status: "active", authType: "none" });
    const graph = {
      nodes: [
        { id: "a", type: "app", data: { config: { connectionId: connId, source: "webhook" } } },
        { id: "c", type: "formula", data: { config: { op: "count" } } },
      ],
      edges: [{ id: "e", source: "a", target: "c" }],
      metrics: [{ nodeId: "c", enabled: true, name: "Events", viz: "number", format: "number", precision: 0 }],
    };
    const [flow] = await db
      .insert(flows)
      .values({ orgId: ORG, name: "days", draftGraph: graph, status: "published", publishedVersion: 1 })
      .returning();
    await db.insert(flowVersions).values({ flowId: flow.id, orgId: ORG, version: 1, graph });

    // Two events yesterday, one today — real days, because the materializer
    // reads the wall clock and this assertion is about the shape it writes.
    const now = new Date();
    const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    await db.insert(events).values([
      { eventId: "d1", orgId: ORG, connectionId: connId, source: "webhook", eventType: "e", subject: "d1", occurredAt: new Date(startOfToday - 3 * 3_600_000), properties: {} },
      { eventId: "d2", orgId: ORG, connectionId: connId, source: "webhook", eventType: "e", subject: "d2", occurredAt: new Date(startOfToday - 2 * 3_600_000), properties: {} },
      { eventId: "d3", orgId: ORG, connectionId: connId, source: "webhook", eventType: "e", subject: "d3", occurredAt: new Date(startOfToday + 60_000), properties: {} },
    ]);

    await materializeFlow(db, ORG, flow.id);
    const [row] = await db.select().from(flowResults).where(eq(flowResults.flowId, flow.id));
    const tile = row.tile as {
      byRange?: Record<string, unknown>;
      byDay?: Record<string, { value: number; records?: number }>;
    };

    const today = dayKey(now);
    const yesterday = dayKey(new Date(startOfToday - 1));
    expect(tile.byDay?.[today]?.value).toBe(1);
    expect(tile.byDay?.[yesterday]?.value).toBe(2);

    // The pills are untouched — the dashboard reads these and knows nothing
    // about days.
    expect(Object.keys(tile.byRange ?? {}).sort()).toEqual([...MATERIALIZED_RANGES].sort());
    // …and every calendar day is present, so a square can tell "zero happened"
    // from "this metric cannot answer for that day".
    expect(Object.keys(tile.byDay ?? {})).toHaveLength(calendarDayRanges(now).length);
  });
});
