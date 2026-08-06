import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { reconcileConnection } from "@/ingestion/reconcile";
import { registerConnector } from "@/connectors/registry";
import { HttpError } from "@/lib/http-client";
import { connections, sourceStreams } from "@/db/schema";
import type { Connector } from "@/connectors/types";
import type { DB } from "@/db/types";

/**
 * A 429 IS A RATE LIMIT, NOT A FAULT.
 *
 * A 429 that survived fetchJson's single retry used to land in the same catch
 * as a revoked credential: recordProviderError → tripBreaker → first rung of
 * the probe ladder = ONE HOUR paused, plus a consecutiveFailures notch that
 * made the next genuine fault start further up the ladder. One unlucky minute
 * cost an hour of freshness and poisoned the breaker's memory.
 *
 * Now it defers: pause for the provider's own Retry-After (clamped 1s–10min,
 * 60s when absent), ledger evidence recorded, breaker untouched.
 */

let db: DB;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
  registerConnector((await import("@/connectors/close")).closeConnector);
  registerConnector((await import("@/connectors/instantly")).instantlyConnector);
});

const http429 = (retryAfterMs: number | null) =>
  new HttpError({ status: 429, statusText: "Too Many Requests", url: "https://api.example/x", body: "", retryAfterMs });

function throwing(source: string, error: Error, onPoll?: () => void): Connector {
  return {
    source,
    authType: "apiKey",
    verifySignature: () => true,
    normalize: () => [],
    poll: async () => {
      onPoll?.();
      throw error;
    },
  };
}

async function connRow(id: string) {
  const [c] = await db.select().from(connections).where(eq(connections.id, id));
  return c;
}

describe("connection-scoped 429", () => {
  it("pauses for the provider's Retry-After instead of tripping the 1-hour breaker", async () => {
    registerConnector(throwing("close", http429(120_000)));
    const id = await seedConnection(db, { source: "close" });
    const t0 = Date.now();

    const res = await reconcileConnection(db, id);

    expect(res.deferredUntil).toBeInstanceOf(Date);
    const conn = await connRow(id);
    const waitMs = conn.pausedUntil!.getTime() - t0;
    // THE regression: this was ~3,600,000 (the probe ladder's first rung).
    expect(waitMs).toBeGreaterThan(110_000);
    expect(waitMs).toBeLessThan(135_000);
    expect(conn.pausedReason).toContain("rate limited");
    // A rate limit is not a fault: the ladder's memory stays clean.
    expect(conn.consecutiveFailures).toBe(0);
  });

  it("defaults to 60s without Retry-After and clamps a huge one to 10 minutes", async () => {
    registerConnector(throwing("close", http429(null)));
    const a = await seedConnection(db, { source: "close" });
    const t0 = Date.now();
    await reconcileConnection(db, a);
    const waitA = (await connRow(a)).pausedUntil!.getTime() - t0;
    expect(waitA).toBeGreaterThan(50_000);
    expect(waitA).toBeLessThan(75_000);

    registerConnector(throwing("close", http429(3_600_000)));
    const b = await seedConnection(db, { source: "close" });
    const t1 = Date.now();
    await reconcileConnection(db, b);
    const waitB = (await connRow(b)).pausedUntil!.getTime() - t1;
    expect(waitB).toBeGreaterThan(9 * 60_000);
    expect(waitB).toBeLessThanOrEqual(10 * 60_000 + 15_000);
  });

  it("a genuine fault (500) still walks the breaker ladder", async () => {
    registerConnector(
      throwing("close", new HttpError({ status: 500, statusText: "Internal", url: "https://api.example/x", body: "", retryAfterMs: null })),
    );
    const id = await seedConnection(db, { source: "close" });
    const t0 = Date.now();

    await reconcileConnection(db, id);

    const conn = await connRow(id);
    expect(conn.consecutiveFailures).toBe(1);
    // First rung of the probe ladder: one hour.
    expect(conn.pausedUntil!.getTime() - t0).toBeGreaterThan(59 * 60_000);
  });
});

describe("stream-scoped 429", () => {
  it("stops the sweep — the quota is the credential's, which every stream shares", async () => {
    let polls = 0;
    registerConnector(throwing("instantly", http429(120_000), () => void polls++));
    const id = await seedConnection(db, { source: "instantly" });
    await db.insert(sourceStreams).values([
      { orgId: "org_test", connectionId: id, configHash: "s-a", config: {}, createdAt: new Date("2026-01-01T00:00:00Z") },
      { orgId: "org_test", connectionId: id, configHash: "s-b", config: {}, createdAt: new Date("2026-01-02T00:00:00Z") },
    ]);
    const t0 = Date.now();

    const res = await reconcileConnection(db, id);

    // Old behavior: stream-b was polled anyway, spending a request straight
    // into the wall the 429 just named.
    expect(polls).toBe(1);
    expect(res.deferredUntil).toBeInstanceOf(Date);
    const conn = await connRow(id);
    const waitMs = conn.pausedUntil!.getTime() - t0;
    expect(waitMs).toBeGreaterThan(110_000);
    expect(waitMs).toBeLessThan(135_000);
    expect(conn.consecutiveFailures).toBe(0);
  });

  it("a single-stream 429 never reaches the every-stream-failed breaker trip", async () => {
    registerConnector(throwing("instantly", http429(30_000)));
    const id = await seedConnection(db, { source: "instantly" });
    await db.insert(sourceStreams).values({ orgId: "org_test", connectionId: id, configHash: "s-only", config: {} });
    const t0 = Date.now();

    await reconcileConnection(db, id);

    const conn = await connRow(id);
    // Old code: failures === streams.length → tripBreaker → one hour.
    expect(conn.pausedUntil!.getTime() - t0).toBeLessThan(5 * 60_000);
    expect(conn.consecutiveFailures).toBe(0);
  });
});
