import { Inngest } from "inngest";

/**
 * Event contract (documentation for the internal events we emit):
 *   ingest/raw.received        -> { rawEventId: string, orgId: string }
 *   ingest/reconcile.requested -> { connectionId: string, orgId: string,
 *                                   priority?: number, jitterMs?: number }
 *   flow/data.changed          -> { orgId, source, connectionId?, streamHashes? } | { rawEventId }
 *   flow/recompute.requested   -> { orgId: string }
 *   backfill/slice.requested   -> { jobId: string, orgId: string, provider: string }
 * Lanes (C.5): within reconcile-one-connection, `priority` is seconds of queue
 * boost — sweep runs send 0; interactive senders (the future Test lane) send
 * high values. Backfill gets its own low-priority function when E.8 lands.
 *
 * SENDER RULE for ingest/reconcile.requested: the cron dispatcher ONLY. The
 * worker is singleton-skip (an in-flight connection's new events are silently
 * dropped — correct for a sweep that re-dispatches every tick, a trust bug for
 * anything user-initiated). User actions ride sync/connection.requested, which
 * QUEUES per connection and always runs. Pinned in tests/inngest-config.test.ts.
 *
 * The durable execution client. Inngest gives us retries with exponential
 * backoff, concurrency control, scheduled (cron) functions, step-level
 * memoization, and a failure hook — the reliability backbone. We do not
 * hand-roll queues or retry loops.
 */
export const inngest = new Inngest({ id: "namzilabs" });

/**
 * THE PLAN'S CONCURRENCY CEILING — ONE NUMBER, BECAUSE IT IS ONE FACT.
 *
 * Inngest refuses to sync an app whose functions declare more concurrency than
 * the account's plan allows, and a refused sync is TOTAL: every function stops
 * registering, not just the offender. That is the same failure mode the `??`
 * expressions caused, arriving through a different door, so it gets the same
 * treatment — a single constant, and a test that no function exceeds it.
 *
 * WHY 5 COSTS NOTHING TODAY. Every function that declares a global cap also
 * declares a PER-KEY one, and the per-key cap is what binds for a single tenant:
 * `reconcile-one-connection` allows 3 per org, `run-flow-test` 2. With one
 * workspace, dropping the global cap from 10 to 5 cannot change how many runs
 * execute — the org cap was already the limit. It was measured, not assumed:
 * the sweep dispatches at most `BACKFILL_PROVIDERS_PER_TICK` jobs and at most
 * one run per connection, and there are six connections in one org.
 *
 * WHEN IT WILL START TO BIND, so this is a dial rather than a wall. The global
 * cap matters once enough ORGS sweep at once to fill it. At ~5 seconds a sweep,
 * five concurrent runs drain ~600 connections inside one ten-minute tick —
 * which, with the cadence ladder backing idle connections off to 30 minutes and
 * beyond, supports thousands of workspaces. Raise this number when queue depth
 * says to, and upgrade the plan in the same breath; buying throughput before
 * then is buying something that cannot be used.
 *
 * LOWER IS ALSO SAFER, WHICH IS WHY THIS IS NOT A COMPROMISE. Capped runs QUEUE,
 * they do not drop, and the next tick re-dispatches anything still waiting. So
 * the cost of a lower cap is latency under load, while the benefit is fewer
 * simultaneous provider calls and fewer concurrent queries against Neon — which
 * autoscales on concurrency.
 */
export const PLAN_MAX_CONCURRENCY = 5;
