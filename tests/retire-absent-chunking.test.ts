import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { connections, events, sourceStreams } from "@/db/schema";
import { syncStream } from "@/lib/sync/streams";
import { registerConnector } from "@/connectors/registry";
import type { CanonicalEvent, Connector } from "@/connectors/types";
import type { DB } from "@/db/types";

/**
 * `retireAbsent` — the mirror's "everything absent is gone" pass — used to be
 * ONE statement with a bind parameter per present row: a 50,000-row sheet was
 * a 50,000-parameter UPDATE every sweep, and past Postgres's 65,535-bind wire
 * limit (~a 70k-row tab) the sweep hard-failed, permanently, on a sheet size
 * a customer can reach by pasting.
 *
 * The fix is read–diff–write with the retire chunked by primary key — and NOT
 * a chunked `NOT IN`, which is the trap these tests permanently guard: a row
 * absent from chunk 1 but present in chunk 2 would be retired by the chunk-1
 * pass, tombstoning live data.
 */

const ORG = "org_retire";
const HASH = "hash-retire";

let db: DB;
let close: () => Promise<void>;
let connId: string;

/** What the next poll returns; each test writes this. */
let PRESENT: CanonicalEvent[] = [];

const rec = (i: number): CanonicalEvent => ({
  eventId: `mirror:${i}`,
  eventType: "row",
  occurredAt: new Date("2026-06-01T00:00:00Z"),
  properties: { i },
});

const mirrorStub: Connector = {
  source: "gsheets",
  authType: "none",
  verifySignature: () => true,
  poll: async () => ({ records: PRESENT, nextCursor: null }),
};

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  registerConnector(mirrorStub);
  connId = await seedConnection(db, { orgId: ORG, source: "gsheets" });
});
afterEach(async () => {
  await close();
  registerConnector((await import("@/connectors/google-sheets")).googleSheetsConnector);
});

async function seedLive(count: number): Promise<void> {
  const rows = Array.from({ length: count }, (_, i) => ({
    orgId: ORG,
    connectionId: connId,
    source: "gsheets",
    streamHash: HASH,
    eventId: `mirror:${i}`,
    eventType: "row",
    occurredAt: new Date("2026-06-01T00:00:00Z"),
    properties: { i },
  }));
  for (let i = 0; i < rows.length; i += 1_000) await db.insert(events).values(rows.slice(i, i + 1_000));
}

async function runMirrorSweep() {
  const [conn] = await db.select().from(connections).where(eq(connections.id, connId));
  const [stream] = await db
    .insert(sourceStreams)
    .values({ orgId: ORG, connectionId: connId, configHash: HASH, config: {} })
    .onConflictDoNothing({ target: [sourceStreams.connectionId, sourceStreams.configHash] })
    .returning();
  const row = stream ?? (await db.select().from(sourceStreams).where(eq(sourceStreams.connectionId, connId)))[0];
  return syncStream(db, conn, row, 5);
}

async function liveIds(): Promise<Set<string>> {
  const rows = await db
    .select({ eventId: events.eventId })
    .from(events)
    .where(and(eq(events.connectionId, connId), eq(events.streamHash, HASH), isNull(events.deletedAt)));
  return new Set(rows.map((r) => r.eventId));
}

describe("retireAbsent across chunk boundaries", () => {
  it("retires exactly the absent rows when present and absent interleave across chunks", async () => {
    // 1,300 live rows; the poll returns the 650 EVEN ones. Interleaved, so any
    // naive chunked NOT-IN would see "absent from this chunk's slice" for rows
    // that are present overall and retire live data.
    await seedLive(1_300);
    PRESENT = Array.from({ length: 650 }, (_, k) => rec(k * 2));

    const res = await runMirrorSweep();

    expect(res.softDeleted).toBe(650);
    const live = await liveIds();
    expect(live.size).toBe(650);
    for (let k = 0; k < 650; k++) {
      expect(live.has(`mirror:${k * 2}`)).toBe(true);
      expect(live.has(`mirror:${k * 2 + 1}`)).toBe(false);
    }
  });

  it("a second identical sweep retires nothing (idempotent)", async () => {
    await seedLive(20);
    PRESENT = Array.from({ length: 10 }, (_, k) => rec(k));
    expect((await runMirrorSweep()).softDeleted).toBe(10);
    expect((await runMirrorSweep()).softDeleted).toBe(0);
  });

  it("survives a present set past the 65,535 wire-protocol bind limit", async () => {
    // The old single statement bound one parameter PER PRESENT ROW — 70,001
    // params here, past the Int16 wire limit, a hard failure before a single
    // row was compared. The present set must never reach a statement's
    // parameter list; only the ids being retired may, in bounded chunks.
    await seedLive(100); // 50 of these are absent from the poll
    PRESENT = Array.from({ length: 70_000 }, (_, i) => rec(i + 50));

    const res = await runMirrorSweep();

    // Rows 0..49 are absent from the present set → retired; 50..99 kept.
    expect(res.softDeleted).toBe(50);
    const live = await liveIds();
    expect(live.has("mirror:49")).toBe(false);
    expect(live.has("mirror:50")).toBe(true);
  }, 120_000);
});
