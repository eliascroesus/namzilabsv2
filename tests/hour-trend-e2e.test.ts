import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { connections, events, flowResults, flows, flowVersions } from "@/db/schema";
import { materializeFlow } from "@/lib/flow/materialize";
import type { DB } from "@/db/types";

/**
 * THE HOURLY TREND, END TO END — real rows, the real materializer, the real
 * stored tile. tests/hour-buckets.test.ts pins the arithmetic; this pins that
 * the arithmetic actually reaches the jsonb a dashboard reads.
 *
 * It seeds YESTERDAY rather than today on purpose: yesterday is wholly in the
 * past, so all 24 of its hours have begun and the assertion does not depend on
 * what time the suite runs. Today's truncation gets its own case below, which
 * derives its expectation from the same clock the materializer used.
 */
let db: DB;
let close: () => Promise<void>;
const ORG = "org_hour";

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

/** A plain count of events, seeded at named UTC hours. */
async function seedHours(at: Array<{ daysAgo: number; hour: number; n: number }>) {
  const connId = randomUUID();
  await db
    .insert(connections)
    .values({ id: connId, orgId: ORG, source: "webhook", name: "Hook", status: "active", authType: "none" });

  const graph = {
    nodes: [{ id: "calls", type: "app", data: { config: { connectionId: connId, source: "webhook", eventType: "call" } } }],
    edges: [],
    metrics: [{ nodeId: "calls", enabled: true, name: "Calls", viz: "number", format: "number", precision: 0 }],
  };
  const [flow] = await db
    .insert(flows)
    .values({ orgId: ORG, name: "calls", draftGraph: graph, status: "published", publishedVersion: 1 })
    .returning();
  await db.insert(flowVersions).values({ flowId: flow.id, orgId: ORG, version: 1, graph });

  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const rows: (typeof events.$inferInsert)[] = [];
  for (const a of at) {
    const ms = midnight - a.daysAgo * 86_400_000 + a.hour * 3_600_000 + 60_000;
    for (let i = 0; i < a.n; i++)
      rows.push({
        eventId: `c${a.daysAgo}-${a.hour}-${i}`,
        orgId: ORG,
        connectionId: connId,
        source: "webhook",
        eventType: "call",
        subject: `c${a.daysAgo}-${a.hour}-${i}`,
        occurredAt: new Date(ms),
        properties: {},
      });
  }
  if (rows.length) await db.insert(events).values(rows);
  await materializeFlow(db, ORG, flow.id);
  const [row] = await db.select().from(flowResults).where(eq(flowResults.flowId, flow.id));
  return {
    now,
    midnight,
    tile: row.tile as {
      byRange?: Record<
        string,
        {
          value?: number;
          series?: Array<{ bucket: string; value: number }>;
          compare?: Array<{ bucket: string; value: number }>;
          unit?: string;
        }
      >;
    },
  };
}

const isoHour = (ms: number) => new Date(ms).toISOString().slice(0, 13);

describe("Yesterday, which used to draw nothing at all", () => {
  it("comes back bucketed by hour, one point per hour of the day", async () => {
    const { tile, midnight } = await seedHours([
      { daysAgo: 1, hour: 3, n: 2 },
      { daysAgo: 1, hour: 9, n: 5 },
      { daysAgo: 1, hour: 21, n: 1 },
    ]);
    const slot = tile.byRange?.["yesterday"];
    expect(slot?.unit).toBe("hour");
    // The whole point: two or more points, so `withTrends` stores it and the
    // tile draws instead of saying "only one point in this period".
    expect(slot?.series?.length).toBe(24);

    const y = midnight - 86_400_000;
    const at = (h: number) => slot?.series?.find((p) => p.bucket === isoHour(y + h * 3_600_000))?.value;
    expect(at(3)).toBe(2);
    expect(at(9)).toBe(5);
    expect(at(21)).toBe(1);
    // A quiet hour is a measured zero, not a hole: nothing happened at 04:00.
    expect(at(4)).toBe(0);
  });

  it("keys the buckets so they sort into clock order", async () => {
    const { tile } = await seedHours([{ daysAgo: 1, hour: 9, n: 1 }]);
    const keys = tile.byRange?.["yesterday"]?.series?.map((p) => p.bucket) ?? [];
    expect(keys[0]).toMatch(/^\d{4}-\d{2}-\d{2}T00$/);
    expect(keys.at(-1)).toMatch(/^\d{4}-\d{2}-\d{2}T23$/);
    expect([...keys].sort()).toEqual(keys);
  });

  it("still totals the same number the headline shows", async () => {
    const { tile } = await seedHours([
      { daysAgo: 1, hour: 3, n: 2 },
      { daysAgo: 1, hour: 9, n: 5 },
    ]);
    const slot = tile.byRange?.["yesterday"];
    const summed = (slot?.series ?? []).reduce((t, p) => t + p.value, 0);
    // A chart that does not add up to its own headline is worse than no chart.
    expect(summed).toBe(slot?.value);
    expect(summed).toBe(7);
  });
});

describe("Today, whose last hours have not happened yet", () => {
  it("stops at the hour in progress rather than plotting the rest of the day at zero", async () => {
    const { tile, now } = await seedHours([{ daysAgo: 0, hour: 0, n: 3 }]);
    const slot = tile.byRange?.["today"];
    expect(slot?.unit).toBe("hour");
    // Derived from the same clock the materializer read: hours 00..current.
    expect(slot?.series?.length).toBe(now.getUTCHours() + 1);
    expect(slot?.series?.at(-1)?.bucket).toBe(isoHour(now.getTime()));
  });

  it("compares against yesterday's hours, which the board measured anyway", async () => {
    const { tile } = await seedHours([
      { daysAgo: 0, hour: 0, n: 3 },
      { daysAgo: 1, hour: 0, n: 9 },
    ]);
    // Today's previous window is Yesterday, a preset on the same board, so its
    // hours are already in the map — the comparison costs nothing to build.
    const compare = tile.byRange?.["today"]?.compare;
    expect(compare?.length).toBe(24);
    expect(compare?.[0]?.value).toBe(9);
  });
});
