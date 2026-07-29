import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { backfillJobs, connections, events, sourceStreams, usageLedger } from "@/db/schema";
import { encrypt } from "@/lib/crypto";
import { registerConnector } from "@/connectors/registry";
import { laneLimit, claimCalls } from "@/lib/provider-gateway/budget";
import {
  checkpointJob,
  finishJob,
  nextRunnableJob,
  requestBackfill,
  rowCeilingFor,
  startJob,
  stalledJobs,
  streamImportProgress,
} from "@/lib/backfill/jobs";
import { runBackfillSlice } from "@/lib/backfill/run";
import type { Connector } from "@/connectors/types";
import type { DB } from "@/db/types";

/**
 * Phase 6 — the backfill lane.
 *
 * Two properties carry most of the risk and get most of the tests: the lane can
 * never slow down live work, and a running import cannot be tombstoned by the
 * ordinary sweep it runs alongside.
 */

const KEY = randomBytes(32).toString("base64");
const ORG = "org_bf";
const NOW = new Date("2026-07-01T00:00:00Z");
const back = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

let db: DB;
let close: () => Promise<void>;
let connId = "";
let stream: typeof sourceStreams.$inferSelect;

/** Serves `pages` pages then a null cursor; records the floors it was asked for. */
function fakeClose(pages: Array<{ occurredAt: Date; id: string }[]>, opts: { neverEnds?: boolean } = {}) {
  const floors: Array<Date | null | undefined> = [];
  let n = 0;
  const connector: Connector = {
    source: "close",
    authType: "apiKey",
    verifySignature: () => true,
    normalize: () => [],
    poll: async (args) => {
      floors.push(args.windowFloor);
      const page = pages[n] ?? [];
      const last = n >= pages.length - 1;
      n += 1;
      return {
        records: page.map((r) => ({
          eventId: `close:${connId}:${r.id}`,
          eventType: "lead",
          occurredAt: r.occurredAt,
          properties: {},
        })),
        nextCursor: opts.neverEnds || !last ? `P${n}` : null,
      };
    },
  };
  registerConnector(connector);
  return floors;
}

/** Endless distinct records, so the ceiling is the only thing that can stop it. */
function fakeCloseEndless(perPage: number) {
  let n = 0;
  registerConnector({
    source: "close",
    authType: "apiKey",
    verifySignature: () => true,
    normalize: () => [],
    poll: async () => {
      const records = Array.from({ length: perPage }, () => {
        n += 1;
        return { eventId: `close:${connId}:r${n}`, eventType: "lead", occurredAt: back(10), properties: {} };
      });
      return { records, nextCursor: `P${n}` };
    },
  } as Connector);
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  process.env.ENCRYPTION_KEY = KEY;
  connId = await seedConnection(db, { orgId: ORG, source: "close" });
  await db
    .update(connections)
    .set({ credentialsEncrypted: encrypt(JSON.stringify({ apiKey: "k" }), Buffer.from(KEY, "base64")) })
    .where(eq(connections.id, connId));
  [stream] = await db
    .insert(sourceStreams)
    .values({ orgId: ORG, connectionId: connId, configHash: "hash-a", config: {} })
    .returning();
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  registerConnector((await import("@/connectors/close")).closeConnector);
  await close();
});

const ask = (days = 90) =>
  requestBackfill(db, { id: stream.id, orgId: ORG, connectionId: connId, configHash: "hash-a" }, "close", back(days));
const reload = async (id: string) => (await db.select().from(backfillJobs).where(eq(backfillJobs.id, id)))[0];
const streamRow = async () => (await db.select().from(sourceStreams).where(eq(sourceStreams.id, stream.id)))[0];

describe("6.1 — never re-import", () => {
  it("hands back the same job for the same depth instead of starting a second", async () => {
    const first = await ask(90);
    const second = await ask(90);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    // The property that matters downstream: a second flow on this stream costs
    // zero provider calls, because there is no second job to run.
    expect(await db.select().from(backfillJobs)).toHaveLength(1);
  });

  it("treats a deeper floor as genuinely new work", async () => {
    await ask(90);
    const deeper = await ask(365);
    expect(deeper.created).toBe(true);
    expect(await db.select().from(backfillJobs)).toHaveLength(2);
  });
});

describe("6.2 mid-flight — the window is widened when the job STARTS", () => {
  /**
   * THE trap, and the reason it is worth its own test. Extend the window only as
   * the import progresses and rows land older than what the stream declares, so
   * the next ordinary sweep's `retireOutsideWindow` tombstones them — 6.2's
   * failure reappearing while the import is still running.
   */
  it("declares the full target before a single row is imported", async () => {
    const { job } = await ask(90);
    expect((await streamRow()).windowFloor).toBeNull();

    await startJob(db, job.id, NOW);

    const floor = (await streamRow()).windowFloor;
    expect(floor).not.toBeNull();
    expect(floor!.getTime()).toBe(back(90).getTime());
  });

  it("never narrows a window a deeper job already widened", async () => {
    const deep = await ask(365);
    await startJob(db, deep.job.id, NOW);
    const shallow = await ask(90);
    await startJob(db, shallow.job.id, NOW);

    // A shallower job must not undo a deeper one's declaration, or the sweep
    // would retire everything the deeper import already landed.
    expect((await streamRow()).windowFloor!.getTime()).toBe(back(365).getTime());
  });

  it("narrows back to what was actually reached when a job ends short", async () => {
    const { job } = await ask(90);
    await startJob(db, job.id, NOW);
    await checkpointJob(db, job.id, { checkpoint: "c1", oldestSeen: back(47), rowsImported: 100 }, NOW);
    await finishJob(db, job.id, { status: "partial", detail: "ceiling" }, NOW);

    // Leaving it at 90 would be a lie on every display and would keep the sweep
    // fetching a range with nothing in it. Nothing is destroyed: no row lies
    // outside 47 days.
    expect((await streamRow()).windowFloor!.getTime()).toBe(back(47).getTime());
  });
});

describe("checkpoints resume rather than restart", () => {
  it("only ever deepens reachedFloor", async () => {
    const { job } = await ask(90);
    await checkpointJob(db, job.id, { checkpoint: "c1", oldestSeen: back(40), rowsImported: 10 }, NOW);
    await checkpointJob(db, job.id, { checkpoint: "c2", oldestSeen: back(20), rowsImported: 5 }, NOW);

    const row = await reload(job.id);
    // A later slice seeing a NEWER row must not make the job look shallower.
    expect(row.reachedFloor!.getTime()).toBe(back(40).getTime());
    expect(row.rowsImported).toBe(15);
    expect(row.checkpoint).toBe("c2");
  });

  it("stamps progress separately from row writes", async () => {
    const { job } = await ask(90);
    await checkpointJob(db, job.id, { checkpoint: "c1", oldestSeen: back(10), rowsImported: 1 }, NOW);
    const progressed = (await reload(job.id)).lastProgressAt!;

    await finishJob(db, job.id, { status: "complete" }, new Date(NOW.getTime() + 60_000));

    // A finish is a write, not progress. 10(b) needs to tell them apart.
    expect((await reload(job.id)).lastProgressAt!.getTime()).toBe(progressed.getTime());
  });

  it("flags a job that is running and not moving", async () => {
    const { job } = await ask(90);
    await startJob(db, job.id, NOW);
    await checkpointJob(db, job.id, { checkpoint: "c1", oldestSeen: back(5), rowsImported: 1 }, NOW);

    expect(await stalledJobs(db, 3_600_000, new Date(NOW.getTime() + 30 * 60_000))).toHaveLength(0);
    expect(await stalledJobs(db, 3_600_000, new Date(NOW.getTime() + 4 * 3_600_000))).toHaveLength(1);
  });
});

describe("the lane is strictly below live sync", () => {
  it("gets less than the sweep, which gets less than a person waiting", () => {
    const interactive = laneLimit("close", "*", "interactive");
    const background = laneLimit("close", "*", "background");
    const backfill = laneLimit("close", "*", "backfill");

    expect(backfill).toBeLessThan(background);
    expect(background).toBeLessThan(interactive);
  });

  /**
   * The user-facing promise: a long import must never be the reason a Test is
   * slow. Structural rather than arithmetic — the backfill ceiling is derived
   * from the background one, which already excludes the interactive reserve.
   */
  it("cannot touch the reserve a Test uses, even when it spends everything it has", async () => {
    const conn = { id: connId, orgId: ORG, source: "close" };
    const backfill = laneLimit("close", "*", "backfill");
    for (let i = 0; i < backfill; i++) {
      expect((await claimCalls(db, conn, "*", 1, NOW, "backfill")).allowed).toBe(true);
    }
    expect((await claimCalls(db, conn, "*", 1, NOW, "backfill")).allowed).toBe(false);

    // Both still have room, which is the whole point.
    expect((await claimCalls(db, conn, "*", 1, NOW, "background")).allowed).toBe(true);
    expect((await claimCalls(db, conn, "*", 1, NOW, "interactive")).allowed).toBe(true);
  });
});

describe("running a slice", () => {
  it("imports, checkpoints, and asks the provider for the job's full depth", async () => {
    const floors = fakeClose([
      [{ id: "a", occurredAt: back(40) }],
      [{ id: "b", occurredAt: back(70) }],
    ]);
    const { job } = await ask(90);

    const out = await runBackfillSlice(db, job, NOW);

    expect(out.kind).toBe("finished");
    expect(await db.select().from(events).where(eq(events.connectionId, connId))).toHaveLength(2);
    // Every request carried the job's target, not the connector's default —
    // which is also what the stream now declares.
    for (const f of floors) expect(f!.getTime()).toBe(back(90).getTime());
    const row = await reload(job.id);
    expect(row.reachedFloor!.getTime()).toBe(back(70).getTime());
    expect(row.rowsImported).toBe(2);
  });

  it("calls a drained scan complete, and says when the source had less than asked", async () => {
    fakeClose([[{ id: "a", occurredAt: back(12) }]]);
    const { job } = await ask(90);

    const out = await runBackfillSlice(db, job, NOW);

    expect(out).toMatchObject({ kind: "finished", status: "complete" });
    // Complete, not partial: there was nothing left to fetch. The shortfall is
    // explained rather than treated as a failure to retry.
    expect((await reload(job.id)).detail).toContain("no records older than");
  });

  it("stops at the row ceiling and says so, as a terminal success", async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, occurredAt: back(10 + i) }));
    fakeClose([many, many, many], { neverEnds: true });
    const { job } = await ask(90);
    await db.update(backfillJobs).set({ rowCeiling: 3 }).where(eq(backfillJobs.id, job.id));

    const out = await runBackfillSlice(db, await reload(job.id), NOW);

    expect(out).toMatchObject({ kind: "finished", status: "partial" });
    const row = await reload(job.id);
    expect(row.status).toBe("partial");
    expect(row.detail).toContain("row limit");
  });

  /**
   * The ceiling has to bound the JOB, not each slice. Counting only this
   * slice's rows lets a resumed job import another full ceiling's worth every
   * time it runs — so the bound is not a bound at all, it just slows the
   * overrun down. Two slices are the minimum needed to tell the two apart.
   */
  it("bounds the whole job, not each slice, across a resume", async () => {
    fakeCloseEndless(1);
    const { job } = await ask(90);
    await db.update(backfillJobs).set({ rowCeiling: 4 }).where(eq(backfillJobs.id, job.id));

    const first = await runBackfillSlice(db, await reload(job.id), NOW);
    expect(first.kind).toBe("progressed"); // 3 pages, under the ceiling
    expect((await reload(job.id)).rowsImported).toBe(3);

    const second = await runBackfillSlice(db, await reload(job.id), NOW);

    expect(second).toMatchObject({ kind: "finished", status: "partial" });
    // Exactly the ceiling — not the ceiling plus whatever the resume re-counted.
    expect((await reload(job.id)).rowsImported).toBe(4);
    expect(await db.select().from(events).where(eq(events.connectionId, connId))).toHaveLength(4);
  });

  it("defers without losing its place when the budget is spent", async () => {
    // The budget window is minute-aligned on WALL-CLOCK time, and the slice
    // claims with `new Date()` like every other claim site. Pre-spending the
    // budget and then running the slice therefore straddles a minute boundary
    // roughly once every few hundred runs, and the window resets underneath the
    // test. Only Date is faked — PGlite's async work still uses real timers.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    fakeClose([[{ id: "a", occurredAt: back(20) }]], { neverEnds: true });
    const { job } = await ask(90);
    const conn = { id: connId, orgId: ORG, source: "close" };
    for (let i = 0; i < laneLimit("close", "*", "backfill"); i++) {
      await claimCalls(db, conn, "*", 1, new Date(), "backfill");
    }

    const out = await runBackfillSlice(db, job, NOW);
    vi.useRealTimers();

    expect(out.kind).toBe("deferred");
    // Still runnable, and its checkpoint is intact — a denial costs time only.
    expect((await reload(job.id)).status).toBe("running");
    expect(await nextRunnableJob(db, NOW)).not.toBeNull();
  });

  it("ends cleanly when the connection was disconnected", async () => {
    fakeClose([[{ id: "a", occurredAt: back(20) }]]);
    const { job } = await ask(90);
    await db.update(connections).set({ status: "disabled" }).where(eq(connections.id, connId));

    const out = await runBackfillSlice(db, job, NOW);

    // Terminal and explained, not a job retrying forever against credentials
    // nobody authorised any more.
    expect(out).toMatchObject({ kind: "finished", status: "partial" });
    expect((await reload(job.id)).detail).toContain("disconnected");
  });

  it("charges the backfill lane, not the sweep's", async () => {
    fakeClose([[{ id: "a", occurredAt: back(20) }]]);
    const { job } = await ask(90);

    await runBackfillSlice(db, job, NOW);

    const [led] = await db.select().from(usageLedger).where(eq(usageLedger.connectionId, connId));
    expect(led.calls).toBeGreaterThan(0);
    expect(led.calls).toBeLessThanOrEqual(laneLimit("close", "*", "backfill"));
  });
});

describe("what the lane will not pick up", () => {
  it("skips a disconnected connection's jobs", async () => {
    await ask(90);
    await db.update(connections).set({ status: "disabled" }).where(eq(connections.id, connId));
    expect(await nextRunnableJob(db, NOW)).toBeNull();
  });

  it("skips a connection that is deferred", async () => {
    await ask(90);
    await db
      .update(connections)
      .set({ pausedUntil: new Date(NOW.getTime() + 3_600_000) })
      .where(eq(connections.id, connId));
    // A pause exists to protect the budget; a backfill running through it would
    // spend exactly what the pause is holding back.
    expect(await nextRunnableJob(db, NOW)).toBeNull();
  });

  it("skips a finished job", async () => {
    const { job } = await ask(90);
    await finishJob(db, job.id, { status: "complete" }, NOW);
    expect(await nextRunnableJob(db, NOW)).toBeNull();
  });
});

describe("progress belongs to the stream", () => {
  it("reports the same state whichever flow asks", async () => {
    const { job } = await ask(90);
    await startJob(db, job.id, NOW);
    await checkpointJob(db, job.id, { checkpoint: "c1", oldestSeen: back(12), rowsImported: 40 }, NOW);

    const progress = await streamImportProgress(db, stream.id);
    expect(progress).not.toBeNull();
    // Keyed on the stream, so two dashboards reading it cannot disagree about
    // whether the numbers are still growing.
    expect(progress!.reachedBack.getTime()).toBe(back(12).getTime());
    expect(progress!.targetBack.getTime()).toBe(back(90).getTime());
  });

  it("says nothing once the import is done", async () => {
    const { job } = await ask(90);
    await finishJob(db, job.id, { status: "complete" }, NOW);
    // A note about an import that ended weeks ago is noise.
    expect(await streamImportProgress(db, stream.id)).toBeNull();
  });

  it("does not imply progress before the first slice lands", async () => {
    const { job } = await ask(90);
    await startJob(db, job.id, NOW);

    const progress = await streamImportProgress(db, stream.id);
    // "covering 0 of 90 days", not a number that looks like something happened.
    expect(progress!.reachedBack.getTime()).toBeGreaterThan(back(1).getTime());
  });
});

describe("6.3 — the depth policy", () => {
  it("uses a row ceiling per source, not one number for everything", () => {
    expect(rowCeilingFor("close")).toBe(25_000);
    expect(rowCeilingFor("sendblue")).toBe(25_000);
    // Instantly analytics is one small row per campaign per day — a ceiling
    // sized for record streams would stop an import that costs almost nothing.
    expect(rowCeilingFor("instantly")).toBeGreaterThan(25_000);
  });

  it("freezes the ceiling onto the job, so a policy change cannot rewrite history", async () => {
    const { job } = await ask(90);
    expect(job.rowCeiling).toBe(rowCeilingFor("close"));
  });
});
