import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { connections, events, flowResults, flows, flowVersions } from "@/db/schema";
import { materializeFlow } from "@/lib/flow/materialize";
import { dayKey } from "@/lib/metrics/calendar";
import { chartsFor, shapeOfTile } from "@/lib/board/charts";
import type { DB } from "@/db/types";

/**
 * A TREND FOR A METRIC THAT MEASURES ONE NUMBER.
 *
 * "If I can see it on the calendar view then I should be able to see it in the
 * charts." Exactly right, and the gap was FILING rather than data. A percentage
 * ends as `shape.kind === "scalar"` at the endpoint, so `buildTile` never wrote
 * it a `series`, and `chartsFor` offers line, area and bar only to a metric that
 * has one — while the per-day numbers already existed, computed out of the very
 * same `tileByRange` call the calendar reads and renders.
 *
 * The rule that makes it honest: every point is the metric RE-RUN over its own
 * window. A week's rate is that week's numerator over that week's denominator,
 * never seven daily rates averaged. Nothing on the tile could say when folding
 * is safe anyway — `facts.kind` is "count" for `sum`, `avg`, `median`, `min`
 * and `count_distinct` alike.
 */

let db: DB;
let close: () => Promise<void>;
const ORG = "org_trend";

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

/** A percentage: bookings over leads, which is a SCALAR at the endpoint. */
async function seedRate(perDay: Array<{ daysAgo: number; leads: number; booked: number }>) {
  const connId = randomUUID();
  await db
    .insert(connections)
    .values({ id: connId, orgId: ORG, source: "webhook", name: "Hook", status: "active", authType: "none" });

  // Booked over leads. The two app nodes feed the compare node directly — the
  // shape `tests/flow-range.test.ts` uses for the same metric.
  const graph = {
    nodes: [
      { id: "leads", type: "app", data: { config: { connectionId: connId, source: "webhook", eventType: "lead" } } },
      { id: "booked", type: "app", data: { config: { connectionId: connId, source: "webhook", eventType: "booked" } } },
      { id: "c", type: "calculate", data: { config: { mode: "compare", op: "percentage" } } },
    ],
    edges: [
      { id: "e1", source: "booked", target: "c", targetHandle: "a" },
      { id: "e2", source: "leads", target: "c", targetHandle: "b" },
    ],
    metrics: [{ nodeId: "c", enabled: true, name: "Acceptance Rate", viz: "number", format: "percent", precision: 0 }],
  };
  const [flow] = await db
    .insert(flows)
    .values({ orgId: ORG, name: "rate", draftGraph: graph, status: "published", publishedVersion: 1 })
    .returning();
  await db.insert(flowVersions).values({ flowId: flow.id, orgId: ORG, version: 1, graph });

  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const rows: (typeof events.$inferInsert)[] = [];
  for (const d of perDay) {
    const at = midnight - d.daysAgo * 86_400_000 + 3_600_000;
    for (let i = 0; i < d.leads; i++)
      rows.push({ eventId: `l${d.daysAgo}-${i}`, orgId: ORG, connectionId: connId, source: "webhook", eventType: "lead", subject: `l${d.daysAgo}-${i}`, occurredAt: new Date(at), properties: {} });
    for (let i = 0; i < d.booked; i++)
      rows.push({ eventId: `b${d.daysAgo}-${i}`, orgId: ORG, connectionId: connId, source: "webhook", eventType: "booked", subject: `b${d.daysAgo}-${i}`, occurredAt: new Date(at), properties: {} });
  }
  if (rows.length) await db.insert(events).values(rows);
  await materializeFlow(db, ORG, flow.id);
  const [row] = await db.select().from(flowResults).where(eq(flowResults.flowId, flow.id));
  return {
    now,
    tile: row.tile as {
      facts?: { kind?: string; shape?: string };
      byRange?: Record<string, { value?: number; series?: Array<{ bucket: string; value: number }>; unit?: string }>;
      byDay?: Record<string, { value: number }>;
    },
  };
}

describe("a percentage metric can be drawn as a trend", () => {
  it("gains a series over the dashboard's own ranges", async () => {
    const { tile } = await seedRate([
      { daysAgo: 1, leads: 4, booked: 2 },
      { daysAgo: 2, leads: 10, booked: 1 },
      { daysAgo: 3, leads: 2, booked: 2 },
    ]);
    expect(tile.facts?.shape).toBe("scalar");
    // Three answerable days, so three points. The other four had no leads at
    // all — a rate with no denominator is unknown, and an unknown day is absent
    // from the trend rather than plotted as zero.
    expect(tile.byRange?.["7d"]?.series?.length).toBe(3);
    expect(tile.byRange?.["7d"]?.unit).toBe("day");
    expect(tile.byRange?.["30d"]?.series?.length).toBe(3);
    expect(tile.byRange?.["30d"]?.unit).toBe("day");
  });

  it("makes line, area and bar offerable — the customer's actual ask", async () => {
    const { tile } = await seedRate([
      { daysAgo: 1, leads: 4, booked: 2 },
      { daysAgo: 2, leads: 10, booked: 1 },
    ]);
    const offered = chartsFor(shapeOfTile(tile));
    for (const chart of ["line", "area", "bar", "table"]) expect(offered).toContain(chart);
  });

  it("is the SAME number the calendar shows for that day", async () => {
    /**
     * The identity the whole design rests on, and the customer's sentence as an
     * assertion. Both come from one `tileByRange` call over the same window, so
     * a chart and a calendar square can never disagree about a day.
     */
    const { now, tile } = await seedRate([
      { daysAgo: 1, leads: 4, booked: 2 },
      { daysAgo: 2, leads: 10, booked: 1 },
    ]);
    const yesterday = dayKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 1));
    const point = tile.byRange?.["7d"]?.series?.find((p) => p.bucket === yesterday);
    expect(point?.value).toBe(tile.byDay?.[yesterday]?.value);
    expect(point?.value).toBe(50); // 2 booked of 4 leads
  });

  it("recomputes each bucket rather than folding finer ones", async () => {
    /**
     * 2/4 on one day and 1/10 on another. Averaged, that is 35%; recomputed
     * over the pair it is 3/14 = 21%. The week's own value must be the second,
     * and this is the assertion that proves nothing was summed.
     */
    const { tile } = await seedRate([
      { daysAgo: 1, leads: 4, booked: 2 },
      { daysAgo: 2, leads: 10, booked: 1 },
    ]);
    // 3 booked over 14 leads. The MEAN of the two daily rates (50% and 10%)
    // would be 30% — and that is the number this test exists to refuse.
    expect(tile.byRange?.["7d"]?.value).toBeCloseTo(21.43, 1);
    expect(tile.byRange?.["7d"]?.value).not.toBeCloseTo(30, 0);
  });

  it("keeps the headline the window's own number, never the bucket sum", async () => {
    // Routing a scalar through the series branch makes `headlineValue` fall
    // back to `series.reduce(+)`: thirty days at 40% would render 1,200%.
    const { tile } = await seedRate([
      { daysAgo: 1, leads: 4, booked: 2 },
      { daysAgo: 2, leads: 4, booked: 2 },
      { daysAgo: 3, leads: 4, booked: 2 },
    ]);
    expect(tile.byRange?.["7d"]?.value).toBe(50);
  });

  it("leaves a day it cannot answer OUT of the trend rather than calling it zero", async () => {
    /**
     * A day with no leads is a rate with no denominator — unknown, not 0%. The
     * middle day here has neither, so the trend must skip it entirely; the
     * renderer then draws a hole rather than a dive to the floor.
     */
    const { now, tile } = await seedRate([
      { daysAgo: 1, leads: 4, booked: 2 },
      { daysAgo: 3, leads: 4, booked: 1 },
    ]);
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const gap = dayKey(new Date(midnight - 2 * 86_400_000));
    const series = tile.byRange?.["7d"]?.series ?? [];
    expect(series).toHaveLength(2);
    expect(series.some((p) => p.bucket === gap)).toBe(false);
  });

  it("assembles nothing for All time, whose start is the epoch", async () => {
    const { tile } = await seedRate([
      { daysAgo: 1, leads: 4, booked: 2 },
      { daysAgo: 2, leads: 10, booked: 1 },
    ]);
    expect(tile.byRange?.all?.series).toBeUndefined();
  });

  it("mints no phantom pill — byRange still holds only the dashboard's keys", async () => {
    // The bucket keys are windows too; leaking one would grow a pill nobody
    // can press. Sabotage: hand `dashboardRanges` the day keys alone.
    const { tile } = await seedRate([
      { daysAgo: 1, leads: 4, booked: 2 },
      { daysAgo: 2, leads: 10, booked: 1 },
    ]);
    for (const key of Object.keys(tile.byRange ?? {})) {
      expect(key, `"${key}" is a bucket key, not a pill`).not.toMatch(/^\d{4}-(\d{2}|W\d{2})/);
    }
  });
});
