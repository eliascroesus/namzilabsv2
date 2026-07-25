import { Inngest } from "inngest";

/**
 * Event contract (documentation for the internal events we emit):
 *   ingest/raw.received        -> { rawEventId: string, orgId: string }
 *   ingest/reconcile.requested -> { connectionId: string, orgId: string,
 *                                   priority?: number, jitterMs?: number }
 *   flow/data.changed          -> { orgId, source, connectionId?, streamHashes? } | { rawEventId }
 *   flow/recompute.requested   -> { orgId: string }
 * Lanes (C.5): within reconcile-one-connection, `priority` is seconds of queue
 * boost — sweep runs send 0; interactive senders (the future Test lane) send
 * high values. Backfill gets its own low-priority function when E.8 lands.
 *
 * The durable execution client. Inngest gives us retries with exponential
 * backoff, concurrency control, scheduled (cron) functions, step-level
 * memoization, and a failure hook — the reliability backbone. We do not
 * hand-roll queues or retry loops.
 */
export const inngest = new Inngest({ id: "namzilabs" });
