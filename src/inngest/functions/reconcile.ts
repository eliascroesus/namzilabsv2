import { eq } from "drizzle-orm";
import { inngest } from "../client";
import { getDb } from "@/db/client";
import { connections } from "@/db/schema";
import { reconcileConnection } from "@/ingestion/reconcile";

/**
 * Scheduled reconciliation/backfill sweep. Every 10 minutes it re-polls each
 * active connection and dedups the results against stored events, catching
 * anything the instant webhook path missed. This is the gap-filling safety net.
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
    }
    return { connections: active.length, results };
  },
);

/** On-demand reconciliation for a single connection (admin "re-sync now"). */
export const reconcileOne = inngest.createFunction(
  { id: "reconcile-one-connection", retries: 3, triggers: [{ event: "ingest/reconcile.requested" }] },
  async ({ event, step }) => {
    const { connectionId } = event.data as { connectionId: string };
    return step.run("reconcile", () => reconcileConnection(getDb(), connectionId));
  },
);
