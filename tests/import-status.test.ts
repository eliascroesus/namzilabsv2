import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { backfillJobs, sourceStreams, syncState } from "@/db/schema";
import { closeImportProgress } from "@/connectors/close";
import { connectionImportStatus, connectionImportStatuses } from "@/lib/sync/import-status";
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

  it("an import that ENDED without finishing never claims completion", async () => {
    // The strongest claim in the product ("History imported — this is
    // everything") was being made for a run that hit its row ceiling or died
    // mid-import. Sabotage: treat "no open job" as done and this says done.
    const id = await seedConnection(db, { orgId: ORG, source: "calendly" });
    const [stream] = await db
      .insert(sourceStreams)
      .values({ orgId: ORG, connectionId: id, configHash: "h", config: {}, status: "active" })
      .returning({ id: sourceStreams.id });
    await db.insert(backfillJobs).values({
      orgId: ORG,
      connectionId: id,
      streamId: stream.id,
      streamHash: "h",
      status: "partial",
      targetFloor: new Date(Date.now() - 90 * DAY),
      reachedFloor: new Date(Date.now() - 30 * DAY),
      rowCeiling: 25_000,
    });

    const status = await connectionImportStatus(db, ORG, id);
    expect(status.state).not.toBe("done");
    expect(status.note).toMatch(/didn't finish/);
  });

  it("a stream source with NO job at all stays silent — mirrors never get one", async () => {
    // Sheets is a mirror: it re-reads the whole resource every sweep and is
    // never given a backfill job. "No job" is no evidence, not completion.
    const id = await seedConnection(db, { orgId: ORG, source: "gsheets" });
    await db.insert(sourceStreams).values({ orgId: ORG, connectionId: id, configHash: "h", config: {}, status: "active" });
    const status = await connectionImportStatus(db, ORG, id);
    expect(status.state).toBe("unknown");
    expect(status.note).toBeUndefined();
  });

  it("a mid-first-walk cursor with no coverage fields reads importing, not done", async () => {
    // The JSON-while-walking shape without the coverage fields — a cursor
    // written before they existed, and the shape any paging source that
    // measures nothing stores. `hw: null` still says the FIRST window is
    // walking, so we can say THAT much even without a percentage; the old
    // code read it as finished — backwards.
    const id = await seedConnection(db, { orgId: ORG, source: "close" });
    await db.insert(syncState).values({ connectionId: id, cursor: JSON.stringify({ hw: null, cont: "c1" }) });
    const status = await connectionImportStatus(db, ORG, id);
    expect(status.state).toBe("importing");
    expect(status.coverage).toBeUndefined(); // honest: no percentage to give
  });

  it("answers many connections at once, org-walled", async () => {
    const mine = await seedConnection(db, { orgId: ORG, source: "close" });
    const alsoMine = await seedConnection(db, { orgId: ORG, source: "close" });
    const foreign = await seedConnection(db, { orgId: "org_other", source: "close" });
    await db.insert(syncState).values({ connectionId: mine, cursor: new Date().toISOString() });

    const map = await connectionImportStatuses(db, ORG, [mine, alsoMine, foreign]);
    expect(map.get(mine)?.state).toBe("done");
    expect(map.get(alsoMine)?.state).toBe("unknown");
    expect(map.has(foreign)).toBe(false); // another workspace is not ours to report on
  });

  it("is org-walled: another workspace's connection reads unknown, never its progress", async () => {
    const id = await seedConnection(db, { orgId: "org_other", source: "close" });
    await db.insert(syncState).values({ connectionId: id, cursor: new Date().toISOString() });
    expect((await connectionImportStatus(db, ORG, id)).state).toBe("unknown");
  });
});
