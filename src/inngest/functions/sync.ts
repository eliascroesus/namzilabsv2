import { eq } from "drizzle-orm";
import { inngest } from "../client";
import { getDb } from "@/db/client";
import { runSync, reprocessConnection, syncChanged } from "@/lib/sync/resync";
import { markStaleForSource, materializeStaleAll } from "@/lib/flow/materialize";
import { pruneOperationalTables, pruneSettledTestRuns, retentionBacklog } from "@/lib/storage-lifecycle";
import { getJob, nextRunnableJob, stalledJobs } from "@/lib/backfill/jobs";

/**
 * How long a `running` backfill may go without moving before it is reported.
 *
 * The lane ticks every five minutes, so six hours is roughly seventy missed
 * opportunities to progress — comfortably past a deferral streak on a busy
 * provider, and far short of letting a genuinely wedged import sit unnoticed
 * for a day.
 */
const STALLED_BACKFILL_MS = 6 * 3_600_000;
import { runBackfillSlice } from "@/lib/backfill/run";
import { rawEvents } from "@/db/schema";

/** Sync a connection (full backfill/re-sync or incremental). */
export const syncConnection = inngest.createFunction(
  {
    id: "sync-connection",
    retries: 3,
    // C.1: one sync per connection at a time — a full re-sync's generation
    // bump + retire sweep must never interleave with another sync of the same
    // connection. (Cross-function exclusion vs the cron sweep arrives with the
    // advisory-lock critical sections once the pool driver is live.)
    concurrency: { key: "event.data.connectionId", limit: 1 },
    triggers: [{ event: "sync/connection.requested" }],
  },
  async ({ event, step }) => {
    const { connectionId, mode } = event.data as { connectionId: string; mode: "full" | "incremental" };
    const res = await step.run("sync", () => runSync(getDb(), connectionId, mode));
    // Inserts, in-place updates and soft-deletes all change dashboard truth —
    // a full re-sync that ONLY retired rows must still refresh tiles.
    if (syncChanged(res)) {
      await step.run("mark-stale", () => markStaleForSource(getDb(), res.orgId, res.source, connectionId));
    }
    return res;
  },
);

/** Re-normalize a connection's canonical events from raw_events. */
export const reprocessConnectionFn = inngest.createFunction(
  { id: "reprocess-connection", retries: 3, triggers: [{ event: "sync/reprocess.requested" }] },
  async ({ event, step }) => {
    const { orgId, connectionId } = event.data as { orgId: string; connectionId: string };
    return step.run("reprocess", () => reprocessConnection(getDb(), orgId, connectionId));
  },
);

/** New data landed — mark dependent published flows stale, then kick the debounced recompute. */
export const flowDataChanged = inngest.createFunction(
  { id: "flow-data-changed", retries: 2, triggers: [{ event: "flow/data.changed" }] },
  async ({ event, step }) => {
    const data = event.data as {
      orgId?: string;
      source?: string;
      rawEventId?: string;
      connectionId?: string;
      /** G.1: which streams actually changed, when the producer knows. */
      streamHashes?: string[];
    };
    let marked: string[] = [];
    let orgId = data.orgId ?? null;
    if (data.orgId && data.source) {
      marked = await step.run("mark", () =>
        markStaleForSource(getDb(), data.orgId as string, data.source as string, data.connectionId ?? null, data.streamHashes ?? null),
      );
    } else if (data.rawEventId) {
      const res = await step.run("mark-from-raw", async () => {
        const db = getDb();
        const [raw] = await db
          .select({ orgId: rawEvents.orgId, source: rawEvents.source, connectionId: rawEvents.connectionId })
          .from(rawEvents)
          .where(eq(rawEvents.id, data.rawEventId as string))
          .limit(1);
        return raw ? { orgId: raw.orgId, marked: await markStaleForSource(db, raw.orgId, raw.source, raw.connectionId) } : null;
      });
      marked = res?.marked ?? [];
      orgId = res?.orgId ?? null;
    }
    // G.2: something went stale → ask for a recompute; the debounced function
    // coalesces a burst of these into one run per org.
    if (marked.length > 0 && orgId) {
      await step.run("kick-recompute", () => inngest.send({ name: "flow/recompute.requested", data: { orgId } }));
    }
    return marked;
  },
);

/**
 * G.2 — debounced recompute. A burst of data changes (webhook storm, one busy
 * sweep) collapses into ONE materialization per org: each new event inside the
 * period pushes the run back, and the run recomputes everything stale at once.
 * Work scales with data-change rate, never with event volume.
 */
export const recomputeStaleFlows = inngest.createFunction(
  {
    id: "recompute-stale-flows",
    retries: 2,
    debounce: { key: "event.data.orgId", period: "10s" },
    concurrency: { key: "event.data.orgId", limit: 1 },
    triggers: [{ event: "flow/recompute.requested" }],
  },
  async ({ step }) => step.run("materialize-stale", () => materializeStaleAll(getDb())),
);

/** Scheduled backstop: anything the event path missed still recomputes. */
export const materializeStale = inngest.createFunction(
  { id: "materialize-stale", retries: 2, triggers: [{ cron: "*/10 * * * *" }] },
  async ({ step }) => step.run("materialize-stale", () => materializeStaleAll(getDb())),
);

/**
 * H.6 storage lifecycle: nightly retention over the operational tables that
 * grow with activity (delivery_log, test_runs), plus a frequent sweep of
 * settled Test runs so the editor's working state never accumulates.
 */
export const pruneStorage = inngest.createFunction(
  { id: "prune-storage", retries: 2, concurrency: { limit: 1 }, triggers: [{ cron: "17 3 * * *" }] },
  async ({ step }) => {
    const settled = await step.run("prune-settled-test-runs", () => pruneSettledTestRuns(getDb()));
    const retained = await step.run("prune-operational-tables", () => pruneOperationalTables(getDb()));
    // H.6 capacity signal: what is STILL past retention after this run. A
    // non-zero backlog that persists night after night means pruning is not
    // keeping up with ingest — visible here before it becomes a disk problem.
    const backlog = await step.run("measure-retention-backlog", () => retentionBacklog(getDb()));
    /**
     * 10(b) — an internal invariant scan, no provider calls.
     *
     * A backfill job that says `running` and has not moved its checkpoint is
     * invisible by every other measure: it is retried on schedule, it writes
     * rows on every attempt, and `updated_at` advances each time. Only
     * `last_progress_at` can tell it from a healthy one.
     *
     * Reported rather than written onto the connection's `lastError`, which is
     * the wrong field twice over: it means "the provider failed", and any
     * successful poll clears it — so a flag put there would be wiped by the
     * next sweep and the signal lost.
     */
    const stalled = await step.run("scan-stalled-backfills", async () =>
      (await stalledJobs(getDb(), STALLED_BACKFILL_MS)).map((j) => ({
        jobId: j.id,
        streamId: j.streamId,
        rowsImported: j.rowsImported,
        lastProgressAt: j.lastProgressAt,
      })),
    );
    return { settledTestRuns: settled, ...retained, backlog, stalledBackfills: stalled };
  },
);

/**
 * E.8 / Phase 6 — the backfill lane.
 *
 * Its own function rather than work folded into the sweep, for three reasons
 * that all reduce to the same one: a historical import must never be able to
 * degrade live sync.
 *
 *  - **Lowest priority.** The sweep runs at 0 and a Test at 180; this runs
 *    below both, so a queue under pressure drains interactive work first.
 *  - **Global concurrency of 1.** A backfill is throughput-insensitive by
 *    nature — it is allowed to take days — so there is nothing to gain from
 *    running several and a great deal to lose: N imports would multiply the
 *    provider spend of the lowest-priority work in the system.
 *  - **One slice per invocation.** Every unit is durable, so an interruption
 *    costs a slice rather than an import, which is the whole point of
 *    checkpointing.
 *
 * The budget ceiling is enforced a layer down, in `claimCalls`, where it is
 * derived from the SWEEP's ceiling — so the ordering holds even if this
 * function's own configuration is later changed.
 */
export const runBackfill = inngest.createFunction(
  {
    id: "run-backfill",
    retries: 2,
    concurrency: { limit: 1 },
    priority: { run: "-600" },
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async ({ step }) => {
    const db = getDb();
    // Only the ID crosses the step boundary. Inngest serializes a step's return
    // value to JSON, so a job object would arrive at the next step with its
    // timestamps turned into strings — and every date comparison in the slice
    // would then compare a string to a Date and quietly do the wrong thing.
    // Re-reading is also more correct: the row may have moved on.
    const jobId = await step.run("next-runnable-job", async () => (await nextRunnableJob(db))?.id ?? null);
    if (!jobId) return { ran: false };
    const outcome = await step.run("run-slice", async () => {
      const job = await getJob(db, jobId);
      return job ? await runBackfillSlice(db, job) : { kind: "finished" as const, status: "failed" as const };
    });
    return { ran: true, jobId, outcome };
  },
);
