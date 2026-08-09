import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { backfillJobs, sourceStreams, syncState } from "@/db/schema";
import { closeImportProgress } from "@/connectors/close";
import { connectionImportStatus } from "@/lib/sync/import-status";
import type { DB } from "@/db/types";

/**
 * "Is this source still pulling history?" answered from stored state alone.
 *
 * The rule that shapes every case below: `unknown` must say NOTHING. A
 * connection nobody has polled has not finished importing — it has never
 * started — and a UI that renders "History imported" there is lying with a
 * green tick.
 */

const DAY = 86_400_000;
const NOW = Date.parse("2026-08-01T12:00:00Z");

describe("closeImportProgress", () => {
  it("reports coverage while the first window is still walking", () => {
    const cursor = JSON.stringify({
      hw: null,
      cont: "c1",
      maxSeen: null,
      floor: new Date(NOW - 30 * DAY).toISOString(),
      covLo: new Date(NOW - 12 * DAY).toISOString(),
      covHi: new Date(NOW).toISOString(),
    });
    const p = closeImportProgress(cursor, NOW)!;
    expect(p).toBeTruthy();
    expect(Math.round(p.targetMs / DAY)).toBe(30);
    expect(Math.round(p.coveredMs / DAY)).toBe(12);
  });

  it("says nothing once a window has drained — a steady-state overlap is not progress", () => {
    // Sabotage: report whenever a cursor exists and every healthy Close
    // connection permanently claims "covering 0 of 1 days".
    const drained = JSON.stringify({ hw: new Date(NOW).toISOString(), cont: null, maxSeen: null, covLo: null, covHi: null });
    expect(closeImportProgress(drained)).toBeNull();
    // The bare-string form IS the drained form.
    expect(closeImportProgress(new Date(NOW).toISOString())).toBeNull();
  });

  it("says nothing when there is no cursor — never polled is not finished", () => {
    expect(closeImportProgress(null)).toBeNull();
  });
});

describe("connectionImportStatus", () => {
  let db: DB;
  let close: () => Promise<void>;
  const ORG = "org_imp";

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => {
    await close();
  });

  it("close: a mid-walk cursor reads as importing, with days covered", async () => {
    const id = await seedConnection(db, { orgId: ORG, source: "close" });
    await db.insert(syncState).values({
      connectionId: id,
      cursor: JSON.stringify({
        hw: null,
        cont: "c1",
        maxSeen: null,
        floor: new Date(Date.now() - 30 * DAY).toISOString(),
        covLo: new Date(Date.now() - 5 * DAY).toISOString(),
        covHi: new Date().toISOString(),
      }),
    });

    const status = await connectionImportStatus(db, ORG, id);
    expect(status.state).toBe("importing");
    expect(status.note).toMatch(/covering \d+ of 30 days/);
  });

  it("close: a drained cursor reads as done", async () => {
    const id = await seedConnection(db, { orgId: ORG, source: "close" });
    await db.insert(syncState).values({ connectionId: id, cursor: new Date().toISOString() });
    expect((await connectionImportStatus(db, ORG, id)).state).toBe("done");
  });

  it("no cursor and no jobs reads as UNKNOWN, never done", async () => {
    const id = await seedConnection(db, { orgId: ORG, source: "close" });
    const status = await connectionImportStatus(db, ORG, id);
    expect(status.state).toBe("unknown");
    expect(status.note).toBeUndefined(); // silence, not a claim
  });

  it("stream sources: an open backfill job is the import; only terminal jobs mean done", async () => {
    const id = await seedConnection(db, { orgId: ORG, source: "calendly" });
    const [stream] = await db
      .insert(sourceStreams)
      .values({ orgId: ORG, connectionId: id, configHash: "hash1", config: {}, status: "active" })
      .returning({ id: sourceStreams.id });

    const targetFloor = new Date(Date.now() - 90 * DAY);
    await db.insert(backfillJobs).values({
      orgId: ORG,
      connectionId: id,
      streamId: stream.id,
      streamHash: "hash1",
      status: "running",
      targetFloor,
      reachedFloor: new Date(Date.now() - 20 * DAY),
      rowCeiling: 25_000,
    });
    const importing = await connectionImportStatus(db, ORG, id);
    expect(importing.state).toBe("importing");
    expect(importing.note).toMatch(/covering 20 of 90 days/);

    await db.update(backfillJobs).set({ status: "complete" });
    expect((await connectionImportStatus(db, ORG, id)).state).toBe("done");
  });

  it("is org-walled: another workspace's connection reads unknown, never its progress", async () => {
    const id = await seedConnection(db, { orgId: "org_other", source: "close" });
    await db.insert(syncState).values({ connectionId: id, cursor: new Date().toISOString() });
    expect((await connectionImportStatus(db, ORG, id)).state).toBe("unknown");
  });
});
