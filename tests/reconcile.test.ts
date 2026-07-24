import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { reconcileConnection } from "@/ingestion/reconcile";
import { registerConnector } from "@/connectors/registry";
import type { Connector, CanonicalEvent } from "@/connectors/types";
import { syncState, events } from "@/db/schema";
import type { DB } from "@/db/types";

let db: DB;
let close: () => Promise<void>;

// A deterministic poll-only connector: always returns the same two records so
// we can prove reconciliation dedups and advances the cursor.
const record = (id: string): CanonicalEvent => ({
  eventId: `test-poller:conn:${id}`,
  eventType: "row_added",
  occurredAt: new Date("2026-01-01T00:00:00Z"),
  properties: { id },
});

const pollConnector: Connector = {
  source: "test-poller",
  authType: "none",
  verifySignature: () => true,
  normalize: () => [],
  poll: async () => ({ records: [record("a"), record("b")], nextCursor: "cursor-1" }),
};
registerConnector(pollConnector);

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

describe("reconciliation / backfill", () => {
  it("polls, inserts new records, and stores the next cursor", async () => {
    const connectionId = await seedConnection(db, { source: "test-poller" });
    const res = await reconcileConnection(db, connectionId);
    expect(res).toEqual({ inserted: 2, deduped: 0, polled: true });

    const [state] = await db.select().from(syncState).where(eq(syncState.connectionId, connectionId));
    expect(state.cursor).toBe("cursor-1");
    expect(state.lastPolledAt).not.toBeNull();
  });

  it("dedups on the next sweep (gap-fill is idempotent)", async () => {
    const connectionId = await seedConnection(db, { source: "test-poller" });
    await reconcileConnection(db, connectionId);
    const second = await reconcileConnection(db, connectionId);
    expect(second).toEqual({ inserted: 0, deduped: 2, polled: true });
    expect(await db.select().from(events)).toHaveLength(2);
  });

  it("no-ops for a push-only source with no poll()", async () => {
    const connectionId = await seedConnection(db, { source: "webhook" });
    const res = await reconcileConnection(db, connectionId);
    expect(res).toEqual({ inserted: 0, deduped: 0, polled: false });
  });
});
