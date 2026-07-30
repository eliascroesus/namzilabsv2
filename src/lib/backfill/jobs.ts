import { and, asc, eq, inArray, isNotNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { backfillJobs, connections, sourceStreams } from "@/db/schema";
import type { DB } from "@/db/types";
import type { ImportCoverage } from "@/connectors/types";

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
 * Snap a target to UTC midnight.
 *
 * Without this, "90 days back" is a different instant on every call, so two
 * requests a second apart produce two different targets and the unique index
 * never matches. Harmless while a human had to click a button; fatal the moment
 * the request became automatic, because every flow save would have started
 * another import of the same history.
 *
 * A day is the right grain: nobody means "90 days and 14 seconds", and a
 * date-shaped floor is legible in the table and in a log.
 */
export function quantizeFloor(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Ask for a stream to be imported back to `targetFloor`.
 *
 * 6.1, "never re-import", is a DEPTH comparison and not a timestamp match. Any
 * existing job that already reaches at least this far back satisfies the
 * request — including one that reached further — so a second flow on a
 * backfilled stream costs zero provider calls and only a genuinely DEEPER
 * window is new work.
 *
 * The unique index on `(stream_id, target_floor)` is still there and still
 * load-bearing, but as a race backstop rather than as the rule: two concurrent
 * requests for the same quantized day cannot both insert.
 *
 * `failed` jobs are deliberately not counted as satisfying a request. A failure
 * is the one terminal state worth retrying, and treating it as coverage would
 * mean a stream that errored once could never be imported again.
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
  const target = quantizeFloor(targetFloor);

  // Already as deep, or deeper? Then there is nothing to do. `lte` because
  // deeper means FURTHER BACK, which is a smaller timestamp.
  const [covering] = await db
    .select()
    .from(backfillJobs)
    .where(
      and(
        eq(backfillJobs.streamId, stream.id),
        lte(backfillJobs.targetFloor, target),
        inArray(backfillJobs.status, ["queued", "running", "complete", "partial"]),
      ),
    )
    .orderBy(asc(backfillJobs.targetFloor))
    .limit(1);
  if (covering) return { job: covering, created: false };

  // A FAILED job at exactly this depth is retried in place rather than joined by
  // a second row. The unique index would refuse the insert anyway, but that is
  // not why: it is the same unit of work, and reviving it keeps the checkpoint,
  // so the retry RESUMES where the failure stopped instead of re-fetching
  // everything that already landed.
  const revived = await db
    .update(backfillJobs)
    .set({ status: "queued", detail: null, finishedAt: null, updatedAt: new Date() })
    .where(
      and(eq(backfillJobs.streamId, stream.id), eq(backfillJobs.targetFloor, target), eq(backfillJobs.status, "failed")),
    )
    .returning();
  if (revived[0]) return { job: revived[0], created: true };

  const rows = await db
    .insert(backfillJobs)
    .values({
      orgId: stream.orgId,
      connectionId: stream.connectionId,
      streamId: stream.id,
      streamHash: stream.configHash,
      targetFloor: target,
      rowCeiling: rowCeilingFor(source),
    })
    .onConflictDoNothing({ target: [backfillJobs.streamId, backfillJobs.targetFloor] })
    .returning();
  if (rows[0]) return { job: rows[0], created: true };

  // Lost the race against a concurrent identical request; its row is the answer.
  const [existing] = await db
    .select()
    .from(backfillJobs)
    .where(and(eq(backfillJobs.streamId, stream.id), eq(backfillJobs.targetFloor, target)))
    .limit(1);
  return { job: existing, created: false };
}

/** One job by id. */
export async function getJob(db: DB, id: string): Promise<BackfillJob | null> {
  const [row] = await db.select().from(backfillJobs).where(eq(backfillJobs.id, id)).limit(1);
  return row ?? null;
}

/** The default depth, snapped to a day so repeated requests are identical. */
export function defaultTargetFloor(now = new Date()): Date {
  return quantizeFloor(new Date(now.getTime() - DEFAULT_TARGET_DAYS * DAY_MS));
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
 * Up to `limit` runnable jobs, AT MOST ONE PER PROVIDER, oldest first.
 *
 * Skips connections that are disabled or deferred: a backfill against a
 * disconnected integration is work nobody asked for against credentials nobody
 * authorised any more, and one against a paused connection would spend exactly
 * the budget the pause exists to protect.
 *
 * One per provider is the point, not a detail of the query. Automatic
 * triggering means a day's signups can queue a dozen imports at once, and
 * without this the dispatcher would happily fan them all out against the same
 * API — several concurrent historical walks, from the lowest-priority work in
 * the system, at exactly the moment a provider is least inclined to be
 * forgiving. The per-connection lease does not help: those are different
 * connections.
 *
 * The worker enforces it again through its own concurrency key. Both, because
 * this one bounds what is DISPATCHED and that one bounds what RUNS, and a retry
 * or a redelivery can put work in flight this never emitted.
 */
export async function runnableJobsByProvider(
  db: DB,
  limit: number,
  now = new Date(),
): Promise<Array<{ job: BackfillJob; provider: string }>> {
  const rows = await db
    .select({ job: backfillJobs, provider: connections.source })
    .from(backfillJobs)
    .innerJoin(connections, eq(connections.id, backfillJobs.connectionId))
    .where(
      and(
        inArray(backfillJobs.status, ["queued", "running"]),
        ne(connections.status, "disabled"),
        or(sql`${connections.pausedUntil} is null`, lt(connections.pausedUntil, now)),
      ),
    )
    .orderBy(asc(backfillJobs.createdAt));

  const picked: Array<{ job: BackfillJob; provider: string }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.provider)) continue;
    seen.add(row.provider);
    picked.push(row);
    if (picked.length >= limit) break;
  }
  return picked;
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
export async function streamImportProgress(db: DB, streamId: string, now = new Date()): Promise<ImportCoverage | null> {
  const [job] = await db
    .select()
    .from(backfillJobs)
    .where(and(eq(backfillJobs.streamId, streamId), inArray(backfillJobs.status, ["queued", "running"])))
    .orderBy(asc(backfillJobs.targetFloor))
    .limit(1);
  if (!job) return null;
  return coverageOf(job.reachedFloor, job.targetFloor, now.getTime());
}

/**
 * How much of its target window a job holds, in the same two-span shape
 * connectors report (`PollResult.importProgress`).
 *
 * THE ONE PLACE THIS LANE ASSUMES A DIRECTION, stated here rather than spread
 * across the readers. `reached_floor` is the oldest record a slice has imported,
 * so `now - reached_floor` is the covered span only while the walk runs
 * newest-first and fills backwards from now.
 *
 * That holds for every provider the lane runs against today. It does NOT hold
 * for an oldest-first log like Close's Event Log, where slice one lands on the
 * target floor and this would read as complete immediately — the same defect
 * `spanCovered` removed from the connectors. Fixing it properly needs the
 * newest record a slice saw, which is a `newest_seen` column on `backfill_jobs`
 * and therefore a migration; until then this is a known bound on the lane, and
 * Close has never been connected so nothing depends on it yet.
 */
function coverageOf(reachedFloor: Date | null, targetFloor: Date, now: number): ImportCoverage {
  return {
    // Before the first slice lands there is nothing behind us yet, so the
    // covered span is zero — which renders as "covering 0 of 90 days" rather
    // than as a number that looks like progress nobody made.
    coveredMs: reachedFloor ? Math.max(0, now - reachedFloor.getTime()) : 0,
    targetMs: Math.max(0, now - targetFloor.getTime()),
  };
}

/**
 * Import progress for a batch of streams named the way a FLOW knows them —
 * `(connectionId, configHash)` — rather than by stream UUID.
 *
 * Read at RENDER time, never snapshotted onto the result row, and that is the
 * requirement rather than a preference: `materializeFlow` writes each flow's
 * tiles in its own call, so two flows on one backfilling stream materialized
 * minutes apart would bake in different numbers and disagree about the same
 * import. Joining here means the state has exactly one home.
 *
 * One query for the whole dashboard. Empty in, empty out.
 *
 * Scoped by `orgId` like every sibling read here, and not merely for symmetry:
 * the connection ids come from `flow_results.provenance`, which is graph content
 * rather than a validated foreign key, so a graph naming another tenant's
 * connection would otherwise read that tenant's import state. The hash check
 * below narrows it further; neither is a substitute for the org predicate.
 */
export async function importProgressByStreamRef(
  db: DB,
  orgId: string,
  refs: Array<{ connectionId: string; configHash: string }>,
  now = new Date(),
): Promise<Map<string, ImportCoverage>> {
  const out = new Map<string, ImportCoverage>();
  if (refs.length === 0) return out;

  const rows = await db
    .select({
      connectionId: sourceStreams.connectionId,
      configHash: sourceStreams.configHash,
      reachedFloor: backfillJobs.reachedFloor,
      targetFloor: backfillJobs.targetFloor,
    })
    .from(backfillJobs)
    .innerJoin(sourceStreams, eq(sourceStreams.id, backfillJobs.streamId))
    .where(
      and(
        eq(backfillJobs.orgId, orgId),
        inArray(backfillJobs.status, ["queued", "running"]),
        inArray(
          sourceStreams.connectionId,
          refs.map((r) => r.connectionId),
        ),
      ),
    )
    .orderBy(asc(backfillJobs.targetFloor));

  const wanted = new Set(refs.map((r) => `${r.connectionId}:${r.configHash}`));
  for (const row of rows) {
    const key = `${row.connectionId}:${row.configHash}`;
    // The connection filter is the indexable half; the hash has to be checked
    // here, or one backfilling stream would label every stream on its
    // connection.
    if (!wanted.has(key) || out.has(key)) continue;
    out.set(key, coverageOf(row.reachedFloor, row.targetFloor, now.getTime()));
  }
  return out;
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
