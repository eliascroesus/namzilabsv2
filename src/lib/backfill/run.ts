import { eq } from "drizzle-orm";
import { connections, sourceStreams } from "@/db/schema";
import type { DB } from "@/db/types";
import { getConnector } from "@/connectors/registry";
import { getConnectionCredentials } from "@/lib/credentials";
import { upsertEvents } from "@/ingestion/pipeline";
import { claimCalls, recordExtraCalls } from "@/lib/provider-gateway/budget";
import { pollOperation } from "@/lib/provider-gateway/operations";
import { withConnectionSyncLock } from "@/lib/sync/locks";
import { checkpointJob, finishJob, startJob, type BackfillJob } from "./jobs";

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
    // a job that retries forever against credentials nobody authorised.
    return finishWith(db, job, "partial", "The connection was disconnected before the import finished.", now);
  }

  const [stream] = await db.select().from(sourceStreams).where(eq(sourceStreams.id, job.streamId)).limit(1);
  if (!stream) return finishWith(db, job, "failed", "The stream this was importing no longer exists.", now);

  const connector = getConnector(conn.source);
  if (!connector?.poll) return finishWith(db, job, "failed", `${conn.source} cannot be polled.`, now);

  const started = await startJob(db, job.id, now);
  if (!started) return finishWith(db, job, "failed", "The job was already finished.", now);

  const operation = pollOperation(conn.source, stream.config);
  const credentials = await getConnectionCredentials(db, conn);
  const generation = Math.max(1, conn.syncGeneration ?? 0);

  const result = await withConnectionSyncLock(db, conn.id, async (): Promise<SliceOutcome> => {
    let cursor = started.checkpoint;
    let rows = 0;
    let oldest: Date | null = started.reachedFloor;
    let imported = started.rowsImported;

    for (let page = 0; page < PAGES_PER_SLICE; page++) {
      // The lowest lane there is. Its ceiling is derived from the SWEEP's, so a
      // long import structurally cannot reach the reserve a person's Test uses.
      const claim = await claimCalls(db, conn, operation, 1, new Date(), "backfill");
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
      });
      await recordExtraCalls(db, conn, operation, Math.max(0, (res.providerCalls ?? 1) - 1));

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
        return {
          kind: "finished",
          status: "partial",
          detail: `Reached this stream's ${started.rowCeiling.toLocaleString()}-row limit before the full window.`,
        };
      }

      // `null` means the connector's scan is DONE (see PollResult.nextCursor).
      // Nothing is left to fetch, so the import got everything the provider has
      // — which is complete even when that is less than was asked for.
      if (res.nextCursor == null) {
        await checkpointJob(db, job.id, { checkpoint: null, oldestSeen: oldest, rowsImported: rows }, now);
        const short = oldest != null && oldest > started.targetFloor;
        return {
          kind: "finished",
          status: "complete",
          detail: short ? `The source had no records older than ${oldest!.toISOString().slice(0, 10)}.` : undefined,
        };
      }
      // A cursor that stopped moving is a connector that cannot go further.
      // Treating it as progress would spin this slice against the same page.
      if (!advanced) break;
    }

    await checkpointJob(db, job.id, { checkpoint: cursor, oldestSeen: oldest, rowsImported: rows }, now);
    return { kind: "progressed", rows, done: false };
  });

  // Another writer holds the connection. Not an error and not progress — the
  // job stays runnable and the next tick tries again.
  if (!result.acquired || !result.result) return { kind: "deferred", reason: "Another sync is running", retryAfterMs: 30_000 };

  const outcome = result.result;
  if (outcome.kind === "finished") await finishJob(db, job.id, { status: outcome.status, detail: outcome.detail }, now);
  return outcome;
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
