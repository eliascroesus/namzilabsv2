import { and, asc, eq, inArray, isNotNull, lt, ne, or, sql } from "drizzle-orm";
import { backfillJobs, connections, sourceStreams } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * E.8 / Phase 6 — the bookkeeping half of the backfill lane.
 *
 * Nothing here talks to a provider. This decides what work EXISTS, what state it
 * is in, and when it is finished; `run.ts` does the fetching. Keeping them apart
 * is what lets the lifecycle be tested without a network and without a clock.
 */

const DAY_MS = 86_400_000;

/** 6.3 — how far back a backfill reaches, unless something says otherwise. */
export const DEFAULT_TARGET_DAYS = 90;

/**
 * 6.3 — the row ceiling, per stream.
 *
 * A depth policy needs BOTH bounds because the two failure modes are different:
 * 90 days of a quiet calendar is nothing, and 90 days of a busy Close workspace
 * is hundreds of thousands of rows. Whichever comes first wins.
 *
 * Sendblue and Close are the only two that realistically reach it. When the
 * ceiling stops an import the UI must say "covering 47 of 90 days" — never imply
 * the 90 it was aiming for.
 */
export const DEFAULT_ROW_CEILING = 25_000;

/**
 * Per-source overrides, keyed by source.
 *
 * `instantly` analytics is one small row per campaign per day, so a row ceiling
 * expressed for record streams is the wrong unit entirely — it would stop a
 * daily-analytics import that costs almost nothing. `gsheets` never appears
 * here: a mirror has no lookback to deepen, it reads the whole tab every time.
 */
const ROW_CEILING_BY_SOURCE: Record<string, number> = { instantly: 500_000 };

export function rowCeilingFor(source: string): number {
  return ROW_CEILING_BY_SOURCE[source] ?? DEFAULT_ROW_CEILING;
}

/** Statuses a job never leaves. `partial` is one of them, and is a success. */
export const TERMINAL_STATUSES = ["complete", "partial", "failed"] as const;
export type BackfillStatus = "queued" | "running" | (typeof TERMINAL_STATUSES)[number];

export type BackfillJob = typeof backfillJobs.$inferSelect;

/**
 * Ask for a stream to be imported back to `targetFloor`.
 *
 * 6.1, "never re-import", is enforced by the unique index on
 * `(stream_id, target_floor)` rather than by a check here: a request for a depth
 * this stream already has finds the existing row and returns it. So a second
 * flow reading a backfilled stream costs zero provider calls, and only a request
 * for a DEEPER floor is new work.
 *
 * Returns the job and whether this call created it, because the caller's next
 * move differs: a new job needs dispatching, an existing one does not.
 */
export async function requestBackfill(
  db: DB,
  stream: { id: string; orgId: string; connectionId: string; configHash: string },
  source: string,
  targetFloor: Date,
): Promise<{ job: BackfillJob; created: boolean }> {
  const rows = await db
    .insert(backfillJobs)
    .values({
      orgId: stream.orgId,
      connectionId: stream.connectionId,
      streamId: stream.id,
      streamHash: stream.configHash,
      targetFloor,
      rowCeiling: rowCeilingFor(source),
    })
    .onConflictDoNothing({ target: [backfillJobs.streamId, backfillJobs.targetFloor] })
    .returning();
  if (rows[0]) return { job: rows[0], created: true };

  const [existing] = await db
    .select()
    .from(backfillJobs)
    .where(and(eq(backfillJobs.streamId, stream.id), eq(backfillJobs.targetFloor, targetFloor)))
    .limit(1);
  return { job: existing, created: false };
}

/** One job by id. */
export async function getJob(db: DB, id: string): Promise<BackfillJob | null> {
  const [row] = await db.select().from(backfillJobs).where(eq(backfillJobs.id, id)).limit(1);
  return row ?? null;
}

/** The default depth, as a date. */
export function defaultTargetFloor(now = new Date()): Date {
  return new Date(now.getTime() - DEFAULT_TARGET_DAYS * DAY_MS);
}

/**
 * Move a job to `running` and widen its stream's window to the job's FULL
 * target — not to what it has reached.
 *
 * This ordering is the whole reason 6.2 exists and is the easiest thing here to
 * get wrong. Mid-import, rows land older than the stream's declared window; the
 * next ordinary sweep declares `retireOutsideWindow` from that window and
 * tombstones them. Over-declaring retires LESS, which is the safe direction, so
 * the window goes to the target up front and a job that ends short narrows it
 * back afterwards.
 *
 * Only ever widens the stream: `window_floor` is left alone if it is already
 * deeper, so a second, shallower job cannot undo a completed deeper one.
 */
export async function startJob(db: DB, jobId: string, now = new Date()): Promise<BackfillJob | null> {
  const rows = await db
    .update(backfillJobs)
    .set({ status: "running", startedAt: now, attempts: sql`${backfillJobs.attempts} + 1`, updatedAt: now })
    .where(and(eq(backfillJobs.id, jobId), inArray(backfillJobs.status, ["queued", "running"])))
    .returning();
  const job = rows[0];
  if (!job) return null;

  await db
    .update(sourceStreams)
    .set({ windowFloor: job.targetFloor, updatedAt: now })
    .where(
      and(
        eq(sourceStreams.id, job.streamId),
        // NULL means "the connector's default", which is always shallower than a
        // backfill target, so it must be widened too.
        or(sql`${sourceStreams.windowFloor} is null`, sql`${sourceStreams.windowFloor} > ${job.targetFloor}`),
      ),
    );
  return job;
}

/**
 * Record one slice of progress. Resume, never restart.
 *
 * `reachedFloor` only ever moves BACKWARDS in time, because a later slice
 * reaching a newer row must not make the job look shallower than it already is.
 * `lastProgressAt` is stamped only here — it is what 10(b) uses to tell a stuck
 * job from a healthy one, and `updated_at` cannot, because any write touches it.
 */
export async function checkpointJob(
  db: DB,
  jobId: string,
  slice: { checkpoint: string | null; oldestSeen: Date | null; rowsImported: number },
  now = new Date(),
): Promise<BackfillJob | null> {
  const [job] = await db.select().from(backfillJobs).where(eq(backfillJobs.id, jobId)).limit(1);
  if (!job) return null;
  const reached =
    slice.oldestSeen == null
      ? job.reachedFloor
      : job.reachedFloor == null || slice.oldestSeen < job.reachedFloor
        ? slice.oldestSeen
        : job.reachedFloor;
  const rows = await db
    .update(backfillJobs)
    .set({
      checkpoint: slice.checkpoint,
      reachedFloor: reached,
      rowsImported: job.rowsImported + Math.max(0, slice.rowsImported),
      lastProgressAt: now,
      updatedAt: now,
    })
    .where(eq(backfillJobs.id, jobId))
    .returning();
  return rows[0] ?? null;
}

/**
 * Put a job into a terminal state, and reconcile the stream's declared window
 * with what was actually reached.
 *
 * A job that stopped short leaves the stream declaring depth it does not hold,
 * which would be a lie on every display and would keep the ordinary sweep
 * fetching a range with nothing in it. Narrowing back to `reachedFloor` destroys
 * nothing: by definition no row lies outside it.
 */
export async function finishJob(
  db: DB,
  jobId: string,
  outcome: { status: (typeof TERMINAL_STATUSES)[number]; detail?: string },
  now = new Date(),
): Promise<BackfillJob | null> {
  const rows = await db
    .update(backfillJobs)
    .set({ status: outcome.status, detail: outcome.detail ?? null, finishedAt: now, updatedAt: now })
    .where(eq(backfillJobs.id, jobId))
    .returning();
  const job = rows[0];
  if (!job) return null;

  if (job.reachedFloor && job.reachedFloor > job.targetFloor) {
    await db
      .update(sourceStreams)
      .set({ windowFloor: job.reachedFloor, updatedAt: now })
      .where(and(eq(sourceStreams.id, job.streamId), sql`${sourceStreams.windowFloor} < ${job.reachedFloor}`));
  }
  return job;
}

/**
 * The next job worth running, oldest first.
 *
 * Skips connections that are disabled or deferred: a backfill against a
 * disconnected integration is work nobody asked for against credentials nobody
 * authorised any more, and one against a paused connection would spend the
 * budget the pause exists to protect.
 */
export async function nextRunnableJob(db: DB, now = new Date()): Promise<BackfillJob | null> {
  const rows = await db
    .select({ job: backfillJobs })
    .from(backfillJobs)
    .innerJoin(connections, eq(connections.id, backfillJobs.connectionId))
    .where(
      and(
        inArray(backfillJobs.status, ["queued", "running"]),
        ne(connections.status, "disabled"),
        or(sql`${connections.pausedUntil} is null`, lt(connections.pausedUntil, now)),
      ),
    )
    .orderBy(asc(backfillJobs.createdAt))
    .limit(1);
  return rows[0]?.job ?? null;
}

/**
 * How far a stream's import has got, for display.
 *
 * Belongs to the STREAM and not to a flow, so every flow reading that stream
 * shows the same state — two dashboards on one Calendly stream cannot disagree
 * about whether its numbers are still growing.
 *
 * Returns null when nothing is importing, which is the common case and must
 * stay silent: a note on a stream that finished weeks ago is noise.
 */
export async function streamImportProgress(
  db: DB,
  streamId: string,
): Promise<{ reachedBack: Date; targetBack: Date } | null> {
  const [job] = await db
    .select()
    .from(backfillJobs)
    .where(and(eq(backfillJobs.streamId, streamId), inArray(backfillJobs.status, ["queued", "running"])))
    .orderBy(asc(backfillJobs.targetFloor))
    .limit(1);
  if (!job) return null;
  return {
    // Before the first slice lands there is nothing behind us yet, so the
    // reached depth is "now" — which renders as "covering 0 of 90 days" rather
    // than as a number that looks like progress nobody made.
    reachedBack: job.reachedFloor ?? new Date(),
    targetBack: job.targetFloor,
  };
}

/**
 * 10(b) — jobs that claim to be running and are not moving.
 *
 * `lastProgressAt` rather than `updatedAt`, because any write touches the
 * latter: a job retried every ten minutes without ever advancing its checkpoint
 * looks perfectly healthy by `updatedAt` and is exactly the thing worth
 * flagging.
 */
export async function stalledJobs(db: DB, stalledForMs: number, now = new Date()): Promise<BackfillJob[]> {
  const cutoff = new Date(now.getTime() - stalledForMs);
  return db
    .select()
    .from(backfillJobs)
    .where(and(eq(backfillJobs.status, "running"), isNotNull(backfillJobs.lastProgressAt), lt(backfillJobs.lastProgressAt, cutoff)));
}
