import { eq } from "drizzle-orm";
import { inngest } from "../client";
import { getDb } from "@/db/client";
import { connections } from "@/db/schema";
import { sweepConnection } from "@/ingestion/reconcile";
import { materializeStaleAll } from "@/lib/flow/materialize";

/**
 * The scheduled accuracy sweep. Every 10 minutes each active connection is
 * brought back to 1:1 with its source (mirror streams full-refresh; incremental
 * streams walk their cursors — see ingestion/reconcile.ts), dependent flows are
 * marked stale, and stale dashboard tiles are recomputed in the same cycle —
 * so a sheet edit reaches the dashboard without any user action.
 */
export const reconcileAll = inngest.createFunction(
  { id: "reconcile-connections", retries: 3, triggers: [{ cron: "*/10 * * * *" }] },
  async ({ step }) => {
    const db = getDb();
    const active = await step.run("load-active-connections", () =>
      db.select({ id: connections.id }).from(connections).where(eq(connections.status, "active")),
    );

    const results: Array<{ connectionId: string; inserted: number; updated: number; softDeleted: number }> = [];
    let changed = false;
    for (const conn of active) {
      const r = await step.run(`reconcile-${conn.id}`, () => sweepConnection(db, conn.id));
      changed = changed || r.changed;
      results.push({ connectionId: conn.id, inserted: r.inserted, updated: r.updated, softDeleted: r.softDeleted });
    }
    if (changed) await step.run("materialize-stale", () => materializeStaleAll(db));
    return { connections: active.length, results };
  },
);

/** On-demand reconciliation for a single connection (admin "re-sync now"). */
export const reconcileOne = inngest.createFunction(
  { id: "reconcile-one-connection", retries: 3, triggers: [{ event: "ingest/reconcile.requested" }] },
  async ({ event, step }) => {
    const { connectionId } = event.data as { connectionId: string };
    const res = await step.run("reconcile", () => sweepConnection(getDb(), connectionId));
    if (res.changed) await step.run("materialize-stale", () => materializeStaleAll(getDb()));
    return res;
  },
);
