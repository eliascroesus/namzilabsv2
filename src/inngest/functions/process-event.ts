import { inngest } from "../client";
import { getDb } from "@/db/client";
import { processRawEvent, deadLetterRawEvent } from "@/ingestion/pipeline";

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
    if (res.inserted > 0) {
      await step.run("notify-flows", () => inngest.send({ name: "flow/data.changed", data: { rawEventId } }));
    }
    return res;
  },
);
