import { eq } from "drizzle-orm";
import { inngest } from "../client";
import { getDb } from "@/db/client";
import { connections } from "@/db/schema";
import { reconcileConnection } from "@/ingestion/reconcile";

/**
 * Scheduled reconciliation/backfill sweep. Every 10 minutes it re-polls each
 * active connection and dedups the results against stored events, catching
 * anything the instant webhook path missed. This is the gap-filling safety net.
 *
 * When a sweep actually lands new rows it emits `flow/data.changed` (same event
 * the webhook path sends), so poll-discovered changes mark dependent flows
 * stale and dashboards refresh — previously only webhooks and full re-syncs did.
 */
export const reconcileAll = inngest.createFunction(
  { id: "reconcile-connections", retries: 3, triggers: [{ cron: "*/10 * * * *" }] },
  async ({ step }) => {
    const db = getDb();
    const active = await step.run("load-active-connections", () =>
      db.select({ id: connections.id }).from(connections).where(eq(connections.status, "active")),
    );

    const results: Array<{ connectionId: string; inserted: number; deduped: number }> = [];
    for (const conn of active) {
      const r = await step.run(`reconcile-${conn.id}`, () => reconcileConnection(db, conn.id));
      results.push({ connectionId: conn.id, inserted: r.inserted, deduped: r.deduped });
      if (r.inserted > 0) {
        await step.run(`notify-flows-${conn.id}`, () =>
          inngest.send({ name: "flow/data.changed", data: { orgId: r.orgId, source: r.source, connectionId: conn.id } }),
        );
      }
    }
    return { connections: active.length, results };
  },
);

/** On-demand reconciliation for a single connection (admin "re-sync now"). */
export const reconcileOne = inngest.createFunction(
  { id: "reconcile-one-connection", retries: 3, triggers: [{ event: "ingest/reconcile.requested" }] },
  async ({ event, step }) => {
    const { connectionId } = event.data as { connectionId: string };
    const r = await step.run("reconcile", () => reconcileConnection(getDb(), connectionId));
    if (r.inserted > 0) {
      await step.run("notify-flows", () =>
        inngest.send({ name: "flow/data.changed", data: { orgId: r.orgId, source: r.source, connectionId } }),
      );
    }
    return r;
  },
);
