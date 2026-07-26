import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { deliveryLog, testRuns } from "@/db/schema";
import { pruneOperationalTables, pruneSettledTestRuns, retentionBacklog } from "@/lib/storage-lifecycle";
import type { DB } from "@/db/types";

/**
 * H.6 — operational tables that grow with ACTIVITY (not customer data) must
 * have a retention policy or they become the largest, slowest table in the
 * database. test_runs (one row per Test click) joins delivery_log here.
 */

let db: DB;
let close: () => Promise<void>;
let connectionId: string;
const ORG = "org_test";
const NOW = new Date("2026-07-01T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  connectionId = await seedConnection(db);
});
afterEach(async () => {
  await close();
});

async function seedDelivery(createdAt: Date) {
  await db.insert(deliveryLog).values({ orgId: ORG, connectionId, status: "success", attempt: 1, createdAt });
}
async function seedRun(createdAt: Date, status = "ok", updatedAt = createdAt) {
  await db.insert(testRuns).values({ orgId: ORG, status, result: {}, createdAt, updatedAt });
}

describe("operational retention", () => {
  it("prunes rows past the window and keeps everything inside it", async () => {
    await seedDelivery(daysAgo(45));
    await seedDelivery(daysAgo(31));
    await seedDelivery(daysAgo(5));
    await seedRun(daysAgo(60));
    await seedRun(daysAgo(2));

    const before = await retentionBacklog(db, 30, NOW);
    expect(before).toEqual({ deliveryLog: 2, testRuns: 1 });

    const pruned = await pruneOperationalTables(db, { now: NOW });
    expect(pruned).toEqual({ deliveryLog: 2, testRuns: 1 });

    expect(await db.select().from(deliveryLog)).toHaveLength(1); // the 5-day-old row
    expect(await db.select().from(testRuns)).toHaveLength(1); // the 2-day-old run
    expect(await retentionBacklog(db, 30, NOW)).toEqual({ deliveryLog: 0, testRuns: 0 });
  });

  it("is idempotent and safe on empty tables", async () => {
    expect(await pruneOperationalTables(db, { now: NOW })).toEqual({ deliveryLog: 0, testRuns: 0 });
    await seedRun(daysAgo(90));
    await pruneOperationalTables(db, { now: NOW });
    expect(await pruneOperationalTables(db, { now: NOW })).toEqual({ deliveryLog: 0, testRuns: 0 });
  });

  it("sweeps settled Test runs quickly, leaving in-flight ones alone", async () => {
    await seedRun(daysAgo(2), "ok", daysAgo(2)); // settled, old
    await seedRun(daysAgo(2), "running", daysAgo(2)); // still in flight → keep
    await seedRun(NOW, "ok", NOW); // settled, fresh → keep (editor may still read it)

    const removed = await pruneSettledTestRuns(db, 24, NOW);
    expect(removed).toBe(1);
    const left = await db.select().from(testRuns);
    expect(left).toHaveLength(2);
    expect(left.map((r) => r.status).sort()).toEqual(["ok", "running"]);
  });
});
