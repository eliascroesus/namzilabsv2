import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { reconcileConnection } from "@/ingestion/reconcile";
import { activeStreams } from "@/lib/sync/streams";
import { registerConnector } from "@/connectors/registry";
import { connections, sourceStreams, usageLedger } from "@/db/schema";
import type { Connector } from "@/connectors/types";
import type { DB } from "@/db/types";

/**
 * STREAM STARVATION — the tail of a stream list must not be unreachable.
 *
 * Two defects composed into permanent starvation:
 *
 * 1. `activeStreams` had no ORDER BY. Postgres heap order is stable in
 *    practice, so every sweep walked the same list in the same order.
 * 2. The sweep RETURNED on the first budget-denied stream, so every stream
 *    after the denial point was skipped — and by (1) it was the SAME streams
 *    every time. A connection with more streams than its per-minute budget
 *    polled a fixed prefix forever; the tail never got a single request.
 *
 * The fix has two halves, pinned separately below: least-recently-polled-first
 * ordering (so scarce budget rotates), and skip-not-abort on denial (so a
 * denial — a fact about ONE operation bucket — never silences streams that
 * may claim from a different bucket).
 */

let db: DB;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
  registerConnector((await import("@/connectors/instantly")).instantlyConnector);
});

/** Charge one (connection, operation) bucket far past any lane limit for the
 *  current minute, so the next claim against it is denied. */
async function drainBucket(db: DB, orgId: string, connectionId: string, provider: string, operation: string) {
  const windowStart = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  await db
    .insert(usageLedger)
    .values({ orgId, connectionId, provider, operation, windowStart, calls: 100_000 })
    .onConflictDoUpdate({
      target: [usageLedger.connectionId, usageLedger.operation, usageLedger.windowStart],
      set: { calls: 100_000 },
    });
}

describe("activeStreams orders least-recently-polled first", () => {
  it("never-polled streams lead, then oldest lastPolledAt, insertion order irrelevant", async () => {
    const connectionId = await seedConnection(db, { source: "instantly" });
    // Inserted freshest-first, so heap order is the REVERSE of LRU order —
    // without the ORDER BY this test sees [recent, stale, never] and fails.
    await db.insert(sourceStreams).values({ orgId: "org_test", connectionId, configHash: "recent", config: {}, lastPolledAt: new Date() });
    await db.insert(sourceStreams).values({ orgId: "org_test", connectionId, configHash: "stale", config: {}, lastPolledAt: new Date(Date.now() - 60 * 60_000) });
    await db.insert(sourceStreams).values({ orgId: "org_test", connectionId, configHash: "never", config: {}, lastPolledAt: null });

    const order = (await activeStreams(db, connectionId)).map((s) => s.configHash);
    expect(order).toEqual(["never", "stale", "recent"]);
  });

  it("ties on lastPolledAt break deterministically", async () => {
    const connectionId = await seedConnection(db, { source: "instantly" });
    const created = new Date("2026-01-01T00:00:00Z");
    await db.insert(sourceStreams).values([
      { orgId: "org_test", connectionId, configHash: "h1", config: {}, createdAt: created },
      { orgId: "org_test", connectionId, configHash: "h2", config: {}, createdAt: created },
    ]);
    const first = (await activeStreams(db, connectionId)).map((s) => s.id);
    for (let i = 0; i < 3; i++) {
      const again = (await activeStreams(db, connectionId)).map((s) => s.id);
      expect(again).toEqual(first);
    }
  });
});

describe("budget denial skips the stream, not the sweep", () => {
  it("a denied first stream does not silence streams on a different operation bucket", async () => {
    const polled: string[] = [];
    // Real source name so the real catalog entry applies (instantly IS
    // stream-scoped); fake connector so no network is touched. Two operations
    // → two independent ledger buckets, which is exactly the situation where
    // abort-on-first-denial threw away budget the connection still had.
    const twoBuckets: Connector = {
      source: "instantly",
      authType: "apiKey",
      verifySignature: () => true,
      normalize: () => [],
      operations: ["opA", "opB"] as const,
      operationFor: (config) => (config?.["streamType"] === "a" ? "opA" : "opB"),
      poll: async ({ streamHash }) => {
        polled.push(streamHash ?? "?");
        return { records: [], nextCursor: null };
      },
    };
    registerConnector(twoBuckets);

    const connectionId = await seedConnection(db, { source: "instantly" });
    // stream-a is FIRST in LRU order (older createdAt, both never polled).
    await db.insert(sourceStreams).values([
      { orgId: "org_test", connectionId, configHash: "stream-a", config: { streamType: "a" }, createdAt: new Date("2026-01-01T00:00:00Z") },
      { orgId: "org_test", connectionId, configHash: "stream-b", config: { streamType: "b" }, createdAt: new Date("2026-01-02T00:00:00Z") },
    ]);
    await drainBucket(db, "org_test", connectionId, "instantly", "opA");

    const res = await reconcileConnection(db, connectionId);

    // THE regression: before skip-not-abort, stream-b was never polled.
    expect(polled).toEqual(["stream-b"]);
    // The deferral is still honoured — once, after every stream had its claim.
    expect(res.deferredUntil).toBeInstanceOf(Date);
    const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId));
    expect(conn.pausedUntil).not.toBeNull();
    // And stream-b's spend landed in ITS bucket, proof the claim really ran.
    const [opB] = await db
      .select()
      .from(usageLedger)
      .where(sql`${usageLedger.connectionId} = ${connectionId} and ${usageLedger.operation} = 'opB'`);
    expect(opB.calls).toBeGreaterThan(0);
  });

  it("a fully-deferred sweep does not reset the probe ladder", async () => {
    const singleBucket: Connector = {
      source: "instantly",
      authType: "apiKey",
      verifySignature: () => true,
      normalize: () => [],
      poll: async () => ({ records: [], nextCursor: null }),
    };
    registerConnector(singleBucket);

    const connectionId = await seedConnection(db, { source: "instantly" });
    await db.insert(sourceStreams).values({ orgId: "org_test", connectionId, configHash: "h1", config: {} });
    // A connection part-way up the breaker ladder (2 failed probes behind it)…
    await db.update(connections).set({ consecutiveFailures: 2 }).where(eq(connections.id, connectionId));
    // …whose only bucket is spent: the sweep makes NO provider contact.
    await drainBucket(db, "org_test", connectionId, "instantly", "*");

    const res = await reconcileConnection(db, connectionId);

    expect(res.deferredUntil).toBeInstanceOf(Date);
    const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId));
    // recordSuccess on the strength of calls never made would restart the
    // ladder at 1h after the next real failure instead of continuing to 24h.
    expect(conn.consecutiveFailures).toBe(2);
    expect(conn.pausedUntil).not.toBeNull();
  });
});
