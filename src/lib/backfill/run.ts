import { eq } from "drizzle-orm";
import { backfillJobs, connections, sourceStreams } from "@/db/schema";
import type { DB } from "@/db/types";
import { getConnector } from "@/connectors/registry";
import { getConnectionCredentials } from "@/lib/credentials";
import { upsertEvents } from "@/ingestion/pipeline";
import { claimCalls, settlePollCalls } from "@/lib/provider-gateway/budget";
import { pollOperation } from "@/lib/provider-gateway/operations";
import { withConnectionSyncLock } from "@/lib/sync/locks";
import { checkpointJob, DISCONNECTED_DETAIL, finishJob, startJob, type BackfillJob } from "./jobs";

// Re-exported so callers of this module (and its tests) have one place to get
// the exact string a disconnect-terminated job carries — see jobs.ts for why
// the constant itself lives there and not here.
export { DISCONNECTED_DETAIL };

/**
 * E.8 / Phase 6 — the fetching half of the backfill lane.
 *
 * One SLICE per call: claim budget, poll once, write, checkpoint, return. The
 * loop lives outside, in the Inngest function, so every unit of work is durable
 * and an interruption costs one slice rather than an import.
 *
 * It reads through the same connector and the same writer as the ordinary
 * sweep. What differs is only the depth it asks for and the cursor it carries —
 * a backfill has its OWN cursor (the job's checkpoint), so walking history
 * cannot disturb the stream's live cursor and the two can run in either order.
 */

/** Pages per slice. Small on purpose: a slice is a resumption unit, not a job. */
const PAGES_PER_SLICE = 3;

/**
 * Provider calls CLAIMED per poll — and, via `budget.maxCalls`, the most the
 * connector may SPEND on that poll. One number for both on purpose.
 *
 * The first draft passed `maxCalls: MAX_SAFE_INTEGER` to "not tighten the
 * page cap", which read the budget contract backwards: for close/instantly
 * the PRESENCE of a budget selects their wide ceiling (40/20 pages) instead
 * of the no-budget default (4/3), so one poll could spend ~40 real calls
 * against a claim of 1 — settled only after the fact, overdrawing the shared
 * minute window straight past the interactive reserve the backfill lane is
 * structurally forbidden from touching. Claiming exactly what the connector
 * may spend restores claim-before-spend, which is the entire point of the
 * ledger. 4 keeps Close at its legacy per-poll page count; 3 polls × 4 = 12
 * claims per slice, inside the default backfill lane ceiling (15/min).
 */
const CALLS_PER_POLL = 4;

/**
 * Wall-clock ceiling for one slice, connector time included.
 *
 * Same derivation as the sweep's SYNC_BUDGET_MS: every sync-bearing route
 * declares `maxDuration = 60`, and a unit of work gets well under half of it
 * so the invocation survives its own worst case. A slice without this was
 * bounded in pages and provider calls but not in SECONDS — a gcal poll walks
 * up to 8 pages internally, each request bounded only by the 30s HTTP budget,
 * so one slice could legally outlive the container. A killed step writes no
 * checkpoint, so the retry re-walked the same pages into the same kill: a
 * permanent wedge that also starved whatever work sat after it in the
 * function body. The connectors already honour `budget.deadlineMs` between
 * pages; this just finally hands it to them.
 */
const SLICE_BUDGET_MS = 25_000;

export type SliceOutcome =
  | { kind: "progressed"; rows: number; done: false }
  | { kind: "deferred"; reason: string; retryAfterMs: number }
  | { kind: "finished"; status: "complete" | "partial" | "failed"; detail?: string };

/**
 * Run one slice of `job`.
 *
 * Under the connection's lease, like every other writer, so a backfill and the
 * ordinary sweep can never both be polling one connection — which would double
 * the provider spend and interleave two walks over the same stream.
 */
export async function runBackfillSlice(db: DB, job: BackfillJob, now = new Date()): Promise<SliceOutcome> {
  const [conn] = await db.select().from(connections).where(eq(connections.id, job.connectionId)).limit(1);
  if (!conn) return finishWith(db, job, "failed", "The connection no longer exists.", now);
  if (conn.status === "disabled") {
    // Not a failure: the user disconnected. Terminal and explained, rather than
    // a job that retries forever against credentials nobody authorised — and
    // `reconnectConnection` matches on this exact detail to revive it once
    // they reconnect (see DISCONNECTED_DETAIL in jobs.ts).
    return finishWith(db, job, "partial", DISCONNECTED_DETAIL, now);
  }

  const [stream] = await db.select().from(sourceStreams).where(eq(sourceStreams.id, job.streamId)).limit(1);
  if (!stream) return finishWith(db, job, "failed", "The stream this was importing no longer exists.", now);

  const connector = getConnector(conn.source);
  if (!connector?.poll) return finishWith(db, job, "failed", `${conn.source} cannot be polled.`, now);

  const operation = pollOperation(conn.source, stream.config);
  const credentials = await getConnectionCredentials(db, conn);
  const generation = Math.max(1, conn.syncGeneration ?? 0);

  const result = await withConnectionSyncLock(db, conn.id, async (): Promise<SliceOutcome> => {
    /**
     * START INSIDE THE LEASE — the whole job lifecycle of one slice
     * (start → walk → checkpoint → finish) is serialized per connection.
     *
     * `startJob` used to run BEFORE the lock and `finishJob` after it, so
     * only the poll body was covered and the status transitions were not.
     * Two runners exist (the event-lane worker and the sweep's own slice),
     * they are separate Inngest functions with separate singleton scopes,
     * and the review reproduced the interleave: lane A finishes the job
     * `complete`, lane B's startJob then returns null, and lane B's
     * "already finished" branch REWROTE the completed job to `failed` —
     * whose revive resumes from a null checkpoint, a full re-walk of the
     * window against the provider. With start and finish both inside the
     * lease, the loser never starts: it gets `acquired: false` and defers.
     */
    const started = await startJob(db, job.id, now);
    if (!started) {
      // Terminal already — settled by another run. Report what IS, and
      // write nothing: this is an observation, not an outcome.
      const settled = await getJobStatus(db, job.id);
      return { kind: "finished", status: settled, detail: "Already finished by another run." };
    }

    const deadlineMs = Date.now() + SLICE_BUDGET_MS;
    let cursor = started.checkpoint;
    let rows = 0;
    let oldest: Date | null = started.reachedFloor;
    let imported = started.rowsImported;

    for (let page = 0; page < PAGES_PER_SLICE; page++) {
      // The lowest lane there is. Its ceiling is derived from the SWEEP's, so a
      // long import structurally cannot reach the reserve a person's Test uses.
      // One instant for the claim and its settle-up, so a slice that straddles a
      // minute boundary cannot refund out of the next window (settlePollCalls).
      const claimedAt = new Date();
      const claim = await claimCalls(db, conn, operation, CALLS_PER_POLL, claimedAt, "backfill");
      if (!claim.allowed) {
        // Defer, never drop: the checkpoint already written is exactly where the
        // next attempt resumes, so a denial costs nothing but time.
        await checkpointJob(db, job.id, { checkpoint: cursor, oldestSeen: oldest, rowsImported: rows }, now);
        return { kind: "deferred", reason: claim.reason, retryAfterMs: claim.retryAfterMs };
      }

      const res = await connector.poll!({
        connectionId: conn.id,
        cursor,
        credentials,
        config: stream.config ?? undefined,
        streamHash: stream.configHash,
        // The job's full target, matching what `startJob` widened the stream to.
        // The connector uses it for the request bound AND for the window it
        // declares, so the rows this writes cannot be retired by the next sweep.
        windowFloor: started.targetFloor,
        // Exactly what was claimed above — see CALLS_PER_POLL — plus the
        // wall clock, which pages and call counts cannot express.
        budget: { maxCalls: CALLS_PER_POLL, deadlineMs },
      });
      await settlePollCalls(db, conn, operation, res, CALLS_PER_POLL, claimedAt);

      if (res.records.length > 0) {
        const wrote = await upsertEvents(
          db,
          { orgId: conn.orgId, connectionId: conn.id, source: conn.source, streamHash: stream.configHash, generation },
          res.records,
        );
        rows += wrote.inserted;
        imported += wrote.inserted;
        for (const r of res.records) if (oldest == null || r.occurredAt < oldest) oldest = r.occurredAt;
      }

      const advanced = res.nextCursor !== cursor;
      cursor = res.nextCursor;

      // 6.3 — the ceiling, checked against the running total rather than this
      // slice's, so a job cannot exceed it by one slice's worth each time.
      if (imported >= started.rowCeiling) {
        await checkpointJob(db, job.id, { checkpoint: cursor, oldestSeen: oldest, rowsImported: rows }, now);
        const detail = `Reached this stream's ${started.rowCeiling.toLocaleString("en-US")}-row limit before the full window.`;
        await finishJob(db, job.id, { status: "partial", detail }, now);
        return { kind: "finished", status: "partial", detail };
      }

      // `null` means the connector's scan is DONE (see PollResult.nextCursor).
      // Nothing is left to fetch, so the import got everything the provider has
      // — which is complete even when that is less than was asked for.
      if (res.nextCursor == null) {
        await checkpointJob(db, job.id, { checkpoint: null, oldestSeen: oldest, rowsImported: rows }, now);
        const short = oldest != null && oldest > started.targetFloor;
        const detail = short ? `The source had no records older than ${oldest!.toISOString().slice(0, 10)}.` : undefined;
        await finishJob(db, job.id, { status: "complete", detail }, now);
        return { kind: "finished", status: "complete", detail };
      }
      // A cursor that stopped moving is a connector that cannot go further.
      // Treating it as progress would spin this slice against the same page.
      if (!advanced) break;
      // Out of clock between polls: stop honestly. The checkpoint below is
      // exactly where the next slice resumes, so the deadline costs nothing
      // but time — the same shape as a budget denial.
      if (Date.now() >= deadlineMs) break;
    }

    await checkpointJob(db, job.id, { checkpoint: cursor, oldestSeen: oldest, rowsImported: rows }, now);
    return { kind: "progressed", rows, done: false };
  });

  // Another writer holds the connection. Not an error and not progress — the
  // job stays runnable and the next tick tries again.
  if (!result.acquired || !result.result) return { kind: "deferred", reason: "Another sync is running", retryAfterMs: 30_000 };

  // Every terminal write happened INSIDE the lease, next to the checkpoint it
  // belongs with — nothing settles a job after the lock is gone.
  return result.result;
}

/** The job's terminal status, for reporting a settled job without rewriting it. */
async function getJobStatus(db: DB, jobId: string): Promise<"complete" | "partial" | "failed"> {
  const [row] = await db.select({ status: backfillJobs.status }).from(backfillJobs).where(eq(backfillJobs.id, jobId)).limit(1);
  const s = row?.status;
  return s === "complete" || s === "partial" ? s : "failed";
}

async function finishWith(
  db: DB,
  job: BackfillJob,
  status: "complete" | "partial" | "failed",
  detail: string,
  now: Date,
): Promise<SliceOutcome> {
  await finishJob(db, job.id, { status, detail }, now);
  return { kind: "finished", status, detail };
}
