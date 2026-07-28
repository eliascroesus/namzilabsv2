import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { backfillJobs, sourceStreams } from "@/db/schema";
import { compareSchema, driftBlocks } from "@/lib/schema-audit";
import type { DB } from "@/db/types";

/**
 * Phase 6, commit 1 — the schema only. No production code reads this table yet,
 * deliberately: the migration has to be applied by hand before anything depends
 * on it, and shipping the reader alongside the migration is how three columns
 * reached production unapplied with live code reading them.
 *
 * What these assert is that the CONSTRAINTS carry the design, rather than the
 * design living only in whichever function happens to write the row.
 */

const ORG = "org_backfill";
let db: DB;
let close: () => Promise<void>;
let connId = "";
let streamId = "";

const floor = (days: number) => new Date(Date.UTC(2026, 0, 1) - days * 86_400_000);

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  connId = await seedConnection(db, { orgId: ORG, source: "calendly" });
  const [s] = await db
    .insert(sourceStreams)
    .values({ orgId: ORG, connectionId: connId, configHash: "hash-a", config: { scope: "user" } })
    .returning({ id: sourceStreams.id });
  streamId = s.id;
});
afterEach(async () => {
  await close();
});

const job = (over: Partial<typeof backfillJobs.$inferInsert> = {}) => ({
  orgId: ORG,
  connectionId: connId,
  streamId,
  streamHash: "hash-a",
  targetFloor: floor(90),
  rowCeiling: 25_000,
  ...over,
});

describe("the backfill job table carries the design in its constraints", () => {
  it("applies as a migration and is reachable", async () => {
    await db.insert(backfillJobs).values(job());
    const [row] = await db.select().from(backfillJobs).where(eq(backfillJobs.streamId, streamId));
    expect(row.status).toBe("queued");
    expect(row.rowsImported).toBe(0);
    expect(row.attempts).toBe(0);
    // Null until the first checkpoint lands — "not started" and "reached the
    // beginning of time" must not look the same.
    expect(row.reachedFloor).toBeNull();
    expect(row.checkpoint).toBeNull();
  });

  /**
   * 6.1, enforced by the database rather than by whoever remembers to check.
   * A second flow on an already-backfilled stream must cost zero provider
   * calls; only a request for a DEEPER floor is new work.
   */
  it("refuses a second job for the same stream at the same depth", async () => {
    await db.insert(backfillJobs).values(job());
    await expect(db.insert(backfillJobs).values(job())).rejects.toThrow();
  });

  it("allows a deeper job, because that is genuinely new work", async () => {
    await db.insert(backfillJobs).values(job({ targetFloor: floor(90) }));
    await db.insert(backfillJobs).values(job({ targetFloor: floor(365) }));

    const rows = await db.select().from(backfillJobs).where(eq(backfillJobs.streamId, streamId));
    expect(rows).toHaveLength(2);
  });

  /**
   * A job that ended without reaching its target is a terminal SUCCESS, not an
   * error to retry forever: the provider had less history, or the ceiling was
   * hit. The row has to be able to say so and say why.
   */
  it("can record a terminal partial with a reason and a depth actually reached", async () => {
    await db.insert(backfillJobs).values(
      job({
        status: "partial",
        reachedFloor: floor(47),
        rowsImported: 25_000,
        detail: "Reached the 25,000-row ceiling for this stream.",
        finishedAt: new Date(),
      }),
    );
    const [row] = await db.select().from(backfillJobs).where(eq(backfillJobs.streamId, streamId));
    expect(row.status).toBe("partial");
    expect(row.detail).toContain("ceiling");
    // The honest number for a UI: what it got, not what it wanted.
    expect(row.reachedFloor!.getTime()).toBe(floor(47).getTime());
    expect(row.targetFloor.getTime()).toBe(floor(90).getTime());
  });

  /**
   * 10(b) scans for a job that is `running` and has not MOVED. `updated_at`
   * cannot answer that — any write touches it — so progress needs its own
   * timestamp or a stuck job is indistinguishable from a healthy one.
   */
  it("separates progress time from row-write time", async () => {
    const progressed = new Date(Date.UTC(2026, 0, 1));
    await db.insert(backfillJobs).values(job({ status: "running", lastProgressAt: progressed, checkpoint: "c1" }));

    // A later write that is not progress — an attempt counter, say.
    await db.update(backfillJobs).set({ attempts: 2, updatedAt: new Date() }).where(eq(backfillJobs.streamId, streamId));

    const [row] = await db.select().from(backfillJobs).where(eq(backfillJobs.streamId, streamId));
    expect(row.lastProgressAt!.getTime()).toBe(progressed.getTime());
    expect(row.updatedAt.getTime()).toBeGreaterThan(progressed.getTime());
  });
});

describe("the drift check knows about the new table", () => {
  it("reports a fully migrated database as clean", async () => {
    const report = await compareSchema(db);
    expect(driftBlocks(report)).toBe(false);
    expect(report.missingTables).toEqual([]);
  });

  /**
   * The whole reason this migration ships on its own: until it is applied by
   * hand, the drift check must say so loudly rather than the first query
   * throwing in production.
   */
  it("reports the table as missing when the migration has not been applied", async () => {
    await db.execute(await import("drizzle-orm").then((m) => m.sql`drop table backfill_jobs`));

    const report = await compareSchema(db);
    expect(report.missingTables).toEqual(["backfill_jobs"]);
    expect(driftBlocks(report)).toBe(true);
  });
});
