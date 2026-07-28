import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { connections, events, sourceStreams } from "@/db/schema";
import { restoreConnectionEvents, retireConnectionEvents } from "@/lib/sync/retire-connection";
import type { DB } from "@/db/types";

/**
 * Phase 2A — disconnecting keeps the row.
 *
 * The old disconnect hard-deleted the connection, and that made reconnecting
 * impossible to do WELL rather than merely awkward: every connector namespaces
 * its `eventId` with the connection UUID, so adding the account again imports a
 * second complete copy of the dataset under new ids, with the old copy
 * tombstoned beside it. Nothing can merge those afterwards.
 *
 * These tests exercise the storage half directly — `disableConnection` and
 * `reconnectConnection` live behind `getDb()`/`server-only`, so the retire and
 * restore they are built on are what is asserted here, plus the row states they
 * set.
 */

const ORG = "org_disable";
let db: DB;
let close: () => Promise<void>;
let connId = "";

const seedEvents = async (n: number) => {
  for (let i = 0; i < n; i++) {
    await db.insert(events).values({
      eventId: `close:${connId}:e${i}`,
      orgId: ORG,
      connectionId: connId,
      source: "close",
      eventType: "lead_created",
      occurredAt: new Date(),
      properties: {},
    });
  }
};

const liveCount = async () =>
  (await db.select().from(events).where(and(eq(events.connectionId, connId), isNull(events.deletedAt)))).length;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  connId = await seedConnection(db, { orgId: ORG, source: "close" });
});
afterEach(async () => {
  await close();
});

describe("disconnecting hides data without destroying it", () => {
  it("tombstones every live row and leaves the rows themselves in place", async () => {
    await seedEvents(3);
    const retired = await retireConnectionEvents(db, ORG, connId);

    expect(retired).toBe(3);
    expect(await liveCount()).toBe(0);
    // THE distinction. Hidden, not gone — this is what reconnect restores.
    expect((await db.select().from(events).where(eq(events.connectionId, connId)))).toHaveLength(3);
  });

  it("restores exactly what it hid, under the same ids", async () => {
    await seedEvents(3);
    const before = (await db.select().from(events).where(eq(events.connectionId, connId))).map((e) => e.eventId).sort();

    await retireConnectionEvents(db, ORG, connId);
    const restored = await restoreConnectionEvents(db, ORG, connId);

    expect(restored).toBe(3);
    expect(await liveCount()).toBe(3);
    const after = (await db.select().from(events).where(eq(events.connectionId, connId))).map((e) => e.eventId).sort();
    // Same ids, so a later poll updates these rows rather than writing a second
    // copy beside them. That is the entire reason the connection row survives.
    expect(after).toEqual(before);
  });

  it("is idempotent in both directions", async () => {
    await seedEvents(2);
    await retireConnectionEvents(db, ORG, connId);
    expect(await retireConnectionEvents(db, ORG, connId)).toBe(0);

    await restoreConnectionEvents(db, ORG, connId);
    expect(await restoreConnectionEvents(db, ORG, connId)).toBe(0);
    expect(await liveCount()).toBe(2);
  });

  it("never reaches another org's rows", async () => {
    await seedEvents(2);
    await db.insert(events).values({
      eventId: `close:other:e0`,
      orgId: "org_other",
      connectionId: connId, // same connection id, different tenant — must not match
      source: "close",
      eventType: "lead_created",
      occurredAt: new Date(),
      properties: {},
    });

    expect(await retireConnectionEvents(db, ORG, connId)).toBe(2);
    const [foreign] = await db.select().from(events).where(eq(events.orgId, "org_other"));
    expect(foreign.deletedAt).toBeNull();
  });

  /**
   * The restore side needs its own tenant test, and this is not symmetry for its
   * own sake: restore is the one that UN-hides rows, so a scoping slip there
   * surfaces another tenant's retired data rather than merely failing to hide
   * it. Strictly the worse direction of the two.
   */
  it("restore never un-hides another org's rows", async () => {
    await seedEvents(2);
    await db.insert(events).values({
      eventId: `close:other:e0`,
      orgId: "org_other",
      connectionId: connId, // same connection id, different tenant
      source: "close",
      eventType: "lead_created",
      occurredAt: new Date(),
      properties: {},
      deletedAt: new Date(), // already retired, and must STAY retired
    });

    await retireConnectionEvents(db, ORG, connId);
    const restored = await restoreConnectionEvents(db, ORG, connId);

    expect(restored).toBe(2); // ours only
    const [foreign] = await db.select().from(events).where(eq(events.orgId, "org_other"));
    expect(foreign.deletedAt).not.toBeNull();
  });

  /**
   * `disabledAt` is the clock a later purge runs on. If a second disconnect
   * re-stamped it, a connection could be kept alive indefinitely by clicking
   * disconnect again — and, worse, the retention promise shown to the user
   * would silently move.
   */
  it("stamps disabledAt once, and a repeat disconnect does not move it", async () => {
    const first = new Date("2026-01-01T00:00:00Z");
    await db
      .update(connections)
      .set({ status: "disabled", disabledAt: first })
      .where(eq(connections.id, connId));

    // The guard `disableConnection` applies: only rows not already disabled.
    await db
      .update(connections)
      .set({ status: "disabled", disabledAt: new Date("2026-06-01T00:00:00Z") })
      .where(and(eq(connections.id, connId), eq(connections.status, "active")));

    const [row] = await db.select().from(connections).where(eq(connections.id, connId));
    expect(row.disabledAt?.toISOString()).toBe(first.toISOString());
  });

  it("keeps the streams so reconnect does not have to re-derive them", async () => {
    await db.insert(sourceStreams).values({
      orgId: ORG,
      connectionId: connId,
      configHash: "hash-a",
      config: { spreadsheetId: "S1" },
      cursor: "CURSOR",
    });

    await db.update(sourceStreams).set({ status: "disabled" }).where(eq(sourceStreams.connectionId, connId));
    const [disabled] = await db.select().from(sourceStreams).where(eq(sourceStreams.connectionId, connId));
    expect(disabled.status).toBe("disabled");
    // The resource the flow declared, and its cursor, both survive — so
    // reconnecting resumes rather than re-importing.
    expect(disabled.config).toMatchObject({ spreadsheetId: "S1" });
    expect(disabled.cursor).toBe("CURSOR");
  });
});
