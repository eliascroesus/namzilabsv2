import { eq } from "drizzle-orm";
import { inngest } from "../client";
import { getDb } from "@/db/client";
import { processRawEvent, deadLetterRawEvent } from "@/ingestion/pipeline";
import { markStaleForSource } from "@/lib/flow/materialize";
import { rawEvents } from "@/db/schema";

const MAX_RETRIES = 5;

/**
 * Processes each inbound raw event out-of-band from the webhook request.
 * - `step.run` makes the processing durable and idempotent across retries.
 * - Inngest retries failures automatically with exponential backoff.
 * - `onFailure` fires only after all retries are exhausted, parking the event
 *   in the dead-letter queue (never dropped, always replayable).
 */
export const processEvent = inngest.createFunction(
  {
    id: "process-inbound-event",
    retries: MAX_RETRIES,
    // One durable run per stored raw event: a duplicate publish of the same
    // rawEventId (webhook redelivery racing the sweep, manual replays) can't
    // fan out into concurrent processors. The events-table dedup stays as the
    // second line of defense.
    idempotency: "event.data.rawEventId",
    // C.3: one tenant's webhook storm can't monopolize the processing pool.
    // (Events sent before orgId was added share the empty key briefly — a
    // deploy-window degradation, not a correctness issue.)
    concurrency: { key: "event.data.orgId ?? ''", limit: 5 },
    triggers: [{ event: "ingest/raw.received" }],
    onFailure: async ({ error, event }) => {
      const original = event.data.event?.data as { rawEventId?: string } | undefined;
      if (!original?.rawEventId) return;
      await deadLetterRawEvent(getDb(), original.rawEventId, MAX_RETRIES + 1, error.message ?? String(error));
    },
  },
  async ({ event, step }) => {
    const { rawEventId } = event.data as { rawEventId: string };
    const res = await step.run("process-raw-event", () => processRawEvent(getDb(), rawEventId));
    /**
     * UPDATES COUNT. This gated on `inserted` alone, and an update-only
     * webhook — a Close lead changing status, a Whop membership renewing —
     * changed the stored record while every tile computed from it stayed
     * "fresh". The blind ten-minute recompute used to paper over that within
     * a cycle; now that tiles recompute only when something says they must,
     * this gate is the something. The next sweep can NOT catch it instead: it
     * re-reads a record that already matches and reports nothing changed.
     */
    if (res.inserted > 0 || res.updated > 0) {
      // Mark directly, same reasoning as reconcileOne: staleness is durable DB
      // state written by the path that ingested the data, never contingent on
      // a `flow/data.changed` hop being delivered. The raw row names the
      // connection; per-event cost is identical to what the handler paid.
      //
      // BEST-EFFORT, never fatal: this runs AFTER the event is ingested, and
      // `onFailure` dead-letters unconditionally — so a transient failure
      // HERE used to be able to file a successfully-ingested event as
      // "webhook processing failed", stamp connections.lastError, and invite
      // a pointless replay. A missed mark costs at most the age backstop:
      // the sweep's expiry pass picks the tile up.
      const marked = await step.run("mark-stale", async () => {
        try {
          const db = getDb();
          const [raw] = await db
            .select({ orgId: rawEvents.orgId, source: rawEvents.source, connectionId: rawEvents.connectionId })
            .from(rawEvents)
            .where(eq(rawEvents.id, rawEventId))
            .limit(1);
          if (!raw) return null;
          return { orgId: raw.orgId, flows: (await markStaleForSource(db, raw.orgId, raw.source, raw.connectionId)).length };
        } catch {
          return null;
        }
      });
      if (marked && marked.flows > 0) {
        await step.run("kick-recompute", () => inngest.send({ name: "flow/recompute.requested", data: { orgId: marked.orgId } }));
      }
    }
    return res;
  },
);
