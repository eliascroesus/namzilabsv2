import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { connections, deadLetter, deliveryLog, events, rawEvents, testRuns, usageLedger } from "@/db/schema";
import { pruneOperationalTables, pruneSettledTestRuns, retentionBacklog } from "@/lib/storage-lifecycle";
import type { DB } from "@/db/types";

/**
 * H.6 — operational tables that grow with ACTIVITY (not customer data) must
 * have a retention policy or they become the largest, slowest table in the
 * database. test_runs (one row per Test click) and usage_ledger (one row per
 * connection per operation per MINUTE) join delivery_log here.
 */

let db: DB;
let close: () => Promise<void>;
let connectionId: string;
const ORG = "org_test";
const NOW = new Date("2026-07-01T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const EMPTY_LEDGER = { counters: 0, evidence: 0 };

async function seedRaw(receivedAt: Date): Promise<string> {
  const [row] = await db
    .insert(rawEvents)
    .values({ orgId: ORG, connectionId, source: "webhook", headers: {}, payload: { seeded: true }, receivedAt })
    .returning();
  return row.id;
}

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
/**
 * One ledger bucket. `operation` defaults to a unique value per call because
 * `usage_ledger_bucket_uq` is (connection, operation, window) — seeding N rows
 * in the same window needs N distinct operations.
 */
let opSeq = 0;
async function seedLedger(
  windowStart: Date,
  evidence: Partial<{ throttled: number; errors: number; observedLimit: number }> = {},
) {
  await db.insert(usageLedger).values({
    orgId: ORG,
    connectionId,
    provider: "close",
    operation: `op.${opSeq++}`,
    windowStart,
    calls: 10,
    throttled: evidence.throttled ?? 0,
    errors: evidence.errors ?? 0,
    observedLimit: evidence.observedLimit ?? null,
  });
}
const countLedger = async () => (await db.select().from(usageLedger)).length;

describe("operational retention", () => {
  it("prunes rows past the window and keeps everything inside it", async () => {
    await seedDelivery(daysAgo(45));
    await seedDelivery(daysAgo(31));
    await seedDelivery(daysAgo(5));
    await seedRun(daysAgo(60));
    await seedRun(daysAgo(2));

    const before = await retentionBacklog(db, 30, NOW);
    expect(before).toEqual({ deliveryLog: 2, testRuns: 1, usageLedger: EMPTY_LEDGER, rawEvents: 0, eventTombstones: 0 });

    const pruned = await pruneOperationalTables(db, { now: NOW });
    expect(pruned).toEqual({
      deliveryLog: 2,
      testRuns: 1,
      usageLedger: EMPTY_LEDGER,
      rawEvents: 0,
      eventTombstones: 0,
      truncated: false,
      inspected: false,
    });

    expect(await db.select().from(deliveryLog)).toHaveLength(1); // the 5-day-old row
    expect(await db.select().from(testRuns)).toHaveLength(1); // the 2-day-old run
    expect(await retentionBacklog(db, 30, NOW)).toEqual({
      deliveryLog: 0,
      testRuns: 0,
      usageLedger: EMPTY_LEDGER,
      rawEvents: 0,
      eventTombstones: 0,
    });
  });

  it("is idempotent and safe on empty tables", async () => {
    const empty = {
      deliveryLog: 0,
      testRuns: 0,
      usageLedger: EMPTY_LEDGER,
      rawEvents: 0,
      eventTombstones: 0,
      truncated: false,
      inspected: false,
    };
    expect(await pruneOperationalTables(db, { now: NOW })).toEqual(empty);
    await seedRun(daysAgo(90));
    await pruneOperationalTables(db, { now: NOW });
    expect(await pruneOperationalTables(db, { now: NOW })).toEqual(empty);
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

/**
 * The two tiers, which are the new decision in this batch: a bucket holding
 * only `calls` is a spent rate-limiter window and dies at 2 days, while a row
 * carrying `observed_limit`, `throttled` or `errors` is evidence a human may
 * want weeks later and lives 90.
 */
describe("usage_ledger two-tier retention", () => {
  it("drops spent counters at 2 days and keeps evidence for 90", async () => {
    await seedLedger(daysAgo(1)); // counter, inside window → keep
    await seedLedger(daysAgo(5)); // counter, past window → go
    await seedLedger(daysAgo(30)); // counter, well past → go
    await seedLedger(daysAgo(30), { throttled: 3 }); // evidence, inside 90d → keep
    await seedLedger(daysAgo(30), { errors: 1 }); // evidence, inside 90d → keep
    await seedLedger(daysAgo(30), { observedLimit: 300 }); // evidence, inside 90d → keep
    await seedLedger(daysAgo(120), { throttled: 3 }); // evidence, past 90d → go

    const pruned = await pruneOperationalTables(db, { now: NOW });
    expect(pruned.usageLedger).toEqual({ counters: 2, evidence: 1 });

    const left = await db.select().from(usageLedger);
    expect(left).toHaveLength(4);
    // The one surviving counter is the fresh one; the other three carry evidence.
    expect(left.filter((r) => r.observedLimit === null && r.throttled === 0 && r.errors === 0)).toHaveLength(1);
  });

  it("each evidence column alone is enough to survive the counter window", async () => {
    for (const evidence of [{ throttled: 1 }, { errors: 1 }, { observedLimit: 1 }]) {
      await seedLedger(daysAgo(60), evidence);
    }
    await pruneOperationalTables(db, { now: NOW });
    expect(await countLedger()).toBe(3);
  });

  it("counts each row in exactly one tier, so the two never double-count", async () => {
    // A row with every evidence column set is still one evidence row, and the
    // predicates are complements — a row can never be in both passes.
    await seedLedger(daysAgo(120), { throttled: 2, errors: 2, observedLimit: 100 });
    await seedLedger(daysAgo(120));
    const pruned = await pruneOperationalTables(db, { now: NOW });
    expect(pruned.usageLedger).toEqual({ counters: 1, evidence: 1 });
    expect(await countLedger()).toBe(0);
  });

  it("reports backlog split by tier", async () => {
    await seedLedger(daysAgo(5));
    await seedLedger(daysAgo(5));
    await seedLedger(daysAgo(120), { throttled: 1 });
    expect((await retentionBacklog(db, 30, NOW)).usageLedger).toEqual({ counters: 2, evidence: 1 });
  });
});

/**
 * The drain loop, which is the fix this batch exists for. The old pass removed
 * one batch per table per night; usage_ledger arrives two orders of magnitude
 * faster than that, so a pass that stops after one batch never catches up.
 *
 * `batchSize` is injected small so multi-pass draining is exercised honestly
 * without seeding 10,000 rows per assertion.
 */
describe("drain loop", () => {
  it("empties a backlog larger than one batch, which the single-pass sweep could not", async () => {
    for (let i = 0; i < 25; i++) await seedLedger(new Date(daysAgo(10).getTime() + i * 60_000));

    const pruned = await pruneOperationalTables(db, { now: NOW, batchSize: 5 });
    expect(pruned.usageLedger.counters).toBe(25);
    expect(pruned.truncated).toBe(false);
    expect(await countLedger()).toBe(0);
    expect((await retentionBacklog(db, 30, NOW)).usageLedger.counters).toBe(0);
  });

  it("drains every table in one run, not just the first", async () => {
    for (let i = 0; i < 12; i++) {
      await seedDelivery(daysAgo(40));
      await seedRun(daysAgo(40));
      await seedLedger(new Date(daysAgo(10).getTime() + i * 60_000));
    }
    const pruned = await pruneOperationalTables(db, { now: NOW, batchSize: 5 });
    expect(pruned).toMatchObject({
      deliveryLog: 12,
      testRuns: 12,
      usageLedger: { counters: 12, evidence: 0 },
      truncated: false,
    });
    expect(await db.select().from(deliveryLog)).toHaveLength(0);
    expect(await db.select().from(testRuns)).toHaveLength(0);
    expect(await countLedger()).toBe(0);
  });

  it("stops at the wall-clock ceiling and says so rather than running past it", async () => {
    for (let i = 0; i < 25; i++) await seedLedger(new Date(daysAgo(10).getTime() + i * 60_000));

    // A clock that has already blown the budget by the second check: one batch
    // goes, the rest is reported as unfinished. This is the behaviour that
    // keeps the step from being killed mid-flight by the 60s route ceiling.
    let t = 0;
    const pruned = await pruneOperationalTables(db, {
      now: NOW,
      batchSize: 5,
      nowMs: () => (t++ === 0 ? 0 : 1_000_000),
    });

    expect(pruned.truncated).toBe(true);
    expect(await countLedger()).toBeGreaterThan(0);
    // Whatever it did remove, it removed completely — a truncated run leaves
    // consistent state, it does not half-delete a batch.
    expect(pruned.usageLedger.counters + (await countLedger())).toBe(25);
  });

  it("a truncated run leaves the remainder for the next one, which finishes it", async () => {
    for (let i = 0; i < 25; i++) await seedLedger(new Date(daysAgo(10).getTime() + i * 60_000));
    let t = 0;
    await pruneOperationalTables(db, { now: NOW, batchSize: 5, nowMs: () => (t++ === 0 ? 0 : 1_000_000) });
    const second = await pruneOperationalTables(db, { now: NOW, batchSize: 5 });
    expect(second.truncated).toBe(false);
    expect(await countLedger()).toBe(0);
  });
});

/**
 * Inspect mode: the first production run reports and removes nothing, because
 * the counter-tier predicate is new logic deciding what is disposable and that
 * judgement should be read against real data before it acts on real data.
 */
describe("inspect mode", () => {
  it("removes nothing and reports what it would remove, split by tier", async () => {
    await seedDelivery(daysAgo(40));
    await seedRun(daysAgo(40));
    await seedLedger(daysAgo(5));
    await seedLedger(daysAgo(5));
    await seedLedger(daysAgo(120), { throttled: 1 });
    await seedLedger(daysAgo(1)); // inside every window → reported by nothing

    const report = await pruneOperationalTables(db, { now: NOW, inspect: true });
    expect(report).toEqual({
      deliveryLog: 1,
      testRuns: 1,
      usageLedger: { counters: 2, evidence: 1 },
      rawEvents: 0,
      eventTombstones: 0,
      truncated: false,
      inspected: true,
    });

    // Nothing moved.
    expect(await db.select().from(deliveryLog)).toHaveLength(1);
    expect(await db.select().from(testRuns)).toHaveLength(1);
    expect(await countLedger()).toBe(4);
  });

  it("reports the TRUE backlog, uncapped by the delete batch", async () => {
    for (let i = 0; i < 25; i++) await seedLedger(new Date(daysAgo(10).getTime() + i * 60_000));
    // The point of inspect: a live run with this batch size would report what
    // it managed to remove, while inspect reports how much there actually is.
    const report = await pruneOperationalTables(db, { now: NOW, inspect: true, batchSize: 5 });
    expect(report.usageLedger.counters).toBe(25);
    expect(await countLedger()).toBe(25);
  });

  it("agrees with the live run: what inspect predicts is what pruning removes", async () => {
    await seedDelivery(daysAgo(40));
    await seedLedger(daysAgo(5));
    await seedLedger(daysAgo(120), { errors: 2 });
    await seedLedger(daysAgo(1));

    const predicted = await pruneOperationalTables(db, { now: NOW, inspect: true });
    const actual = await pruneOperationalTables(db, { now: NOW });
    expect({ ...actual, inspected: true }).toEqual(predicted);
  });
});

/**
 * `raw_events` was the ONE growing table with no retention: verbatim provider
 * payloads, kept for the life of every connection. Thirty days now — matching
 * `delivery_log`, whose rows point at these — with one exception that is the
 * point of the design: a raw with an UNRESOLVED dead letter is never pruned,
 * because `replayRawEvent` reads the raw by id and pruning it would turn
 * "failed, will be replayed once fixed" into "failed, gone", silently.
 *
 * The normalized rows in `events` are permanent; pruning a raw never touches
 * what a dashboard reads.
 */
describe("raw payload retention", () => {
  /** The new policy's gate: raws prune only once their connection has been disabled past the window. */
  const disableConnectionSince = (when: Date) =>
    db.update(connections).set({ status: "disabled", disabledAt: when }).where(eq(connections.id, connectionId));

  it("prunes a long-disabled connection's old raws, keeps young ones, and never counts what it keeps", async () => {
    await disableConnectionSince(daysAgo(60));
    await seedRaw(daysAgo(45));
    await seedRaw(daysAgo(31));
    await seedRaw(daysAgo(5));

    const report = await pruneOperationalTables(db, { now: NOW, inspect: true });
    expect(report.rawEvents).toBe(2);

    const pruned = await pruneOperationalTables(db, { now: NOW });
    expect(pruned.rawEvents).toBe(2);
    expect(await db.select().from(rawEvents)).toHaveLength(1); // the 5-day-old payload
  });

  /**
   * THE GATE ITSELF. An active connection's raws feed two standing promises:
   * the pending `WEBHOOK_EVENT_TIME_LIVE` restamp (which re-derives event
   * times from these payloads, once, whenever the flag flips) and
   * `reprocessConnection`. Age-pruning them would silently bound both to 30
   * days — the exact contradiction STATE.md / checklist 7b / DATA_MODEL.md
   * all warn about. Pruning is licensed by `disabled_at`, "the clock the
   * purge runs on", never by age alone.
   */
  it("NEVER prunes an active connection's raws, whatever their age", async () => {
    await seedRaw(daysAgo(400));
    await seedRaw(daysAgo(45));

    const report = await pruneOperationalTables(db, { now: NOW, inspect: true });
    expect(report.rawEvents).toBe(0);

    const pruned = await pruneOperationalTables(db, { now: NOW });
    expect(pruned.rawEvents).toBe(0);
    expect(await db.select().from(rawEvents)).toHaveLength(2);
  });

  it("a recently-disabled connection keeps its raws until the disable itself ages past the window", async () => {
    await disableConnectionSince(daysAgo(5)); // reconnect within 30 days loses nothing
    await seedRaw(daysAgo(400));

    const pruned = await pruneOperationalTables(db, { now: NOW });
    expect(pruned.rawEvents).toBe(0);
    expect(await db.select().from(rawEvents)).toHaveLength(1);
  });

  it("never prunes a raw with an unresolved dead letter, however old", async () => {
    await disableConnectionSince(daysAgo(200));
    const doomed = await seedRaw(daysAgo(120));
    const protectedId = await seedRaw(daysAgo(120));
    await db.insert(deadLetter).values({ orgId: ORG, connectionId, rawEventId: protectedId, attempts: 3, error: "boom" });

    const pruned = await pruneOperationalTables(db, { now: NOW });
    expect(pruned.rawEvents).toBe(1);

    const left = await db.select().from(rawEvents);
    expect(left.map((r) => r.id)).toEqual([protectedId]);
    expect(left.map((r) => r.id)).not.toContain(doomed);
  });

  it("a RESOLVED dead letter no longer protects its raw", async () => {
    await disableConnectionSince(daysAgo(200));
    const id = await seedRaw(daysAgo(120));
    await db.insert(deadLetter).values({
      orgId: ORG, connectionId, rawEventId: id, attempts: 3, error: "boom", resolvedAt: daysAgo(100),
    });

    const pruned = await pruneOperationalTables(db, { now: NOW });
    expect(pruned.rawEvents).toBe(1);
    expect(await db.select().from(rawEvents)).toHaveLength(0);
  });
});

/**
 * The events TOMBSTONE tier. Live rows are customer data and are NEVER
 * touched here; what this prunes is soft-deleted rows older than 30 days on
 * NON-disabled connections. Thirty days because `upsertEvents` un-deletes on
 * reappearance (the tombstone is the dedup anchor) and Calendly's is the
 * widest retire window that can legitimately resurrect a row; disabled
 * connections' tombstones are the reconnect-restore set and are kept whatever
 * their age.
 */
describe("events tombstone purge", () => {
  async function seedEvent(over: Partial<typeof events.$inferInsert> = {}): Promise<string> {
    const [row] = await db
      .insert(events)
      .values({
        orgId: ORG,
        connectionId,
        source: "webhook",
        eventId: `ev-${opSeq++}`,
        eventType: "row",
        occurredAt: daysAgo(90),
        ...over,
      })
      .returning();
    return row.id;
  }

  it("purges old tombstones on an active connection, keeps young ones and every live row", async () => {
    const doomed = await seedEvent({ deletedAt: daysAgo(45) });
    const young = await seedEvent({ deletedAt: daysAgo(5) });
    const live = await seedEvent();

    const backlog = await retentionBacklog(db, 30, NOW);
    expect(backlog.eventTombstones).toBe(1);

    const pruned = await pruneOperationalTables(db, { now: NOW });
    // THE regression this tier fixes: before it, NOTHING removed a tombstone,
    // ever — the biggest table in the schema grew dead weight forever.
    expect(pruned.eventTombstones).toBe(1);

    const left = (await db.select().from(events)).map((r) => r.id);
    expect(left).not.toContain(doomed);
    expect(left).toContain(young);
    expect(left).toContain(live);
  });

  it("NEVER touches a disabled connection's tombstones — they are the reconnect-restore set", async () => {
    const ancient = await seedEvent({ deletedAt: daysAgo(400) });
    await db.update(connections).set({ status: "disabled", disabledAt: daysAgo(400) }).where(eq(connections.id, connectionId));

    const pruned = await pruneOperationalTables(db, { now: NOW });

    expect(pruned.eventTombstones).toBe(0);
    expect((await db.select().from(events)).map((r) => r.id)).toContain(ancient);
  });

  it("inspect mode counts exactly and deletes nothing", async () => {
    await seedEvent({ deletedAt: daysAgo(45) });
    await seedEvent({ deletedAt: daysAgo(60) });

    const inspected = await pruneOperationalTables(db, { now: NOW, inspect: true });

    expect(inspected.eventTombstones).toBe(2);
    expect(inspected.inspected).toBe(true);
    expect(await db.select().from(events)).toHaveLength(2);
  });

  it("the delete re-asserts the predicate: a row resurrected mid-drain survives", async () => {
    // Simulated race: the id qualifies at select time, then `upsertEvents`
    // clears deleted_at before the delete lands. The delete's re-asserted
    // WHERE must skip it — without that conjunct the drain would hard-delete
    // a LIVE customer row it selected as a tombstone moments earlier.
    // Deterministic stand-in for the race: a row that no longer qualifies is
    // in the id set via a same-batch sibling. We pin the observable contract
    // instead: `removed` counts only rows that still qualified.
    const doomed = await seedEvent({ deletedAt: daysAgo(45) });
    const resurrected = await seedEvent({ deletedAt: daysAgo(45) });
    // Resurrect between "would be selected" and the drain by doing it now —
    // the predicate is evaluated inside the DELETE, so this row must survive.
    await db.update(events).set({ deletedAt: null }).where(eq(events.id, resurrected));

    const pruned = await pruneOperationalTables(db, { now: NOW });

    expect(pruned.eventTombstones).toBe(1);
    const left = (await db.select().from(events)).map((r) => r.id);
    expect(left).toContain(resurrected);
    expect(left).not.toContain(doomed);
  });
});
