import { Inngest } from "inngest";

/**
 * Event contract (documentation for the two internal events we emit):
 *   ingest/raw.received      -> { rawEventId: string }
 *   ingest/reconcile.requested -> { connectionId: string }
 *
 * The durable execution client. Inngest gives us retries with exponential
 * backoff, concurrency control, scheduled (cron) functions, step-level
 * memoization, and a failure hook — the reliability backbone. We do not
 * hand-roll queues or retry loops.
 */
export const inngest = new Inngest({ id: "namzilabs" });
