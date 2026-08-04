import { and, eq, gt, inArray, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { deadLetter, deliveryLog, rawEvents, testRuns, usageLedger } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * H.6 — storage lifecycle. Operational tables that grow with ACTIVITY rather
 * than with the customer's data must have a retention policy, or they become
 * the biggest table in the database and the slowest thing to vacuum.
 *
 * Policy:
 * - `delivery_log`: an observability trail of every processing attempt. 30d.
 * - `test_runs`: ephemeral editor working state — one row per Test click.
 *   Settled runs 30d; unsettled (queued/running) rows are also swept after
 *   that window, since a run that never settled in 30 days never will.
 * - `usage_ledger`: one row per (connection, operation, minute-window). Two
 *   tiers — see USAGE_COUNTER_DAYS / USAGE_EVIDENCE_DAYS below.
 *
 * NOT swept here: raw_events (replay source of truth — its archive policy is
 * a separate, deliberate decision) and events (customer data, soft-deleted
 * only). Both are still open questions; note that hash-partitioning by org_id
 * would NOT turn either into a partition drop, because dropping a partition
 * discards a tenant rather than a time range.
 *
 * WHY THIS FILE HAS A DRAIN LOOP AND DIDN'T BEFORE. The original pass ran one
 * bounded select + delete per table per night: 5,000 rows removed, once a day.
 * That is fine for `delivery_log` (a row per processing attempt) and was sized
 * for it. `usage_ledger` writes a row per connection per operation per minute
 * — 144 sweeps a day against 2-4 declared operations per provider, so 150-600
 * rows per connection per day. A thousand connections is 200k-600k rows a day
 * arriving against 5k a night leaving. A single-batch pass would have fallen
 * behind on day one and never caught up, and `delivery_log` and `test_runs`
 * reach the same wall later. So the loop is the fix, and it is applied to all
 * three tables rather than only to the one that forced it.
 */

const DAY_MS = 86_400_000;

/** Rows removed per statement — bounded so one sweep can't lock a hot table. */
const DELETE_BATCH = 5_000;

/**
 * Wall-clock ceiling for one prune run.
 *
 * This is the same class of bound as `PROVIDER_CALL_BUDGET_MS`, and it exists
 * for the same reason: work that outlives its container is killed mid-flight,
 * and a killed step is worse than a short one because the next run cannot tell
 * a partial sweep from a completed one.
 *
 * Derived from the route, not guessed. `pruneStorage` executes through
 * `src/app/api/inngest/route.ts`, which declares `maxDuration = 60`, and every
 * `step.run` is its own request against that ceiling. The precedent already in
 * the codebase is that one unit of work gets at most half the route budget —
 * `PROVIDER_CALL_BUDGET_MS` is 30s against the same 60s. This is 20s rather
 * than 30s because the deadline is checked BETWEEN passes, so a run can
 * overshoot it by up to one pass; 20s plus a worst-case pass lands at roughly
 * the same 30s the provider budget occupies, leaving the same headroom.
 *
 * If you raise `maxDuration`, this may rise with it — never past half of it.
 */
const PRUNE_BUDGET_MS = 20_000;

/**
 * Backstop on passes per table, so a clock that does not advance cannot spin.
 *
 * Sized so it is never the binding constraint in production: two round trips
 * per pass cannot realistically complete in under ~50ms, and 20s of budget at
 * 50ms a pass is 400. The wall clock stops a real run; this only stops an
 * unreal one.
 */
const MAX_PASSES = 400;

/**
 * `usage_ledger` retention, in two tiers, because the columns answer different
 * questions and one window cannot serve both.
 *
 * A row whose only content is `calls` is a rate-limiter bucket. It is consulted
 * during its own minute and is dead the moment that minute closes; two days is
 * slack for a missed nightly run, not for a reader.
 *
 * A row carrying `observed_limit`, `throttled` or `errors` is evidence. It
 * answers "what limit does this provider actually enforce, and has it changed?"
 * and "was this budget mis-sized, and when?" — questions that get asked weeks
 * later, when a customer complains about a sync that was quietly being
 * throttled. `scripts/observed-limits.sql` reports on exactly these rows and
 * already says "in the retained window", so this is the window it meant.
 *
 * Two tiers rather than one because evidence is RARE: `throttled` is
 * incremented only on a real denial, `observed_limit` only when a provider
 * actually sent a header (most never do), `errors` only on failure. The
 * overwhelming majority of rows are pure counters, so a single 90-day window
 * would retain hundreds of millions of dead buckets to preserve a handful of
 * useful ones.
 *
 * FLEET rows are not special here. `deleteConnectionData` refuses to delete the
 * fleet sentinel, but that guard is against CONNECTION-scoped deletion, which
 * would destroy a live shared ceiling. Age-based pruning of a window that
 * closed days ago cannot do that, so no exception is needed and none is made.
 */
const USAGE_COUNTER_DAYS = 2;
const USAGE_EVIDENCE_DAYS = 90;

/**
 * How long a verbatim provider payload is kept.
 *
 * `raw_events` is the replay source of truth and the largest table in the
 * schema, and until now it was the one table with NO retention at all — it grew
 * with every webhook for the life of every connection, which is unbounded in
 * exactly the dimension that scales with the product. Thirty days is the
 * decided policy (it matches `delivery_log`, whose rows point at these), and
 * what it costs is stated rather than implied: `reprocessConnection` and the
 * event-time restamp can only rebuild from what still exists, so both become
 * 30-day operations. The NORMALIZED rows in `events` are permanent — pruning a
 * raw never touches the data a dashboard reads.
 *
 * A raw with an UNRESOLVED dead letter is never pruned, whatever its age. The
 * dead letter's replay path reads the raw by id (`replayRawEvent`), so pruning
 * it would turn "failed, will be replayed once fixed" into "failed, gone" —
 * silently, which is the class of deletion this file exists to refuse. The
 * exclusion is by NOT EXISTS rather than by age so a dead letter discovered
 * late still protects its payload.
 */
const RAW_EVENT_DAYS = 30;

/** No unresolved dead letter points at this raw payload. */
const noUnresolvedDeadLetter = () =>
  sql`not exists (select 1 from ${deadLetter} where ${deadLetter.rawEventId} = ${rawEvents.id} and ${deadLetter.resolvedAt} is null)`;

/** A ledger row that recorded something a human might later want to read. */
const hasEvidence = () =>
  or(isNotNull(usageLedger.observedLimit), gt(usageLedger.throttled, 0), gt(usageLedger.errors, 0))!;

/** Its exact complement, so the two tiers partition the table and cannot double-count. */
const noEvidence = () =>
  and(isNull(usageLedger.observedLimit), eq(usageLedger.throttled, 0), eq(usageLedger.errors, 0))!;

export type UsageLedgerTiers = {
  /** Spent rate-limiter buckets: `calls` only, nothing observed. */
  counters: number;
  /** Rows carrying `observed_limit`, `throttled` or `errors`. */
  evidence: number;
};

/** Rows past retention, per table. A measurement — never truncated, never a guess. */
export type RetentionBacklog = {
  deliveryLog: number;
  testRuns: number;
  usageLedger: UsageLedgerTiers;
  /** Verbatim provider payloads past RAW_EVENT_DAYS with no unresolved dead letter. */
  rawEvents: number;
};

export type RetentionResult = RetentionBacklog & {
  /**
   * A ceiling stopped the run with rows still past retention. One night of this
   * is a big backlog draining; several nights running means ingest has outpaced
   * the sweep and the budget or the batch size needs revisiting.
   */
  truncated: boolean;
  /**
   * Inspect mode: nothing was deleted and the counts are exact totals of what
   * WOULD be removed, not what was.
   */
  inspected: boolean;
};

type PruneOpts = {
  deliveryLogDays?: number;
  testRunDays?: number;
  usageCounterDays?: number;
  usageEvidenceDays?: number;
  rawEventDays?: number;
  now?: Date;
  /**
   * Report what would be removed and delete nothing. The counts are exact
   * rather than capped, so this doubles as the true backlog measurement.
   */
  inspect?: boolean;
  /** Injectable for tests; production always uses the real clock. */
  nowMs?: () => number;
  /** Injectable for tests, so multi-pass draining is exercised without seeding 10k rows. */
  batchSize?: number;
};

/** Shared deadline across every table in one run, so no table can starve the rest. */
type RunBudget = { deadline: number; nowMs: () => number };

/**
 * Delete in bounded passes until the predicate is satisfied or a ceiling is hit.
 *
 * Select-then-delete-by-id rather than `DELETE ... WHERE id IN (SELECT ...)`
 * because it is what the rest of this file does, it behaves identically on both
 * drivers, and a short page is an unambiguous "the table is drained" signal
 * without depending on a driver-specific rowCount.
 */
async function drain(
  db: DB,
  table: typeof deliveryLog | typeof testRuns | typeof usageLedger | typeof rawEvents,
  where: SQL,
  budget: RunBudget,
  batchSize: number,
): Promise<{ removed: number; truncated: boolean }> {
  let removed = 0;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    if (budget.nowMs() >= budget.deadline) return { removed, truncated: true };

    const rows = await db.select({ id: table.id }).from(table).where(where).limit(batchSize);
    if (rows.length === 0) return { removed, truncated: false };

    await db.delete(table).where(inArray(table.id, rows.map((r) => r.id)));
    removed += rows.length;

    // A short page means the predicate is now empty: nothing is left to drain,
    // and re-querying to confirm would cost a round trip to learn nothing.
    if (rows.length < batchSize) return { removed, truncated: false };
  }
  return { removed, truncated: true };
}

async function countWhere(
  db: DB,
  table: typeof deliveryLog | typeof testRuns | typeof usageLedger | typeof rawEvents,
  where: SQL,
): Promise<number> {
  const [row] = await db.select({ c: sql<number>`count(*)::int` }).from(table).where(where);
  return Number(row?.c ?? 0);
}

/** The four retention predicates, derived once so prune and inspect cannot drift. */
function predicates(now: Date, opts: PruneOpts) {
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
  return {
    deliveryLog: lt(deliveryLog.createdAt, ago(opts.deliveryLogDays ?? 30))!,
    testRuns: lt(testRuns.createdAt, ago(opts.testRunDays ?? 30))!,
    usageCounters: and(
      lt(usageLedger.windowStart, ago(opts.usageCounterDays ?? USAGE_COUNTER_DAYS)),
      noEvidence(),
    )!,
    usageEvidence: and(
      lt(usageLedger.windowStart, ago(opts.usageEvidenceDays ?? USAGE_EVIDENCE_DAYS)),
      hasEvidence(),
    )!,
    rawEvents: and(
      lt(rawEvents.receivedAt, ago(opts.rawEventDays ?? RAW_EVENT_DAYS)),
      noUnresolvedDeadLetter(),
    )!,
  };
}

export async function pruneOperationalTables(db: DB, opts: PruneOpts = {}): Promise<RetentionResult> {
  const now = opts.now ?? new Date();
  const p = predicates(now, opts);

  if (opts.inspect) {
    // Counted, not drained: in inspect mode the rows are never removed, so a
    // loop would return the same page forever. Exact totals are also the point
    // — this run is what tells us how big the backlog really is before the
    // counter-tier predicate is ever allowed to delete anything.
    //
    // Four concurrent reads, which is the ceiling `MIN_POOL_MAX` in
    // `src/db/client.ts` is derived from. Do not add a fifth.
    const [dl, tr, counters, evidence] = await Promise.all([
      countWhere(db, deliveryLog, p.deliveryLog),
      countWhere(db, testRuns, p.testRuns),
      countWhere(db, usageLedger, p.usageCounters),
      countWhere(db, usageLedger, p.usageEvidence),
    ]);
    // SEQUENTIAL, not a fifth arm of the Promise.all: the pool floor in
    // `src/db/client.ts` is derived from a widest fan-out of four, and the
    // comment above this block is the contract. One more await costs one round
    // trip; a fifth concurrent read invalidates MIN_POOL_MAX.
    const raws = await countWhere(db, rawEvents, p.rawEvents);
    return { deliveryLog: dl, testRuns: tr, usageLedger: { counters, evidence }, rawEvents: raws, truncated: false, inspected: true };
  }

  const nowMs = opts.nowMs ?? Date.now;
  const budget: RunBudget = { deadline: nowMs() + PRUNE_BUDGET_MS, nowMs };
  const batch = opts.batchSize ?? DELETE_BATCH;

  // Sequential, sharing one deadline. Draining tables concurrently would put
  // several bulk deletes on the same connection pool at once, and the pool
  // floor in `src/db/client.ts` is derived assuming this job does one thing at
  // a time. Evidence rows drain last because they are the rarest and the most
  // valuable: if a ceiling stops the run, it should stop it there.
  // Raws drain first: the biggest table with the biggest first-night backlog,
  // and the rows are payload copies whose normalized descendants are permanent —
  // so if the deadline stops the run anywhere, stopping it after the raws have
  // drained loses the least. Evidence rows stay last for the mirror reason.
  const raws = await drain(db, rawEvents, p.rawEvents, budget, batch);
  const dl = await drain(db, deliveryLog, p.deliveryLog, budget, batch);
  const tr = await drain(db, testRuns, p.testRuns, budget, batch);
  const counters = await drain(db, usageLedger, p.usageCounters, budget, batch);
  const evidence = await drain(db, usageLedger, p.usageEvidence, budget, batch);

  return {
    deliveryLog: dl.removed,
    testRuns: tr.removed,
    usageLedger: { counters: counters.removed, evidence: evidence.removed },
    rawEvents: raws.removed,
    truncated: raws.truncated || dl.truncated || tr.truncated || counters.truncated || evidence.truncated,
    inspected: false,
  };
}

/**
 * Settled Test runs are worthless the moment the editor has read them; this
 * tighter sweep keeps the table small between retention runs. Kept separate so
 * the retention policy above stays the single source of the 30-day guarantee.
 */
export async function pruneSettledTestRuns(db: DB, olderThanHours = 24, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - olderThanHours * 3_600_000);
  const rows = await db
    .select({ id: testRuns.id })
    .from(testRuns)
    .where(and(eq(testRuns.status, "ok"), lt(testRuns.updatedAt, cutoff)))
    .limit(DELETE_BATCH);
  if (rows.length === 0) return 0;
  await db.delete(testRuns).where(inArray(testRuns.id, rows.map((r) => r.id)));
  return rows.length;
}

/**
 * Rows currently past retention (for observability / capacity planning).
 *
 * Reported per tier for `usage_ledger`, because the two answer different
 * questions: a growing counter backlog means the sweep is losing to ingest,
 * while a growing evidence backlog after 90 days means something is recording
 * far more throttling than expected.
 */
export async function retentionBacklog(
  db: DB,
  days = 30,
  now = new Date(),
  opts: { usageCounterDays?: number; usageEvidenceDays?: number } = {},
): Promise<RetentionBacklog> {
  const p = predicates(now, {
    deliveryLogDays: days,
    testRunDays: days,
    usageCounterDays: opts.usageCounterDays,
    usageEvidenceDays: opts.usageEvidenceDays,
  });
  // Four concurrent reads — the ceiling `MIN_POOL_MAX` in `src/db/client.ts` is
  // derived from. Do not add a fifth; a pool under that floor deadlocks. The
  // raw-events count therefore runs SEQUENTIALLY after the barrier.
  const [dl, tr, counters, evidence] = await Promise.all([
    countWhere(db, deliveryLog, p.deliveryLog),
    countWhere(db, testRuns, p.testRuns),
    countWhere(db, usageLedger, p.usageCounters),
    countWhere(db, usageLedger, p.usageEvidence),
  ]);
  const raws = await countWhere(db, rawEvents, p.rawEvents);
  return { deliveryLog: dl, testRuns: tr, usageLedger: { counters, evidence }, rawEvents: raws };
}
