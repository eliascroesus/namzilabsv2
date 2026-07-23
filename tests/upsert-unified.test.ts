import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { upsertEvents } from "@/ingestion/pipeline";
import { events, connections } from "@/db/schema";
import type { CanonicalEvent } from "@/connectors/types";
import type { DB } from "@/db/types";

/**
 * The unified upsert — THE single events writer. Every sync path (webhook,
 * cursor walk, mirror pass) funnels through it, so its field semantics are the
 * data-accuracy contract:
 *
 *   updatable:   eventType, subject, value, currency, properties, streamHash,
 *                occurredAt (unless preserveOccurredAt), deletedAt := null,
 *                syncGeneration := GREATEST(stored, incoming)
 *   insert-only: receivedAt, rawEventId, id, orgId, connectionId, source
 *   deleted:     narrow update — ONLY deletedAt + generation, never the payload
 */

let db: DB;
let close: () => Promise<void>;
let connectionId: string;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  connectionId = await seedConnection(db, { source: "webhook" });
});
afterEach(async () => {
  await close();
});

const META = () => ({ orgId: "org_test", connectionId, source: "webhook" });

const rec = (id: string, over: Partial<CanonicalEvent> = {}): CanonicalEvent => ({
  eventId: `u:${id}`,
  eventType: "lead",
  subject: "s1",
  occurredAt: new Date("2026-01-01T00:00:00Z"),
  value: 10,
  currency: "USD",
  properties: { id },
  ...over,
});

const row = async (id: string) => (await db.select().from(events).where(eq(events.eventId, `u:${id}`)))[0];

describe("unified upsert — field matrix", () => {
  it("refreshes every updatable field on conflict; provenance fields are insert-only", async () => {
    await upsertEvents(db, { ...META(), rawEventId: null, streamHash: "h1" }, [rec("a")]);
    const before = await row("a");

    const res = await upsertEvents(db, { ...META(), streamHash: "h2" }, [
      rec("a", { eventType: "deal", subject: "s2", value: 99, currency: "EUR", occurredAt: new Date("2026-02-02T00:00:00Z"), properties: { id: "a", stage: "won" } }),
    ]);
    expect(res).toEqual({ inserted: 0, updated: 1, deduped: 1, total: 1 });

    const after = await row("a");
    expect(after.eventType).toBe("deal");
    expect(after.subject).toBe("s2");
    expect(after.value).toBe("99");
    expect(after.currency).toBe("EUR");
    expect(after.occurredAt.toISOString()).toBe("2026-02-02T00:00:00.000Z");
    expect((after.properties as Record<string, unknown>).stage).toBe("won");
    expect(after.streamHash).toBe("h2");
    // Insert-only: identity + provenance never churn.
    expect(after.id).toBe(before.id);
    expect(after.receivedAt.toISOString()).toBe(before.receivedAt.toISOString());
    expect(after.rawEventId).toBe(before.rawEventId);
    expect(after.orgId).toBe(before.orgId);
  });

  it("preserveOccurredAt keeps the stored (first-seen) timestamp while everything else refreshes", async () => {
    await upsertEvents(db, { ...META(), preserveOccurredAt: true }, [rec("a", { occurredAt: new Date("2026-01-01T00:00:00Z") })]);
    await upsertEvents(db, { ...META(), preserveOccurredAt: true }, [
      rec("a", { occurredAt: new Date("2026-03-03T00:00:00Z"), properties: { id: "a", edited: true } }),
    ]);
    const r = await row("a");
    expect(r.occurredAt.toISOString()).toBe("2026-01-01T00:00:00.000Z"); // kept
    expect((r.properties as Record<string, unknown>).edited).toBe(true); // refreshed
  });

  it("syncGeneration only ratchets up (GREATEST): a gen-0 webhook redelivery can't downgrade a poll-managed row", async () => {
    await upsertEvents(db, { ...META(), generation: 5 }, [rec("a")]);
    await upsertEvents(db, META(), [rec("a")]); // webhook redelivery, gen 0
    expect((await row("a")).syncGeneration).toBe(5);
    await upsertEvents(db, { ...META(), generation: 7 }, [rec("a")]);
    expect((await row("a")).syncGeneration).toBe(7);
  });

  it("re-seen ⇒ alive: an upsert resurrects a soft-deleted row", async () => {
    await upsertEvents(db, META(), [rec("a")]);
    await db.update(events).set({ deletedAt: new Date() }).where(eq(events.eventId, "u:a"));
    await upsertEvents(db, META(), [rec("a")]);
    expect((await row("a")).deletedAt).toBeNull();
  });

  it("deleted records are NARROW updates: deletedAt set, stored payload never clobbered by the skeleton", async () => {
    await upsertEvents(db, META(), [rec("a", { properties: { id: "a", summary: "Standup", attendees: 4 } })]);
    const res = await upsertEvents(db, { ...META(), generation: 3 }, [
      rec("a", { eventType: "cancelled-skeleton", subject: null, properties: {}, deleted: true }),
    ]);
    expect(res.updated).toBe(1);
    const r = await row("a");
    expect(r.deletedAt).not.toBeNull();
    expect(r.syncGeneration).toBe(3);
    // The cancellation skeleton must not wipe what we know about the event.
    expect(r.eventType).toBe("lead");
    expect((r.properties as Record<string, unknown>).summary).toBe("Standup");
  });

  it("a never-seen deletion inserts as an invisible tombstone (idempotent cancellation)", async () => {
    const res = await upsertEvents(db, META(), [rec("ghost", { deleted: true })]);
    expect(res.inserted).toBe(1);
    const r = await row("ghost");
    expect(r.deletedAt).not.toBeNull(); // exists, but never visible to flows
  });

  it("chunks large batches (>500) in one call and counts inserts vs updates exactly", async () => {
    const batch = Array.from({ length: 1201 }, (_, i) => rec(`b${i}`));
    const first = await upsertEvents(db, META(), batch);
    expect(first).toEqual({ inserted: 1201, updated: 0, deduped: 0, total: 1201 });
    const second = await upsertEvents(db, META(), batch);
    expect(second).toEqual({ inserted: 0, updated: 1201, deduped: 1201, total: 1201 });
    expect(await db.select().from(events)).toHaveLength(1201);
  });

  it("intra-batch duplicate eventIds collapse, last one wins (Postgres would reject the raw batch)", async () => {
    const res = await upsertEvents(db, META(), [
      rec("a", { properties: { id: "a", v: 1 } }),
      rec("a", { properties: { id: "a", v: 2 } }),
    ]);
    expect(res.inserted).toBe(1);
    expect(res.total).toBe(2);
    expect((await row("a")).properties).toEqual({ id: "a", v: 2 });
  });

  it("bumps the connection's lastEventAt only when something NEW arrived", async () => {
    await upsertEvents(db, META(), [rec("a")]);
    const [c1] = await db.select().from(connections).where(eq(connections.id, connectionId));
    expect(c1.lastEventAt).not.toBeNull();

    await db.update(connections).set({ lastEventAt: null }).where(eq(connections.id, connectionId));
    await upsertEvents(db, META(), [rec("a")]); // pure refresh
    const [c2] = await db.select().from(connections).where(eq(connections.id, connectionId));
    expect(c2.lastEventAt).toBeNull();
  });
});
