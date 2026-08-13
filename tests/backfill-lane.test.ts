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
  defaultTargetFloor,
  quantizeFloor,
  runnableJobsByProvider,
  finishJob,
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
const streamId = () => stream.id;
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

describe("6.1 — dedup is by DEPTH, not by timestamp", () => {
  /**
   * The rule is DEPTH, not timestamp equality, and the difference is the whole
   * feature once the request became automatic.
   *
   * `defaultTargetFloor()` is "now minus 90 days", so it is a different instant
   * on every call. Keyed on equality, two requests a second apart produce two
   * different targets and dedup never fires — every flow save would have queued
   * another import of the same history. The original test missed it by reusing
   * one computed value for both calls.
   */
  it("dedupes repeated default requests made at different moments", async () => {
    const stream = { id: streamId(), orgId: ORG, connectionId: connId, configHash: "hash-a" };
    const first = await requestBackfill(db, stream, "close", defaultTargetFloor(new Date("2026-07-01T09:15:00Z")));
    const second = await requestBackfill(db, stream, "close", defaultTargetFloor(new Date("2026-07-01T23:59:59Z")));
    const nextDay = await requestBackfill(db, stream, "close", defaultTargetFloor(new Date("2026-07-02T04:00:00Z")));

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    // A day later the floor moves by a day and is genuinely shallower than what
    // is already covered, so it is still not new work.
    expect(nextDay.created).toBe(false);
    expect(await db.select().from(backfillJobs)).toHaveLength(1);
  });

  it("counts an existing DEEPER job as covering a shallower request", async () => {
    await ask(365);
    const shallower = await ask(90);

    // We already hold a year; ninety days costs nothing.
    expect(shallower.created).toBe(false);
    expect(await db.select().from(backfillJobs)).toHaveLength(1);
  });

  it("retries a failed job in place, keeping its checkpoint", async () => {
    const { job } = await ask(90);
    await checkpointJob(db, job.id, { checkpoint: "c9", oldestSeen: back(35), rowsImported: 400 }, NOW);
    await finishJob(db, job.id, { status: "failed", detail: "boom" }, NOW);

    const retried = await ask(90);

    // A failure is the one terminal state worth retrying; treating it as
    // coverage would mean a stream that errored once could never import again.
    expect(retried.created).toBe(true);
    expect(retried.job.id).toBe(job.id); // the same unit of work, not a second row
    expect(await db.select().from(backfillJobs)).toHaveLength(1);
    // And it RESUMES: re-fetching the 400 rows that already landed would defeat
    // the point of checkpointing at all.
    expect(retried.job.checkpoint).toBe("c9");
    expect(retried.job.reachedFloor!.getTime()).toBe(back(35).getTime());
    expect(retried.job.status).toBe("queued");
  });

  it("snaps targets to a day, so the unique index can actually catch a race", async () => {
    const q = quantizeFloor(new Date("2026-07-01T13:47:21.123Z"));
    expect(q.toISOString()).toBe("2026-07-01T00:00:00.000Z");
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

  /**
   * THE hole the narrow-only shape had: `reachedFloor` is null until the first
   * checkpoint, so a job that died before it left the floor at the full target
   * forever — the stream declared 90 days nobody delivered, with nothing left
   * to correct it and (before the stalled-detector fix below) nothing that
   * could even see it.
   */
  it("a job that dies before its first checkpoint gives the window back", async () => {
    const { job } = await ask(90);
    await startJob(db, job.id, NOW);
    expect((await streamRow()).windowFloor!.getTime()).toBe(back(90).getTime());

    await finishJob(db, job.id, { status: "failed", detail: "died before first checkpoint" }, NOW);

    // NULL = the connector's default — exactly where the stream was before the
    // job made its claim and delivered nothing against it.
    expect((await streamRow()).windowFloor).toBeNull();
  });

  it("reconciles to the deepest SURVIVING claim, not to the job that happens to finish", async () => {
    const first = await ask(90);
    await startJob(db, first.job.id, NOW);
    await checkpointJob(db, first.job.id, { checkpoint: "c1", oldestSeen: back(60), rowsImported: 50 }, NOW);
    await finishJob(db, first.job.id, { status: "complete" }, NOW);
    expect((await streamRow()).windowFloor!.getTime()).toBe(back(60).getTime());

    const second = await ask(180);
    expect(second.created).toBe(true);
    await startJob(db, second.job.id, NOW);
    expect((await streamRow()).windowFloor!.getTime()).toBe(back(180).getTime());

    await finishJob(db, second.job.id, { status: "failed", detail: "no checkpoint" }, NOW);

    // The failed attempt's 180-day claim dies with it; the completed job's 60
    // delivered days survive. The old shape left 180 declared forever.
    expect((await streamRow()).windowFloor!.getTime()).toBe(back(60).getTime());
  });

  it("keeps delivered rows inside the window even when their job FAILED", async () => {
    const { job } = await ask(90);
    await startJob(db, job.id, NOW);
    await checkpointJob(db, job.id, { checkpoint: "c1", oldestSeen: back(47), rowsImported: 100 }, NOW);
    await finishJob(db, job.id, { status: "failed", detail: "boom" }, NOW);

    // 100 rows landed down to 47 days back. A failure does not un-deliver
    // them, and narrowing past them would license the next sweep's
    // retire-outside-window to tombstone rows that are correct.
    expect((await streamRow()).windowFloor!.getTime()).toBe(back(47).getTime());
  });

  it("never rips a RUNNING sibling's widening out from under it", async () => {
    const shallow = await ask(90);
    await startJob(db, shallow.job.id, NOW);
    const deep = await ask(365);
    expect(deep.created).toBe(true);
    await startJob(db, deep.job.id, NOW);
    expect((await streamRow()).windowFloor!.getTime()).toBe(back(365).getTime());

    await checkpointJob(db, shallow.job.id, { checkpoint: "c1", oldestSeen: back(50), rowsImported: 10 }, NOW);
    await finishJob(db, shallow.job.id, { status: "complete" }, NOW);

    // The old narrow-to-this-job shape set the floor to 50 days here — pulling
    // the window out from under the deep import mid-flight, so the next sweep
    // would retire everything it had already landed past 50 days.
    expect((await streamRow()).windowFloor!.getTime()).toBe(back(365).getTime());
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

  it("flags a job that started and NEVER checkpointed — the one whose widened window nothing else can see", async () => {
    const { job } = await ask(90);
    await startJob(db, job.id, NOW);

    // Within the threshold: healthy, merely young.
    expect(await stalledJobs(db, 3_600_000, new Date(NOW.getTime() + 30 * 60_000))).toHaveLength(0);
    // Past it with zero checkpoints: startedAt is the progress epoch. The old
    // isNotNull(lastProgressAt) guard made exactly this job — the die-before-
    // first-checkpoint case — the one the detector could never return.
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
    expect(await runnableJobsByProvider(db, 1, NOW)).toHaveLength(1);
  });

  it("rotates fairly: a job that just ran a slice yields the provider slot to its sibling", async () => {
    // Two TENANTS, one provider. Under the old `createdAt asc` ordering the
    // first-created job was re-picked every tick until terminal — one 90-day
    // import monopolized the provider for every other tenant for its whole
    // duration.
    const { job: jobA } = await ask(90); // tenant A, created first
    const connB = await seedConnection(db, { orgId: "org_other", source: "close" });
    const [streamB] = await db
      .insert(sourceStreams)
      .values({ orgId: "org_other", connectionId: connB, configHash: "hash-b", config: {} })
      .returning();
    const { job: jobB } = await requestBackfill(
      db,
      { id: streamB.id, orgId: "org_other", connectionId: connB, configHash: "hash-b" },
      "close",
      back(90),
    );

    // ONE clock for everything: created_at is stamped by the database's real
    // now(), so the progress stamps must be real-clock too — mixing the
    // file's July NOW fixture in here would sort a "recent" checkpoint
    // before a real-clock creation.
    const t0 = new Date();

    // Nobody has progressed: oldest-created goes first (A).
    expect((await runnableJobsByProvider(db, 1, t0))[0].job.id).toBe(jobA.id);

    // A runs a slice (checkpointJob stamps lastProgressAt)…
    await startJob(db, jobA.id, t0);
    await checkpointJob(db, jobA.id, { checkpoint: "c1", oldestSeen: back(10), rowsImported: 5 }, new Date(t0.getTime() + 1_000));

    // …and the next tick picks B. THE regression: old code picked A again,
    // every tick, forever.
    expect((await runnableJobsByProvider(db, 1, t0))[0].job.id).toBe(jobB.id);

    // B progresses more recently than A → the slot rotates back to A.
    await startJob(db, jobB.id, t0);
    await checkpointJob(db, jobB.id, { checkpoint: "c1", oldestSeen: back(10), rowsImported: 5 }, new Date(t0.getTime() + 2_000));
    expect((await runnableJobsByProvider(db, 1, t0))[0].job.id).toBe(jobA.id);
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
    expect(await runnableJobsByProvider(db, 1, NOW)).toHaveLength(0);
  });

  it("skips a connection that is deferred", async () => {
    await ask(90);
    await db
      .update(connections)
      .set({ pausedUntil: new Date(NOW.getTime() + 3_600_000) })
      .where(eq(connections.id, connId));
    // A pause exists to protect the budget; a backfill running through it would
    // spend exactly what the pause is holding back.
    expect(await runnableJobsByProvider(db, 1, NOW)).toHaveLength(0);
  });

  it("skips a finished job", async () => {
    const { job } = await ask(90);
    await finishJob(db, job.id, { status: "complete" }, NOW);
    expect(await runnableJobsByProvider(db, 1, NOW)).toHaveLength(0);
  });
});

describe("progress belongs to the stream", () => {
  it("reports the same state whichever flow asks", async () => {
    const { job } = await ask(90);
    await startJob(db, job.id, NOW);
    await checkpointJob(db, job.id, { checkpoint: "c1", oldestSeen: back(12), rowsImported: 40 }, NOW);

    const progress = await streamImportProgress(db, stream.id, NOW);
    expect(progress).not.toBeNull();
    // Keyed on the stream, so two dashboards reading it cannot disagree about
    // whether the numbers are still growing. Two SPANS, not two instants — see
    // PollResult.importProgress.
    expect(progress!.coveredMs).toBe(12 * 86_400_000);
    expect(progress!.targetMs).toBe(90 * 86_400_000);
  });

  it("says nothing once the import is done", async () => {
    const { job } = await ask(90);
    await finishJob(db, job.id, { status: "complete" }, NOW);
    // A note about an import that ended weeks ago is noise.
    expect(await streamImportProgress(db, stream.id, NOW)).toBeNull();
  });

  it("does not imply progress before the first slice lands", async () => {
    const { job } = await ask(90);
    await startJob(db, job.id, NOW);

    const progress = await streamImportProgress(db, stream.id, NOW);
    // "covering 0 of 90 days", not a number that looks like something happened.
    expect(progress!.coveredMs).toBe(0);
    expect(progress!.targetMs).toBe(90 * 86_400_000);
  });
});

describe("6.3 — the depth policy", () => {
  it("uses a row ceiling per source, not one number for everything", () => {
    expect(rowCeilingFor("close")).toBe(25_000);
    // Instantly analytics is one small row per campaign per day — a ceiling
    // sized for record streams would stop an import that costs almost nothing.
    expect(rowCeilingFor("instantly")).toBeGreaterThan(25_000);
  });

  it("freezes the ceiling onto the job, so a policy change cannot rewrite history", async () => {
    const { job } = await ask(90);
    expect(job.rowCeiling).toBe(rowCeilingFor("close"));
  });
});

/**
 * The lane is worth nothing if it only runs when somebody finds a button.
 * Leaving it manual meant most customers' metrics sat on whatever the ordinary
 * sweep had accumulated, with nothing saying the number was short — and the
 * progress display was built for exactly the import that never started.
 */
describe("a genuinely new stream imports its history automatically", () => {
  const graphFor = (cfg: Record<string, unknown>, source: string) => ({
    nodes: [{ id: "a1", type: "app", data: { config: { connectionId: connId, source, sourceConfig: cfg } } }],
    edges: [],
  });

  it("queues a default-depth job when the stream is created", async () => {
    const { ensureStreamsForGraph } = await import("@/lib/sync/streams");
    const { parseGraph } = await import("@/lib/flow/types");
    await db.update(connections).set({ source: "calendly" }).where(eq(connections.id, connId));

    const res = await ensureStreamsForGraph(db, ORG, parseGraph(graphFor({ scope: "user" }, "calendly")));

    expect(res.created).toBe(1);
    const jobs = await db.select().from(backfillJobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].targetFloor.getTime()).toBe(defaultTargetFloor().getTime());
  });

  /**
   * Saving a flow is not a request for more history. Without depth-based dedup
   * every save would queue another import of the same window.
   */
  it("queues nothing more on a re-save of the same stream", async () => {
    const { ensureStreamsForGraph } = await import("@/lib/sync/streams");
    const { parseGraph } = await import("@/lib/flow/types");
    await db.update(connections).set({ source: "calendly" }).where(eq(connections.id, connId));
    const graph = parseGraph(graphFor({ scope: "user" }, "calendly"));

    await ensureStreamsForGraph(db, ORG, graph);
    await ensureStreamsForGraph(db, ORG, graph);
    await ensureStreamsForGraph(db, ORG, graph);

    expect(await db.select().from(backfillJobs)).toHaveLength(1);
  });

  /**
   * A mirror re-reads its whole resource on every poll. It has no lookback to
   * deepen, so a "historical import" of one is a job that can never mean
   * anything — and would sit in the queue forever looking like work.
   */
  it("does not queue one for a mirror source", async () => {
    const { ensureStreamsForGraph } = await import("@/lib/sync/streams");
    const { parseGraph } = await import("@/lib/flow/types");
    await db.update(connections).set({ source: "gsheets" }).where(eq(connections.id, connId));

    const res = await ensureStreamsForGraph(db, ORG, parseGraph(graphFor({ spreadsheetId: "S1", range: "T" }, "gsheets")));

    expect(res.created).toBe(1);
    expect(await db.select().from(backfillJobs)).toHaveLength(0);
  });
});

/**
 * Automatic triggering is what makes this cap necessary. A day's signups queue
 * several imports at once, and a per-connection lease cannot bound them because
 * those are different connections — several concurrent historical walks against
 * one API, from the lowest-priority work in the system.
 */
describe("the fleet cap is per provider, not per connection", () => {
  async function jobOn(source: string, hash: string) {
    const id = await seedConnection(db, { orgId: ORG, source });
    const [s] = await db
      .insert(sourceStreams)
      .values({ orgId: ORG, connectionId: id, configHash: hash, config: {} })
      .returning();
    await requestBackfill(db, { id: s.id, orgId: ORG, connectionId: id, configHash: hash }, source, back(90));
    return id;
  }

  it("dispatches at most one job per provider, however many are queued", async () => {
    // Three separate Close connections — three leases, one API.
    await jobOn("close", "c1");
    await jobOn("close", "c2");
    await jobOn("close", "c3");
    await jobOn("calendly", "k1");

    const due = await runnableJobsByProvider(db, 4, NOW);

    expect(due).toHaveLength(2);
    expect(due.map((d) => d.provider).sort()).toEqual(["calendly", "close"]);
  });

  it("honours the overall limit as well", async () => {
    await jobOn("close", "c1");
    await jobOn("calendly", "k1");
    await jobOn("gcal", "g1");

    expect(await runnableJobsByProvider(db, 2, NOW)).toHaveLength(2);
  });

  it("still skips disconnected and deferred connections", async () => {
    const closeId = await jobOn("close", "c1");
    await db.update(connections).set({ status: "disabled" }).where(eq(connections.id, closeId));
    await jobOn("calendly", "k1");

    const due = await runnableJobsByProvider(db, 4, NOW);
    expect(due.map((d) => d.provider)).toEqual(["calendly"]);
  });
});
