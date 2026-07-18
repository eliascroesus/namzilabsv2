import { eq } from "drizzle-orm";
import { inngest } from "../client";
import { getDb } from "@/db/client";
import { runSync, reprocessConnection } from "@/lib/sync/resync";
import { markStaleForSource, materializeStaleAll } from "@/lib/flow/materialize";
import { rawEvents } from "@/db/schema";

/** Sync a connection (full backfill/re-sync or incremental). */
export const syncConnection = inngest.createFunction(
  { id: "sync-connection", retries: 3, triggers: [{ event: "sync/connection.requested" }] },
  async ({ event, step }) => {
    const { connectionId, mode } = event.data as { connectionId: string; mode: "full" | "incremental" };
    const res = await step.run("sync", () => runSync(getDb(), connectionId, mode));
    if (res.upserted > 0) {
      await step.run("mark-stale", () => markStaleForSource(getDb(), res.orgId, res.source));
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

/** New data landed — mark dependent published flows stale (debounced by the cron below). */
export const flowDataChanged = inngest.createFunction(
  { id: "flow-data-changed", retries: 2, triggers: [{ event: "flow/data.changed" }] },
  async ({ event, step }) => {
    const data = event.data as { orgId?: string; source?: string; rawEventId?: string };
    if (data.orgId && data.source) {
      return step.run("mark", () => markStaleForSource(getDb(), data.orgId as string, data.source as string));
    }
    if (data.rawEventId) {
      return step.run("mark-from-raw", async () => {
        const db = getDb();
        const [raw] = await db
          .select({ orgId: rawEvents.orgId, source: rawEvents.source, connectionId: rawEvents.connectionId })
          .from(rawEvents)
          .where(eq(rawEvents.id, data.rawEventId as string))
          .limit(1);
        return raw ? markStaleForSource(db, raw.orgId, raw.source, raw.connectionId) : [];
      });
    }
    return [];
  },
);

/** Recompute stale published-flow results on a schedule. */
export const materializeStale = inngest.createFunction(
  { id: "materialize-stale", retries: 2, triggers: [{ cron: "*/10 * * * *" }] },
  async ({ step }) => step.run("materialize-stale", () => materializeStaleAll(getDb())),
);
