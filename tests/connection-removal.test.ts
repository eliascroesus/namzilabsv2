import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { events } from "@/db/schema";
import { retireConnectionEvents } from "@/lib/sync/retire-connection";
import type { DB } from "@/db/types";

/**
 * Removing an integration must remove its DATA from the product, not just its
 * credentials. `events.connection_id` carries no foreign key, so nothing else
 * retires these rows — without this they stay live forever, counted by every
 * org-wide read (classic dashboard metrics), with no surface left in the UI to
 * find them.
 *
 * Four properties:
 *   1. it retires exactly the removed connection's live rows;
 *   2. it never touches another connection — or another ORG — even when the
 *      same connection id is passed with the wrong org;
 *   3. the rows go out of circulation but stay physically present, so a
 *      mis-click is recoverable by clearing deleted_at;
 *   4. it is idempotent, and re-running does not re-stamp an earlier deletion.
 */

let db: DB;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

let seq = 0;
async function seedEvent(
  connectionId: string,
  opts: { orgId?: string; deletedAt?: Date } = {},
): Promise<string> {
  const [row] = await db
    .insert(events)
    .values({
      eventId: `removal-test:${connectionId}:${seq++}`,
      orgId: opts.orgId ?? "org_test",
      connectionId,
      source: "webhook",
      eventType: "lead",
      occurredAt: new Date("2026-01-01T00:00:00Z"),
      properties: {},
      deletedAt: opts.deletedAt ?? null,
    })
    .returning({ id: events.id });
  return row.id;
}

const liveCount = async (connectionId: string) =>
  (await db.select().from(events).where(and(eq(events.connectionId, connectionId), isNull(events.deletedAt)))).length;
const totalCount = async (connectionId: string) =>
  (await db.select().from(events).where(eq(events.connectionId, connectionId))).length;

describe("removing a connection retires its events", () => {
  it("tombstones exactly the removed connection's live rows, leaving others alone", async () => {
    const doomed = await seedConnection(db, { name: "Doomed" });
    const keeper = await seedConnection(db, { name: "Keeper" });
    for (let i = 0; i < 3; i++) await seedEvent(doomed);
    for (let i = 0; i < 2; i++) await seedEvent(keeper);

    expect(await liveCount(doomed)).toBe(3);

    const retired = await retireConnectionEvents(db, "org_test", doomed);

    expect(retired).toBe(3);
    expect(await liveCount(doomed)).toBe(0);
    // The other connection is untouched — this is the blast-radius guarantee.
    expect(await liveCount(keeper)).toBe(2);
  });

  it("soft-deletes: the rows are out of circulation but still recoverable", async () => {
    const conn = await seedConnection(db);
    await seedEvent(conn);
    await seedEvent(conn);

    await retireConnectionEvents(db, "org_test", conn);

    // Gone from every read path (all of which filter deleted_at IS NULL)...
    expect(await liveCount(conn)).toBe(0);
    // ...but physically present, so an accidental disconnect can be undone.
    expect(await totalCount(conn)).toBe(2);

    await db.update(events).set({ deletedAt: null }).where(eq(events.connectionId, conn));
    expect(await liveCount(conn)).toBe(2);
  });

  it("is org-scoped — a connection id alone cannot reach another tenant's rows", async () => {
    const conn = await seedConnection(db, { orgId: "org_a" });
    await seedEvent(conn, { orgId: "org_a" });
    // Same connection id, different org: must be invisible to org_b's removal.
    await seedEvent(conn, { orgId: "org_b" });

    const retired = await retireConnectionEvents(db, "org_b", conn);

    expect(retired).toBe(1);
    expect(
      (await db.select().from(events).where(and(eq(events.orgId, "org_a"), isNull(events.deletedAt)))).length,
    ).toBe(1);
  });

  it("is idempotent and preserves an earlier deletion's timestamp", async () => {
    const conn = await seedConnection(db);
    const already = new Date("2026-01-05T00:00:00Z");
    const old = await seedEvent(conn, { deletedAt: already });
    await seedEvent(conn);

    expect(await retireConnectionEvents(db, "org_test", conn)).toBe(1); // only the live one
    expect(await retireConnectionEvents(db, "org_test", conn)).toBe(0); // nothing left

    const [row] = await db.select().from(events).where(eq(events.id, old));
    expect(row.deletedAt?.toISOString()).toBe(already.toISOString());
  });

  it("a connection with no events removes cleanly", async () => {
    const conn = await seedConnection(db);
    expect(await retireConnectionEvents(db, "org_test", conn)).toBe(0);
    expect(await liveCount(conn)).toBe(0);
  });
});
