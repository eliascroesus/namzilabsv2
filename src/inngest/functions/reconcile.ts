import { inngest } from "../client";
import { getDb } from "@/db/client";
import { reconcileConnection, reconcileChanged, dueConnectionsForSweep } from "@/ingestion/reconcile";
import { expireAgedResults, markStaleForSource, materializeStaleAll } from "@/lib/flow/materialize";
import { runnableJobForConnection } from "@/lib/backfill/jobs";
import { runBackfillSlice } from "@/lib/backfill/run";

/**
 * C.4 — fan-out reconciliation.
 *
 * The 10-minute cron is a DISPATCHER: it loads active connections and emits one
 * `ingest/reconcile.requested` event per connection. The serial loop it
 * replaces saturated at roughly 500–600 connections per 10-minute window; with
 * fan-out, one slow provider delays only its own connection and the window
 * scales with worker concurrency instead of the sum of poll latencies.
 *
 * F.4 lands here BY DESIGN: the serial loop spread provider calls naturally,
 * so parallelizing it is the moment synchronized bursts become possible. Each
 * dispatched event carries a random jitter the worker sleeps in-process before
 * polling, de-synchronizing the herd at every cron tick without extra steps.
 */
export const reconcileAll = inngest.createFunction(
  {
    id: "reconcile-connections",
    retries: 3,
    // C.1: never let two dispatch sweeps stack.
    concurrency: { limit: 1 },
    triggers: [{ cron: "*/10 * * * *" }],
  },
  async ({ step }) => {
    const db = getDb();
    // Only ACTIVE connections are swept: "disabled" is the user's off switch,
    // and "error" means credentials/processing are broken — polling would burn
    // provider quota on guaranteed failures until the connection is repaired
    // (reconnect / replay flips it back to active).
    //
    // F.3/F.6: connections DEFERRED by budget exhaustion or a tripped breaker
    // are skipped until `paused_until` — filtered here so they don't even
    // generate queue traffic. Because every pause carries an expiry, they
    // rejoin the sweep automatically (the probe) with no human intervention.
    const active = await step.run("load-active-connections", () => dueConnectionsForSweep(db));

    if (active.length > 0) {
      await step.sendEvent(
        "dispatch-reconciles",
        active.map((conn) => ({
          name: "ingest/reconcile.requested" as const,
          data: {
            connectionId: conn.id,
            orgId: conn.orgId,
            // Sweep lane: lowest priority — interactive work outranks it.
            priority: 0,
            // F.4: spread the herd across the tick (slept durably in the worker).
            jitterMs: Math.floor(Math.random() * 5_000),
          },
        })),
      );
    }
    return { connections: active.length, dispatched: active.length };
  },
);

/**
 * The per-connection reconcile worker — the sweep's unit of work AND the
 * on-demand "re-sync now" path (higher `priority` in the event data wins the
 * queue; the future Test lane rides the same mechanism).
 */
export const reconcileOne = inngest.createFunction(
  {
    id: "reconcile-one-connection",
    retries: 3,
    // Pileup guard: while a run for this connection is in flight, NEW events
    // for it are SKIPPED, not queued — a slow/wedged connection can't
    // accumulate a backlog across successive cron ticks. (Per-tick idempotency
    // wouldn't help: each tick mints a distinct key and still queues.) The
    // skipped tick loses nothing — the next tick re-dispatches, and singleton
    // also serializes per connection (C.1's queue-level guarantee).
    singleton: { key: "event.data.connectionId", mode: "skip" },
    // C.3: a global cap so a big fleet can't stampede providers/Neon, and a
    // per-TENANT cap so one org's many connections can't monopolize the pool.
    concurrency: [{ limit: 10 }, { key: "event.data.orgId", limit: 3 }],
    // Interactive lanes outrank the sweep: priority is seconds of queue boost.
    /* `event.data.priority`, not `?? 0` — CEL has no `??`, and that operator
       failed the whole app's sync. See the long note in process-event.ts. The
       dispatcher above is this event's only sender and always sets priority. */
    priority: { run: "event.data.priority" },
    triggers: [{ event: "ingest/reconcile.requested" }],
  },
  async ({ event, step }) => {
    const { connectionId, jitterMs } = event.data as { connectionId: string; jitterMs?: number };
    // F.4, durable form: step.sleep suspends the run WITHOUT holding a
    // concurrency slot (an in-process sleep would idle one of the 10 global
    // workers). Costs one extra step, only on sweep-lane runs; the Q8 sharded
    // scheduler replaces this dispatcher before that step count matters.
    const wait = Math.min(Math.max(jitterMs ?? 0, 0), 10_000);
    if (wait > 0) await step.sleep("jitter", wait);
    const r = await step.run("reconcile", () => reconcileConnection(getDb(), connectionId));
    if (reconcileChanged(r)) {
      /**
       * Staleness is written HERE, in the same function that ingested the
       * data — durable DB state, not a hope that a second event hop gets
       * delivered and handled. This used to emit `flow/data.changed` and stop:
       * on the production dashboard, a day of new spreadsheet rows (14:20
       * through 21:20, sweep after sweep) left every dependent tile "fresh"
       * at its 11:50 publish-time compute — the mark never landed, and
       * nothing between the send and the handler says why. A direct call has
       * no such gap.
       */
      // Best-effort: the ingest work above is already committed, and a failed
      // mark must not fail the sweep run.
      await step.run("mark-stale", () =>
        markStaleForSource(getDb(), r.orgId, r.source, connectionId, r.changedStreamHashes).catch(() => [] as string[]),
      );
    }

    /**
     * AND RECOMPUTE HERE TOO — for the same reason the mark moved here.
     *
     * Marking alone fixed half the problem: measured on production the
     * morning after, all eight of one org's tiles were correctly stale and
     * not one had recomputed in twenty-one hours. Every other explanation was
     * ruled out against the live database — each stale flow resolves its
     * published version, the stale-selection query returns them in order, and
     * `materializeFlow` writes either "fresh" or "error" on every path — so
     * `materializeStaleAll` was simply never being invoked. Both of its
     * callers (the `materialize-stale` cron and the `flow/recompute.requested`
     * handler) live on the infrastructure that already lost the staleness
     * event, while THIS function demonstrably runs every ten minutes.
     *
     * Unconditional, not gated on `reconcileChanged`: rows can be marked by
     * the webhook path or aged out by the clock, and a sweep that found no
     * new records is exactly when those would otherwise sit. The cost when
     * nothing is stale is one indexed SELECT. Org-scoped, budgeted, and
     * best-effort — the tail is picked up by the next sweep, longest-stale
     * first, and a recompute failure must never fail an ingest run.
     *
     * The cron and the event handler stay: this is the belt, not a
     * replacement for the braces.
     */
    await step.run("refresh-tiles", async () => {
      const db = getDb();
      try {
        // The clock is a data source too: "last 7 days" moves at midnight
        // with no new records at all.
        const expired = await expireAgedResults(db, undefined, r.orgId);
        const { recomputed, pending } = await materializeStaleAll(db, { orgId: r.orgId });
        return { expired, recomputed, pending };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    });

    /**
     * ONE SLICE OF HISTORY, LAST — for the third time the same reason, with
     * the review's two corrections built in.
     *
     * Measured on production: a Google Calendar import sat `queued` for two
     * days with `attempts: 0`, `started_at: null`, "covering 0 of 92 days"
     * on the customer's screen — while the connection, the stream and the
     * job were all healthy and that same stream was polled every ten
     * minutes by THIS function. Its two runners (the backfill-dispatch cron
     * and the run-backfill event worker) sit on the mechanisms that already
     * failed to deliver staleness events; nothing had ever picked the job
     * up. So the sweep advances its own connection's import by one slice.
     *
     * AFTER refresh-tiles, not before: the recompute is this function's
     * guarantee to the dashboard, and history arriving late must never sit
     * upstream of it. The slice itself is wall-clock bounded now
     * (SLICE_BUDGET_MS through PollBudget.deadlineMs), and its whole job
     * lifecycle runs inside the connection lease, so the event-lane worker
     * and this can never both settle one job. Skipped when the sweep was
     * deferred or stood down — a spent budget or a held lease means exactly
     * that. Rows it lands are marked stale here and recomputed next tick;
     * ten minutes of lag on months-old history is nothing.
     *
     * The dispatcher and worker stay registered: belt, not braces removal.
     */
    if (!r.deferredUntil && !r.skipped) {
      await step.run("backfill-slice", async () => {
        const db = getDb();
        try {
          const job = await runnableJobForConnection(db, connectionId);
          if (!job) return { ran: false };
          const outcome = await runBackfillSlice(db, job);
          if ((outcome.kind === "progressed" && outcome.rows > 0) || outcome.kind === "finished") {
            await markStaleForSource(db, r.orgId, r.source, connectionId, job.streamHash ? [job.streamHash] : null);
          }
          return { ran: true, outcome };
        } catch (e) {
          // History is the lowest-priority work in the system; its failure
          // must never fail an ingest run that already committed.
          return { ran: true, error: e instanceof Error ? e.message : String(e) };
        }
      });
    }
    return r;
  },
);
