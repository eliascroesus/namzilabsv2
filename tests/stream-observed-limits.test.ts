import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { reconcileConnection } from "@/ingestion/reconcile";
import { registerConnector } from "@/connectors/registry";
import { connections, sourceStreams, usageLedger } from "@/db/schema";
import type { Connector } from "@/connectors/types";
import type { DB } from "@/db/types";

/**
 * OBSERVED RATE-LIMIT HEADERS ON THE STREAM PATH.
 *
 * `PollResult.rateLimit` was consumed only by the connection-scoped branch of
 * the sweep. The stream path — the one every Calendly, Instantly, Sheets and
 * Calendar connection takes — threw the headers away: no `observed_limit`
 * evidence ever accumulated (the very evidence the catalog's declared limits
 * say they are waiting on), and a provider reporting `remaining: 0` was polled
 * again anyway, learning the exhaustion via a 429 and a tripped breaker
 * instead of a scheduled pause.
 *
 * And on the connection-scoped path the pause had no teeth: recordSuccess ran
 * AFTER applyObservedRateLimit and nulled the `pausedUntil` it had just
 * written, so the next sweep polled straight into the exhausted quota. The
 * last test pins the corrected order.
 */

let db: DB;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
  registerConnector((await import("@/connectors/instantly")).instantlyConnector);
  registerConnector((await import("@/connectors/close")).closeConnector);
});

describe("the stream path reads the provider's rate-limit headers", () => {
  it("records the observed limit in the ledger window the claim was charged to", async () => {
    const healthy: Connector = {
      source: "instantly",
      authType: "apiKey",
      verifySignature: () => true,
      normalize: () => [],
      poll: async () => ({
        records: [],
        nextCursor: null,
        rateLimit: { limit: 6_000, remaining: 5_990, resetSeconds: 42 },
      }),
    };
    registerConnector(healthy);
    const connectionId = await seedConnection(db, { source: "instantly" });
    await db.insert(sourceStreams).values({ orgId: "org_test", connectionId, configHash: "h1", config: {} });

    await reconcileConnection(db, connectionId);

    const rows = await db.select().from(usageLedger).where(eq(usageLedger.connectionId, connectionId));
    expect(rows).toHaveLength(1);
    // THE regression: the stream path recorded no observed_limit at all.
    expect(rows[0].observedLimit).toBe(6_000);
    // Plenty remaining → no pause; the header is evidence, not a verdict.
    const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId));
    expect(conn.pausedUntil).toBeNull();
  });

  it("remaining: 0 keeps the page it arrived on, pauses the connection, and stops the sweep", async () => {
    const polled: string[] = [];
    const exhausted: Connector = {
      source: "instantly",
      authType: "apiKey",
      verifySignature: () => true,
      normalize: () => [],
      poll: async ({ streamHash }) => {
        polled.push(streamHash ?? "?");
        return {
          records: [],
          nextCursor: "page-2",
          rateLimit: { limit: 6_000, remaining: 0, resetSeconds: 30 },
        };
      },
    };
    registerConnector(exhausted);
    const connectionId = await seedConnection(db, { source: "instantly" });
    // stream-a first in LRU order; stream-b must never be reached — the
    // exhaustion is the CREDENTIAL's, which both streams share. (Contrast the
    // ledger's own budget denial, where the sweep now correctly skips to the
    // next stream — see stream-starvation.test.ts.)
    await db.insert(sourceStreams).values([
      { orgId: "org_test", connectionId, configHash: "stream-a", config: {}, createdAt: new Date("2026-01-01T00:00:00Z") },
      { orgId: "org_test", connectionId, configHash: "stream-b", config: {}, createdAt: new Date("2026-01-02T00:00:00Z") },
    ]);

    const res = await reconcileConnection(db, connectionId);

    expect(polled).toEqual(["stream-a"]);
    expect(res.deferredUntil).toBeInstanceOf(Date);
    const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId));
    // The pause SURVIVES the sweep — recordSuccess must not erase it.
    expect(conn.pausedUntil).not.toBeNull();
    expect(conn.pausedReason).toContain("rate limit");
    // The page the header arrived on was kept: the cursor advanced before the
    // walk stopped, so the fetch that revealed the exhaustion was not wasted.
    const [streamA] = await db
      .select()
      .from(sourceStreams)
      .where(and(eq(sourceStreams.connectionId, connectionId), eq(sourceStreams.configHash, "stream-a")));
    expect(streamA.cursor).toBe("page-2");
  });

  it("connection-scoped: the observed pause outlives recordSuccess", async () => {
    const exhaustedClose: Connector = {
      source: "close",
      authType: "apiKey",
      verifySignature: () => true,
      normalize: () => [],
      poll: async () => ({
        records: [],
        nextCursor: null,
        rateLimit: { limit: 1_200, remaining: 0, resetSeconds: 15 },
      }),
    };
    registerConnector(exhaustedClose);
    const connectionId = await seedConnection(db, { source: "close" });

    const res = await reconcileConnection(db, connectionId);

    expect(res.deferredUntil).toBeInstanceOf(Date);
    const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId));
    // THE regression: applyObservedRateLimit wrote this pause and recordSuccess
    // nulled it three statements later — the sweep reported a deferral the
    // connection row no longer carried.
    expect(conn.pausedUntil).not.toBeNull();
  });
});
