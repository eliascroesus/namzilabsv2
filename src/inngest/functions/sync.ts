import { eq } from "drizzle-orm";
import { inngest } from "../client";
import { getDb } from "@/db/client";
import { runSync, reprocessConnection, syncChanged } from "@/lib/sync/resync";
import { markStaleForSource, materializeStaleAll } from "@/lib/flow/materialize";
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
