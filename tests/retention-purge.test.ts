import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { connectionArchive, connections, deadLetter, events, rawEvents, sourceStreams, streamFields, syncState, usageLedger } from "@/db/schema";
import { purgeRetiredData, PURGE_EVENTS_AFTER_DAYS, PURGE_CONNECTION_AFTER_DAYS, PURGE_TOMBSTONES_AFTER_DAYS } from "@/lib/retention";
import type { DB } from "@/db/types";

/**
 * The only path in this product that destroys customer data, so these tests are
 * mostly about what it REFUSES to touch.
 *
 * The dangerous mistake is not deleting too little. It is deleting on the
 * strength of `status = 'disabled'` without checking how long ago, which would
 * destroy a live customer's history the moment they mis-clicked disconnect.
 */

const ORG = "org_purge";
const NOW = new Date("2026-07-01T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

let db: DB;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

async function connWithData(opts: { status: string; disabledAt: Date | null; rows?: number }) {
  const id = await seedConnection(db, { orgId: ORG, source: "close" });
  await db.update(connections).set({ status: opts.status, disabledAt: opts.disabledAt }).where(eq(connections.id, id));
  for (let i = 0; i < (opts.rows ?? 2); i++) {
    await db.insert(events).values({
      eventId: `close:${id}:e${i}`,
      orgId: ORG,
      connectionId: id,
      source: "close",
      eventType: "lead",
      occurredAt: daysAgo(100 + i),
      properties: {},
      deletedAt: opts.status === "disabled" ? opts.disabledAt : null,
    });
  }
  await db.insert(rawEvents).values({ orgId: ORG, connectionId: id, source: "close", payload: {} });
  return id;
}

const eventCount = async (id: string) => (await db.select().from(events).where(eq(events.connectionId, id))).length;

describe("the purge refuses anything it has not earned", () => {
  it("does not touch a connection disabled less than 30 days ago", async () => {
    const id = await connWithData({ status: "disabled", disabledAt: daysAgo(PURGE_EVENTS_AFTER_DAYS - 1) });

    const r = await purgeRetiredData(db, { apply: true, now: NOW });

    expect(r.eventsPurged).toEqual([]);
    expect(await eventCount(id)).toBe(2);
  });

  /**
   * THE guard. `status` says the user disconnected; it says nothing about when.
   * A connection with no `disabled_at` — a legacy row, or one disabled by a
   * path that forgot to stamp it — must never be purgeable, because "unknown
   * age" is not "old enough".
   */
  it("does not touch a disabled connection with no disabledAt at all", async () => {
    const id = await connWithData({ status: "disabled", disabledAt: null });

    const r = await purgeRetiredData(db, { apply: true, now: NOW });

    expect(r.eventsPurged).toEqual([]);
    expect(r.connectionsRemoved).toEqual([]);
    expect(await eventCount(id)).toBe(2);
  });

  it("never purges an ACTIVE connection, however old its disabledAt looks", async () => {
    // A stale stamp left behind by a disconnect-then-reconnect must not make a
    // live connection eligible.
    const id = await connWithData({ status: "active", disabledAt: daysAgo(400) });

    const r = await purgeRetiredData(db, { apply: true, now: NOW });

    expect(r.eventsPurged).toEqual([]);
    expect(await eventCount(id)).toBe(2);
    expect((await db.select().from(connections).where(eq(connections.id, id)))).toHaveLength(1);
  });

  it("writes nothing at all in dry-run, which is the default", async () => {
    const id = await connWithData({ status: "disabled", disabledAt: daysAgo(90) });

    const r = await purgeRetiredData(db, { now: NOW });

    expect(r.dryRun).toBe(true);
    expect(r.eventsPurged).toHaveLength(1); // reported…
    expect(await eventCount(id)).toBe(2); // …and untouched
    expect((await db.select().from(connectionArchive))).toHaveLength(0);
    expect((await db.select().from(connections).where(eq(connections.id, id)))).toHaveLength(1);
  });
});

describe("day 30 — archive, then shed the bulk", () => {
  it("describes what it held before destroying it", async () => {
    const id = await connWithData({ status: "disabled", disabledAt: daysAgo(45), rows: 3 });

    await purgeRetiredData(db, { apply: true, now: NOW });

    const [archived] = await db.select().from(connectionArchive).where(eq(connectionArchive.connectionId, id));
    expect(archived.eventCount).toBe(3);
    expect(archived.rawEventCount).toBe(1);
    expect(archived.source).toBe("close");
    expect(archived.oldestOccurredAt).not.toBeNull();
    // The data is gone; the description of it is not. A user reconnecting at
    // day 45 can be told what was here rather than left guessing.
    expect(await eventCount(id)).toBe(0);
    expect((await db.select().from(rawEvents).where(eq(rawEvents.connectionId, id)))).toHaveLength(0);
  });

  it("keeps the connection itself, so reconnecting still works", async () => {
    const id = await connWithData({ status: "disabled", disabledAt: daysAgo(45) });

    await purgeRetiredData(db, { apply: true, now: NOW });

    // Between day 30 and day 60 the integration is recoverable with a gap,
    // which is a state a user can act on. After day 60 it is a new connection.
    expect((await db.select().from(connections).where(eq(connections.id, id)))).toHaveLength(1);
  });

  it("archives once, however many times it runs", async () => {
    const id = await connWithData({ status: "disabled", disabledAt: daysAgo(45) });

    await purgeRetiredData(db, { apply: true, now: NOW });
    await purgeRetiredData(db, { apply: true, now: NOW });

    expect((await db.select().from(connectionArchive).where(eq(connectionArchive.connectionId, id)))).toHaveLength(1);
  });
});

describe("day 60 — the identity, and the five tables that leak", () => {
  it("removes the connection and every table that has no foreign key to it", async () => {
    const id = await connWithData({ status: "disabled", disabledAt: daysAgo(PURGE_CONNECTION_AFTER_DAYS + 5) });
    await db.insert(sourceStreams).values({ orgId: ORG, connectionId: id, configHash: "h", config: {} });
    await db.insert(syncState).values({ connectionId: id, cursor: "c" });
    await db.insert(usageLedger).values({ orgId: ORG, connectionId: id, provider: "close", operation: "*", windowStart: NOW });
    await db.insert(deadLetter).values({ orgId: ORG, connectionId: id, error: "x" });
    await db.insert(streamFields).values({ orgId: ORG, connectionId: id, streamHash: "h", fieldPath: "a" });

    await purgeRetiredData(db, { apply: true, now: NOW });

    expect((await db.select().from(connections).where(eq(connections.id, id)))).toHaveLength(0);
    // Every one of these leaked before, because deleting the connection row
    // never touched them.
    expect((await db.select().from(sourceStreams).where(eq(sourceStreams.connectionId, id)))).toHaveLength(0);
    expect((await db.select().from(syncState).where(eq(syncState.connectionId, id)))).toHaveLength(0);
    expect((await db.select().from(usageLedger).where(eq(usageLedger.connectionId, id)))).toHaveLength(0);
    expect((await db.select().from(deadLetter).where(eq(deadLetter.connectionId, id)))).toHaveLength(0);
    expect((await db.select().from(streamFields).where(eq(streamFields.connectionId, id)))).toHaveLength(0);
  });

  it("leaves no events behind when the connection goes", async () => {
    const id = await connWithData({ status: "disabled", disabledAt: daysAgo(70) });

    await purgeRetiredData(db, { apply: true, now: NOW });

    // Stranded events would be unreachable: no connection means no UI to find
    // them from, and no later pass that looks for them.
    expect(await eventCount(id)).toBe(0);
  });
});

describe("tombstones on live connections", () => {
  it("purges tombstones older than the window", async () => {
    const id = await seedConnection(db, { orgId: ORG, source: "close" });
    await db.insert(events).values({
      eventId: `close:${id}:old`,
      orgId: ORG,
      connectionId: id,
      source: "close",
      eventType: "lead",
      occurredAt: daysAgo(200),
      properties: {},
      deletedAt: daysAgo(PURGE_TOMBSTONES_AFTER_DAYS + 5),
    });

    const r = await purgeRetiredData(db, { apply: true, now: NOW });

    expect(r.tombstonesPurged).toBe(1);
    expect(await eventCount(id)).toBe(0);
  });

  /**
   * `upsertEvents` clears `deleted_at` when a record reappears, so a tombstone
   * removed too early turns a legitimate restore into a duplicate insert. The
   * window has to outlast every self-correcting path — Calendly's is the widest.
   */
  it("keeps a recent tombstone, which a re-sync may still resurrect", async () => {
    const id = await seedConnection(db, { orgId: ORG, source: "close" });
    await db.insert(events).values({
      eventId: `close:${id}:recent`,
      orgId: ORG,
      connectionId: id,
      source: "close",
      eventType: "lead",
      occurredAt: daysAgo(10),
      properties: {},
      deletedAt: daysAgo(PURGE_TOMBSTONES_AFTER_DAYS - 1),
    });

    const r = await purgeRetiredData(db, { apply: true, now: NOW });

    expect(r.tombstonesPurged).toBe(0);
    expect(await eventCount(id)).toBe(1);
  });

  it("never reaches a live row", async () => {
    const id = await seedConnection(db, { orgId: ORG, source: "close" });
    await db.insert(events).values({
      eventId: `close:${id}:live`,
      orgId: ORG,
      connectionId: id,
      source: "close",
      eventType: "lead",
      occurredAt: daysAgo(500),
      properties: {},
      deletedAt: null, // ancient, but ALIVE
    });

    await purgeRetiredData(db, { apply: true, now: NOW });

    expect(await eventCount(id)).toBe(1);
  });

  /**
   * A disabled connection's tombstones belong to the staged passes, which
   * archive before deleting. Reaching them here would destroy the data before
   * anything had described it.
   */
  it("leaves a disabled connection's tombstones to the staged pass", async () => {
    const id = await connWithData({ status: "disabled", disabledAt: daysAgo(PURGE_EVENTS_AFTER_DAYS - 2) });
    await db.update(events).set({ deletedAt: daysAgo(PURGE_TOMBSTONES_AFTER_DAYS + 10) }).where(eq(events.connectionId, id));

    const r = await purgeRetiredData(db, { apply: true, now: NOW });

    expect(r.tombstonesPurged).toBe(0);
    expect(await eventCount(id)).toBe(2); // still there, and still described later
  });
});

describe("bounded and resumable", () => {
  it("stops on its time budget and says so, rather than running long", async () => {
    await connWithData({ status: "disabled", disabledAt: daysAgo(90) });

    const r = await purgeRetiredData(db, { apply: true, now: NOW, budgetMs: 0 });

    expect(r.hitBudget).toBe(true);
    expect(r.eventsPurged).toEqual([]); // nothing started
  });

  it("reports a backlog so falling behind is visible", async () => {
    await connWithData({ status: "disabled", disabledAt: daysAgo(90) });

    const stopped = await purgeRetiredData(db, { apply: true, now: NOW, budgetMs: 0 });
    expect(stopped.backlog.events).toBe(2);

    const finished = await purgeRetiredData(db, { apply: true, now: NOW });
    expect(finished.backlog.events).toBe(0);
  });
});
