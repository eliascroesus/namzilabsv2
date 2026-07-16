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
    triggers: [{ event: "ingest/raw.received" }],
    onFailure: async ({ error, event }) => {
      const original = event.data.event?.data as { rawEventId?: string } | undefined;
      if (!original?.rawEventId) return;
      await deadLetterRawEvent(getDb(), original.rawEventId, MAX_RETRIES + 1, error.message ?? String(error));
    },
  },
  async ({ event, step }) => {
    const { rawEventId } = event.data as { rawEventId: string };
    return step.run("process-raw-event", () => processRawEvent(getDb(), rawEventId));
  },
);
