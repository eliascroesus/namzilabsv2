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
    const active = await step.run("load-active-connections", () =>
      db.select({ id: connections.id }).from(connections).where(eq(connections.status, "active")),
    );

    if (active.length > 0) {
      await step.sendEvent(
        "dispatch-reconciles",
        active.map((conn) => ({
          name: "ingest/reconcile.requested" as const,
          data: {
            connectionId: conn.id,
            // Sweep lane: lowest priority — interactive work outranks it.
            priority: 0,
            // F.4: spread the herd across the tick (0–5s, slept in-process).
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
    // Two levels: a global cap so a big fleet can't stampede providers/Neon,
    // and per-connection serialization (C.1) so the same connection is never
    // polled concurrently.
    concurrency: [{ limit: 10 }, { key: "event.data.connectionId", limit: 1 }],
    // Interactive lanes outrank the sweep: priority is seconds of queue boost.
    priority: { run: "event.data.priority ?? 0" },
    triggers: [{ event: "ingest/reconcile.requested" }],
  },
  async ({ event, step }) => {
    const { connectionId, jitterMs } = event.data as { connectionId: string; jitterMs?: number };
    const r = await step.run("reconcile", async () => {
      // In-process jitter (no extra Inngest step): only the sweep lane sets it.
      const wait = Math.min(Math.max(jitterMs ?? 0, 0), 10_000);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      return reconcileConnection(getDb(), connectionId);
    });
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
