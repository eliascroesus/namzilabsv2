import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { backfillJobs, connections, deadLetter, events, sourceStreams } from "@/db/schema";
import { scanInvariants } from "@/lib/health/invariants";
import type { DB } from "@/db/types";

/**
 * 10(b) — THE SCAN THAT ASKS WHETHER WORK IS STILL HAPPENING.
 *
 * Everything else in this codebase asks "did this piece of work succeed?", and
 * nothing was asking "is any work reaching the question?" Migration 0012 is the
 * proof: it was skipped, `withConnectionSyncLock` threw on every sync entry
 * point for weeks, and the suite stayed green the whole time because no test and
 * no monitor was watching for absence.
 *
 * So each case below removes the SIGNAL rather than breaking the code — a stream
 * that stops being polled, a backfill that stops moving, a payload that stops
 * being processed — and asserts the scan notices. None of those write an error
 * anywhere.
 */

const ORG = "org_scan";
const DAY = 86_400_000;
const HOUR = 3_600_000;

let db: DB;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

async function connection(over: Partial<typeof connections.$inferInsert> = {}) {
  const [c] = await db
    .insert(connections)
    .values({ orgId: ORG, source: "gsheets", name: "Sheet", status: "active", authType: "oauth2", ...over })
    .returning();
  return c;
}

async function stream(connectionId: string, over: Partial<typeof sourceStreams.$inferInsert> = {}) {
  const [s] = await db
    .insert(sourceStreams)
    .values({
      orgId: ORG,
      connectionId,
      configHash: `h${Math.random().toString(36).slice(2)}`,
      config: {},
      lastPolledAt: new Date(),
      ...over,
    })
    .returning();
  return s;
}

/** One live row for a stream, so a mirror does not read as empty. */
async function row(connectionId: string, streamHash: string) {
  await db.insert(events).values({
    eventId: `e${Math.random()}`,
    orgId: ORG,
    connectionId,
    source: "gsheets",
    eventType: "row_added",
    occurredAt: new Date(),
    streamHash,
    properties: {},
  });
}

describe("a stream that has stopped being polled", () => {
  it("is reported, though nothing anywhere recorded an error", async () => {
    const conn = await connection();
    const fresh = await stream(conn.id);
    const stale = await stream(conn.id, { lastPolledAt: new Date(Date.now() - 2 * DAY) });
    await row(conn.id, fresh.configHash);
    await row(conn.id, stale.configHash);

    const report = await scanInvariants(db);

    expect(report.unsweptStreams.map((s) => s.streamId)).toEqual([stale.id]);
    // The stream itself still says "active" with no error — which is exactly why
    // absence needs its own check.
    const [row0] = await db.select().from(sourceStreams).where(eq(sourceStreams.id, stale.id));
    expect(row0.status).toBe("active");
    expect(row0.lastError).toBeNull();
  });

  it("counts a stream that was never polled at all, once it is old enough", async () => {
    const conn = await connection();
    // Created two days ago and never visited: the same failure, arriving before
    // there is a timestamp to go stale.
    const never = await stream(conn.id, { lastPolledAt: null, createdAt: new Date(Date.now() - 2 * DAY) });
    // …and a stream created a minute ago is not late yet.
    await stream(conn.id, { lastPolledAt: null });

    const report = await scanInvariants(db);
    expect(report.unsweptStreams.map((s) => s.streamId)).toEqual([never.id]);
  });

  /**
   * A paused connection not being polled is the system working. Reporting it
   * would bury the case this check exists for under the noise of every
   * rate-limited account.
   */
  it("does not report a stream whose connection is deliberately not being polled", async () => {
    const paused = await connection({ pausedUntil: new Date(Date.now() + HOUR), pausedReason: "provider limit" });
    const disabled = await connection({ status: "disabled", disabledAt: new Date() });
    const errored = await connection({ status: "error" });
    for (const c of [paused, disabled, errored]) await stream(c.id, { lastPolledAt: new Date(Date.now() - 2 * DAY) });
    // …and a stream we retired ourselves.
    const active = await connection();
    await stream(active.id, { status: "disabled", lastPolledAt: new Date(Date.now() - 2 * DAY) });

    expect((await scanInvariants(db)).unsweptStreams).toEqual([]);
  });

  it("reports again once a pause has expired", async () => {
    const conn = await connection({ pausedUntil: new Date(Date.now() - HOUR), pausedReason: "provider limit" });
    const s = await stream(conn.id, { lastPolledAt: new Date(Date.now() - 2 * DAY) });
    await row(conn.id, s.configHash);

    expect((await scanInvariants(db)).unsweptStreams.map((r) => r.streamId)).toEqual([s.id]);
  });
});

describe("a connection failing on a streak", () => {
  it("borrows the breaker's own counter rather than inventing a second one", async () => {
    const healthy = await connection({ consecutiveFailures: 2 });
    const failing = await connection({ consecutiveFailures: 9, lastError: "429 from provider" });
    await stream(healthy.id);
    await stream(failing.id);

    const report = await scanInvariants(db);
    expect(report.failingConnections.map((c) => c.connectionId)).toEqual([failing.id]);
    expect(report.failingConnections[0].failures).toBe(9);
  });

  it("leaves a disconnected connection alone", async () => {
    await connection({ consecutiveFailures: 9, disabledAt: new Date() });
    expect((await scanInvariants(db)).failingConnections).toEqual([]);
  });
});

describe("a backfill that says running and is not", () => {
  it("is caught by its checkpoint clock, which is the only thing that can", async () => {
    const conn = await connection({ source: "calendly" });
    // One job per (stream, target floor), so two jobs need two streams.
    const a = await stream(conn.id);
    const b = await stream(conn.id);
    const job = (s: typeof a, lastProgressAt: Date, rowsImported = 0) => ({
      orgId: ORG,
      connectionId: conn.id,
      streamId: s.id,
      streamHash: s.configHash,
      targetFloor: new Date(Date.now() - 90 * DAY),
      rowCeiling: 25_000,
      status: "running" as const,
      lastProgressAt,
      rowsImported,
    });
    const [moving] = await db.insert(backfillJobs).values(job(a, new Date(Date.now() - HOUR))).returning();
    const [wedged] = await db.insert(backfillJobs).values(job(b, new Date(Date.now() - 12 * HOUR), 400)).returning();

    const report = await scanInvariants(db);
    expect(report.stalledBackfills.map((j) => j.jobId)).toEqual([wedged.id]);
    expect(report.stalledBackfills[0].rowsImported).toBe(400);
    expect(moving.status).toBe("running"); // both look identical from `status`
  });
});

describe("payloads accepted at the door and never processed", () => {
  it("counts unresolved dead letters older than a day", async () => {
    const conn = await connection();
    const old = { orgId: ORG, connectionId: conn.id, error: "boom", attempts: 3 };
    await db.insert(deadLetter).values({ ...old, createdAt: new Date(Date.now() - 2 * DAY) });
    await db.insert(deadLetter).values({ ...old, createdAt: new Date(Date.now() - 2 * DAY), resolvedAt: new Date() });
    await db.insert(deadLetter).values(old); // fresh — still being retried

    expect((await scanInvariants(db)).unresolvedDeadLetters).toBe(1);
  });
});

/**
 * A mirror claims "stored live rows ≡ the source after every sweep", so holding
 * nothing is a claim that the spreadsheet is empty. Sometimes true — which is
 * why this reports rather than alerts — but it is also what a retire against the
 * wrong scope looks like, and what an empty payload looks like, and neither
 * writes an error.
 */
describe("a mirror holding nothing", () => {
  it("reports an emptied sheet stream and leaves an incremental one alone", async () => {
    const sheet = await connection();
    const cal = await connection({ source: "calendly" });
    const emptySheet = await stream(sheet.id, { lastPolledAt: new Date(Date.now() - 2 * HOUR) });
    const fullSheet = await stream(sheet.id, { lastPolledAt: new Date(Date.now() - 2 * HOUR) });
    const emptyCal = await stream(cal.id, { lastPolledAt: new Date(Date.now() - 2 * HOUR) });
    await row(sheet.id, fullSheet.configHash);

    const report = await scanInvariants(db);
    expect(report.emptyMirrors.map((m) => m.streamId)).toEqual([emptySheet.id]);
    expect(report.emptyMirrors.map((m) => m.streamId)).not.toContain(emptyCal.id);
  });

  it("gives a stream mid-first-sync time to land its rows", async () => {
    const conn = await connection();
    await stream(conn.id, { lastPolledAt: new Date() }); // polled a moment ago
    expect((await scanInvariants(db)).emptyMirrors).toEqual([]);
  });
});

describe("the summary flag", () => {
  it("is false on a healthy fleet and true the moment anything is found", async () => {
    const conn = await connection();
    const s = await stream(conn.id);
    await row(conn.id, s.configHash);
    expect((await scanInvariants(db)).anyFindings).toBe(false);

    await db.update(sourceStreams).set({ lastPolledAt: new Date(Date.now() - 2 * DAY) }).where(eq(sourceStreams.id, s.id));
    expect((await scanInvariants(db)).anyFindings).toBe(true);
  });
});
