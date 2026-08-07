import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { connections, sourceStreams } from "@/db/schema";
import { reconcileConnection } from "@/ingestion/reconcile";
import { primeStream } from "@/lib/sync/streams";
import { releaseConnectionSyncLock, tryConnectionSyncLock } from "@/lib/sync/locks";
import { registerConnector } from "@/connectors/registry";
import type { Connector } from "@/connectors/types";
import type { DB } from "@/db/types";

/**
 * C.1 AT STREAM SCOPE. The connection-scoped branch, runSync and the backfill
 * slice have all held the connection lease since 0012 — the sweep's STREAM
 * branch and the inline Test's primeStream were the two writers that did not,
 * so on the http driver (where advisory locks are no-ops) they could poll the
 * same stream concurrently with any of the others: duplicate provider spend
 * and interleaved cursor writes. These pin that both now respect the lease.
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

function stub(onPoll: () => void): Connector {
  return {
    source: "instantly",
    authType: "apiKey",
    verifySignature: () => true,
    normalize: () => [],
    poll: async () => {
      onPoll();
      return { records: [], nextCursor: null };
    },
  };
}

describe("the sweep's stream branch under the connection lease", () => {
  it("stands down without a single provider call while another writer holds the lease", async () => {
    let polls = 0;
    registerConnector(stub(() => void polls++));
    const id = await seedConnection(db, { source: "instantly" });
    await db.insert(sourceStreams).values({ orgId: "org_test", connectionId: id, configHash: "s1", config: {} });

    const held = await tryConnectionSyncLock(db, id);
    expect(held).not.toBeNull();
    try {
      const res = await reconcileConnection(db, id);
      // THE regression: the old stream branch polled straight through a held
      // lease — the sweep and a "Sync now" walked the same stream twice.
      expect(res.skipped).toBe(true);
      expect(polls).toBe(0);
    } finally {
      await releaseConnectionSyncLock(db, id, held!.token);
    }
  });

  it("acquires, sweeps and RELEASES — the next writer is not locked out", async () => {
    let polls = 0;
    registerConnector(stub(() => void polls++));
    const id = await seedConnection(db, { source: "instantly" });
    await db.insert(sourceStreams).values({ orgId: "org_test", connectionId: id, configHash: "s1", config: {} });

    const first = await reconcileConnection(db, id);
    expect(first.skipped).toBeUndefined();
    expect(polls).toBe(1);

    // The lease must not outlive the sweep.
    const after = await tryConnectionSyncLock(db, id);
    expect(after).not.toBeNull();
    await releaseConnectionSyncLock(db, id, after!.token);
  });
});

describe("primeStream under the connection lease", () => {
  it("says a sync is running instead of double-polling while the lease is held", async () => {
    let polls = 0;
    registerConnector(stub(() => void polls++));
    const id = await seedConnection(db, { source: "instantly" });
    await db
      .insert(sourceStreams)
      .values({ orgId: "org_test", connectionId: id, configHash: "s1", config: { campaignId: "c1" } });

    const held = await tryConnectionSyncLock(db, id);
    expect(held).not.toBeNull();
    try {
      // Non-forced: skips the bounded wait and hits the lease take directly.
      const res = await primeStream(db, "org_test", id, { campaignId: "c1" });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.refreshed).toBe(false);
        expect(res.note).toContain("already running");
      }
      expect(polls).toBe(0);
    } finally {
      await releaseConnectionSyncLock(db, id, held!.token);
    }
  });

  it("takes and releases the lease around its own sync", async () => {
    let polls = 0;
    registerConnector(stub(() => void polls++));
    const id = await seedConnection(db, { source: "instantly" });
    await db
      .insert(sourceStreams)
      .values({ orgId: "org_test", connectionId: id, configHash: "s1", config: { campaignId: "c1" } });

    const res = await primeStream(db, "org_test", id, { campaignId: "c1" }, { force: true });
    expect(res.ok).toBe(true);
    expect(polls).toBe(1);

    const after = await tryConnectionSyncLock(db, id);
    expect(after).not.toBeNull();
    await releaseConnectionSyncLock(db, id, after!.token);
  });
});
