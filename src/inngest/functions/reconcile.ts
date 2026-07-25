import { eq } from "drizzle-orm";
import { inngest } from "../client";
import { getDb } from "@/db/client";
import { connections } from "@/db/schema";
import { reconcileConnection, reconcileChanged } from "@/ingestion/reconcile";

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
    const active = await step.run("load-active-connections", () =>
      db.select({ id: connections.id, orgId: connections.orgId }).from(connections).where(eq(connections.status, "active")),
    );

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
      await step.run("notify-flows", () =>
        inngest.send({
          name: "flow/data.changed",
          data: { orgId: r.orgId, source: r.source, connectionId, streamHashes: r.changedStreamHashes },
        }),
      );
    }
    return r;
  },
);
