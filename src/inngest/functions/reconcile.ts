import { inngest } from "../client";
import { getDb } from "@/db/client";
import { reconcileConnection, reconcileChanged, dueConnectionsForSweep } from "@/ingestion/reconcile";
import { markStaleForSource } from "@/lib/flow/materialize";

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
    priority: { run: "event.data.priority ?? 0" },
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
       * no such gap, and the 10-minute `materializeStale` cron picks stale
       * rows up even if the recompute kick below is lost too.
       */
      // Best-effort: the ingest work above is already committed, and a failed
      // mark must not fail the sweep run — the ten-minute cron plus the
      // hourly expiry bound how long a missed mark can matter.
      const marked = await step.run("mark-stale", () =>
        markStaleForSource(getDb(), r.orgId, r.source, connectionId, r.changedStreamHashes).catch(() => [] as string[]),
      );
      if (marked.length > 0) {
        await step.run("kick-recompute", () =>
          inngest.send({ name: "flow/recompute.requested", data: { orgId: r.orgId } }),
        );
      }
    }
    return r;
  },
);
