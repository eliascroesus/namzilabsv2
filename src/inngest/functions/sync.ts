import { eq } from "drizzle-orm";
import { inngest } from "../client";
import { getDb } from "@/db/client";
import { runSync, reprocessConnection, syncChanged } from "@/lib/sync/resync";
import { expireAgedResults, markStaleForSource, materializeStaleAll } from "@/lib/flow/materialize";
import { sendOpsAlert } from "@/lib/alerts";
import { pruneOperationalTables, pruneSettledTestRuns, retentionBacklog } from "@/lib/storage-lifecycle";
import { pruneMcpTables } from "@/lib/mcp/audit";
import { getJob, runnableJobsByProvider } from "@/lib/backfill/jobs";
import { scanInvariants } from "@/lib/health/invariants";
import { scanWebhookEventTime } from "@/lib/webhooks/event-time";

/**
 * How many providers may have a slice in flight from one dispatch tick.
 *
 * Bounds the FLEET, which per-connection limits cannot: a dozen accounts on one
 * API are a dozen different connections and a dozen different leases. Four
 * providers at once, one slice each.
 */
const BACKFILL_PROVIDERS_PER_TICK = 4;
import { runBackfillSlice, type SliceOutcome } from "@/lib/backfill/run";
import { backfillRunBudgetMs, backfillSlicesPerRun } from "@/lib/limits";
import { connections, rawEvents } from "@/db/schema";

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
    const res = await step.run("reprocess", () => reprocessConnection(getDb(), orgId, connectionId));
    /**
     * A reprocess exists to CHANGE stored rows (new normalize logic, new date
     * canonicalization), and the rows it changes count as updates the sweep
     * will never see — a webhook-only source is not even polled. It leaned on
     * the blanket ten-minute recompute to surface its effect; tiles now
     * recompute when something says they must, so this says it. Best-effort,
     * like every mark.
     */
    if (res.processed > 0) {
      await step.run("mark-stale", async () => {
        try {
          const db = getDb();
          const [c] = await db.select({ source: connections.source }).from(connections).where(eq(connections.id, connectionId)).limit(1);
          return c ? (await markStaleForSource(db, orgId, c.source, connectionId)).length : 0;
        } catch {
          return 0;
        }
      });
    }
    return res;
  },
);

/**
 * New data landed — mark dependent published flows stale, then kick the
 * debounced recompute.
 *
 * NO LONGER on the production path: the sweep (reconcileOne) and the webhook
 * processor (processEvent) mark staleness DIRECTLY now, because on the live
 * dashboard this hop demonstrably never landed — a full day of ingested rows
 * left every dependent tile un-marked while every directly-callable link
 * (the mark predicate, the recompute cron) worked when exercised. Kept
 * registered so events already in flight at deploy time, and any manual
 * emission, still do the right thing.
 */
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
  // Scoped to the org whose event this is — the debounce and concurrency keys
  // above only mean what they claim when the body works on that org alone. An
  // unscoped pass here recomputed EVERY tenant's stale flows under a per-org
  // lock, so two orgs' bursts ran two concurrent fleet-wide passes over the
  // same rows.
  async ({ event, step }) =>
    step.run("materialize-stale", () => materializeStaleAll(getDb(), { orgId: (event.data as { orgId: string }).orgId })),
);

/**
 * THE TEN-MINUTE SWEEP — every scheduled concern that has to touch Postgres,
 * on ONE tick, so the database is woken once instead of twice.
 *
 * WHY THE WAKE IS THE UNIT. Neon bills compute by the hour the endpoint is
 * AWAKE, and it stays awake for the whole autosuspend window (5 minutes) after
 * the last query. So a query costs five billed minutes whether it takes one
 * millisecond or thirty seconds, and the only number that matters is HOW MANY
 * DISTINCT TIMES something wakes it.
 *
 * This used to be two crons: this one every ten minutes and
 * `backfill-dispatch` every FIVE. The five-minute one is what made the pattern
 * continuous — the wake at :00 held
 * until :05, the :05 wake held until :10, and the endpoint never got five idle
 * minutes in which to suspend. Measured on the bill: 35.95 compute-hours in a
 * fortnight, of which essentially all of it was idle time held open by polls
 * that found nothing to do.
 *
 * Folding dispatch in here halves the wake count and changes NOTHING about the
 * work: same queries, same events, same budgets. Backfill dispatch moves from
 * every five minutes to every ten, which `runBackfill` more than pays back by
 * draining many slices per wake instead of one (see there).
 *
 * `reconcile-connections` keeps its own function and its own ten-minute cron — it
 * already lands on this exact tick, so it shares the wake for free. Merging it
 * too would buy nothing and would couple the connector sweep to this one.
 *
 * ORDER IS CHEAPEST-AND-MOST-INDEPENDENT FIRST, and that is deliberate rather
 * than cosmetic. A `step.run` that throws aborts the rest of the attempt — the
 * completed steps stay memoized and the retry resumes past them, so nothing is
 * lost, but within one attempt a failure blocks what follows. `materializeStaleAll`
 * is the only expensive step here and the only one that can plausibly exhaust a
 * budget, so it goes LAST, where it cannot delay a backfill dispatch that costs
 * one query. Splitting them into separate functions is what we are undoing; this
 * ordering is what keeps the property that split was giving us.
 */
export const materializeStale = inngest.createFunction(
  { id: "materialize-stale", retries: 2, triggers: [{ cron: "*/10 * * * *" }] },
  async ({ step }) => {
    /**
     * Backfill dispatch: one narrow read, and an event per runnable job. It
     * was its own five-minute function; the only thing that changed is the
     * clock it hangs on.
     */
    const dispatched = await step.run("dispatch-backfill-jobs", async () => {
      const due = await runnableJobsByProvider(getDb(), BACKFILL_PROVIDERS_PER_TICK);
      return due.map((r) => ({ jobId: r.job.id, orgId: r.job.orgId, provider: r.provider }));
    });
    if (dispatched.length > 0) {
      await step.sendEvent(
        "dispatch-backfill-slices",
        dispatched.map((d) => ({ name: "backfill/slice.requested" as const, data: d })),
      );
    }

    // The expiry before the recompute: sliding-window tiles ("last 7 days")
    // change with the CLOCK rather than with data, so nothing else would ever
    // mark them stale and they would sit frozen behind a green dot.
    await step.run("expire-aged-results", () => expireAgedResults(getDb()));

    // The backstop, last: anything the event path missed still recomputes —
    // fleet-wide, longest-stale first, under the pass's own time budget.
    const swept = await step.run("materialize-stale", () => materializeStaleAll(getDb()));
    return { dispatched: dispatched.length, ...swept };
  },
);

/**
 * H.6 storage lifecycle: nightly retention over the operational tables that
 * grow with activity (delivery_log, test_runs, usage_ledger), plus a frequent
 * sweep of settled Test runs so the editor's working state never accumulates.
 */
export const pruneStorage = inngest.createFunction(
  { id: "prune-storage", retries: 2, concurrency: { limit: 1 }, triggers: [{ cron: "17 3 * * *" }] },
  async ({ step }) => {
    const settled = await step.run("prune-settled-test-runs", () => pruneSettledTestRuns(getDb()));
    /**
     * INSPECT ONLY while `STORAGE_PRUNE_LIVE` is unset, which is the rollout
     * gate and the reason the mode is a parameter rather than a constant.
     *
     * The counter tier is new logic that decides what to delete — a row is
     * disposable if `observed_limit IS NULL AND throttled = 0 AND errors = 0`
     * — and a predicate that classifies rows as worthless should be read by a
     * human against real data before it is allowed to act on real data. So the
     * first run reports what it WOULD remove, split by tier, and removes
     * nothing. Inspect counts are exact rather than capped, so that same run
     * also answers the question nobody can currently answer: how far past
     * retention the tables already are.
     *
     * Flipping the gate is a one-line env change and needs no deploy.
     */
    const inspect = process.env.STORAGE_PRUNE_LIVE !== "1";
    const retained = await step.run("prune-operational-tables", () =>
      pruneOperationalTables(getDb(), { inspect }),
    );
    if (retained.inspected) {
      // The whole point of the inspect run is that a human reads the numbers,
      // so they go to the log as well as the durable return value. Same
      // `[name]` shape as `[invariant-scan]` and `[mirror-drift]`.
      console.warn(`[storage-prune-inspect] ${JSON.stringify(retained)}`);
    } else if (retained.truncated) {
      // A ceiling stopped the sweep with rows still past retention. Harmless
      // once; night after night it means ingest has outpaced the sweep.
      console.warn(`[storage-prune-truncated] ${JSON.stringify(retained)}`);
      // Its own step, so a retry of a LATER step cannot re-send the email.
      await step.run("alert-prune-truncated", () =>
        sendOpsAlert(
          "[namzilabs] storage prune truncated — retention not keeping up",
          JSON.stringify(retained, null, 2),
        ),
      );
    }
    // MCP audit rows (90 days) and expired client bindings, under the same inspect gate.
    const mcp = await step.run("prune-mcp-tables", () => pruneMcpTables(getDb(), { inspect }));
    if (mcp.inspected) console.warn(`[storage-prune-inspect] mcp ${JSON.stringify(mcp)}`);
    // H.6 capacity signal: what is STILL past retention after this run. A
    // non-zero backlog that persists night after night means pruning is not
    // keeping up with ingest — visible here before it becomes a disk problem.
    const backlog = await step.run("measure-retention-backlog", () => retentionBacklog(getDb()));
    /**
     * The webhook event-time scan: for every catch-hook connection, work out
     * which payload key holds the event time and record it.
     *
     * OBSERVATION ONLY while `WEBHOOK_EVENT_TIME_LIVE` is unset, which is the
     * rollout gate and the whole reason this is a separate step. Detecting a
     * better key and using it for new events without restamping the old ones
     * would date one metric two different ways — uniformly wrong beats
     * incoherent — so the gate flips both halves at once, and until it does,
     * `scripts/webhook-event-time.sql` says what each connection would pick.
     *
     * Reads only: a sample of stored payloads and one aggregate. No provider
     * calls, because the payloads are already ours.
     */
    const eventTime = await step.run("detect-webhook-event-time", () => scanWebhookEventTime(getDb()));
    /**
     * 10(b) — the internal invariant scan. Reads only, no provider calls.
     *
     * Every check is of the shape "something that should be moving has
     * stopped", which is the class nothing else here can see: a stream that is
     * never polled writes no error, a wedged backfill still reports `running`,
     * and a connection whose failures are retried forever looks busy. That is
     * the 0012 failure — weeks of a sync entry point throwing while every test
     * stayed green, because nothing asked whether work was reaching the code
     * that could fail.
     *
     * Reported rather than written onto the connection's `lastError`, which is
     * the wrong field twice over: it means "the provider failed", and any
     * successful poll clears it — so a flag put there would be wiped by the
     * next sweep and the signal lost.
     */
    const invariants = await step.run("scan-invariants", () => scanInvariants(getDb()));
    if (invariants.anyFindings) {
      // The run's return value is structured and durable; this line is what a
      // log search finds. Same shape as `[instantly-probe]` and
      // `[mirror-drift]`, so one grep covers every "look at this" signal.
      console.warn(`[invariant-scan] ${JSON.stringify(invariants)}`);
      // THE ALERT the scan was built for: `anyFindings` exists so "a caller
      // can alert without re-deriving it" (invariants.ts) — and for its whole
      // life the caller only logged. Its own step: memoized on retry, so the
      // email cannot be re-sent by a later step failing. Fail-soft inside, so
      // a mail hiccup cannot fail the scan.
      await step.run("alert-invariant-findings", () =>
        sendOpsAlert("[namzilabs] nightly invariant scan: findings", JSON.stringify(invariants, null, 2)),
      );
    }
    return { settledTestRuns: settled, ...retained, backlog, invariants, webhookEventTime: eventTime };
  },
);

/**
 * E.8 / Phase 6 — the backfill lane, dispatcher half.
 *
 * Split into dispatcher + worker for one reason: a cron function has no event
 * data, so it cannot express a PER-PROVIDER concurrency key. Automatic
 * triggering makes that the cap that matters — a day's signups can queue a
 * dozen imports at once, and the per-connection lease does not help because
 * those are different connections. Several concurrent historical walks against
 * one API, from the lowest-priority work in the system, is exactly the shape
 * that gets an account limited.
 *
 * So this emits at most one job PER PROVIDER per tick, and the worker keys its
 * concurrency on the provider as well. Both, because this bounds what is
 * dispatched and that bounds what runs — a retry or a redelivery can put work
 * in flight this never emitted.
 */
/**
 * THE DISPATCHER IS NOW A STEP OF THE TEN-MINUTE SWEEP, not a function of its
 * own — see `materializeStale` for why the wake count is what costs money. The
 * per-provider bound this comment describes is unchanged: it still emits at
 * most `BACKFILL_PROVIDERS_PER_TICK` jobs, one per provider, and the worker
 * below still keys its concurrency on the provider.
 */

/**
 * The worker. MANY SLICES PER INVOCATION, each its own durable step.
 *
 * IT USED TO BE ONE SLICE PER INVOCATION, and the next slice waited for the
 * dispatcher's next tick — five minutes later. That made a hundred-slice import
 * take over eight hours of wall clock, and it meant the import's pace was set by
 * a cron interval rather than by anything about the provider. Moving dispatch to
 * a ten-minute tick would have made it sixteen hours.
 *
 * So the loop moved inside. Each slice is still its own `step.run`, so every one
 * is individually durable and checkpointed exactly as before — an interruption
 * still costs a slice rather than an import, which was the original property and
 * is the one worth keeping.
 *
 * THE PACE WAS NEVER THE RATE LIMIT. `claimCalls` is the ceiling on provider
 * spend and `withConnectionSyncLock` is what stops two walks over one stream;
 * both live inside the slice and neither changed. The five-minute gap was an
 * artifact of how the work was scheduled, not a throttle anybody designed — and
 * a throttle that only exists because of a cron interval is one nobody can tune.
 *
 * WHY A COUNT AND NOT ONLY A CLOCK. Inngest re-executes this function body from
 * the top after every step, replaying memoized results, so a `Date.now()` taken
 * in the body is a DIFFERENT number on each replay. A slice count is
 * deterministic across replays; the wall-clock budget rides along as a second
 * guard and is allowed to be approximate, because exiting the loop early is
 * always safe — the job keeps its checkpoint and the next tick resumes it.
 *
 * Priority -600 against the sweep's 0 and a Test's 180. The budget ceiling is
 * enforced a layer down in `claimCalls`, where it is derived from the SWEEP's
 * ceiling — so the ordering holds even if this configuration is later changed.
 */
export const runBackfill = inngest.createFunction(
  {
    id: "run-backfill",
    retries: 2,
    // Global cap, then the one that automatic triggering actually needs: never
    // two historical walks against the same provider at once.
    concurrency: [{ limit: 4 }, { key: "event.data.provider", limit: 1 }],
    // A job already in flight must not be started again by a redelivery: it
    // would double the provider spend and interleave two walks over one stream.
    singleton: { key: "event.data.jobId", mode: "skip" },
    priority: { run: "-600" },
    triggers: [{ event: "backfill/slice.requested" }],
  },
  async ({ event, step }) => {
    const db = getDb();
    // Only the ID crosses the step boundary. Inngest serializes a step's return
    // value to JSON, so a job object would arrive with its timestamps turned
    // into strings, and every date comparison in the slice would then compare a
    // string to a Date. Re-reading is also more correct: the row may have moved.
    const { jobId, provider } = event.data as { jobId: string; provider: string };
    /**
     * MEMOIZED, so the budget is measured from when the RUN began rather than
     * from whenever the latest replay happened to start. Read in the body on
     * every replay, which means the elapsed figure includes replay overhead and
     * the loop errs towards stopping early — the safe direction, because a
     * stopped loop leaves a checkpointed job the next tick resumes.
     */
    const startedAt = await step.run("run-started-at", () => Date.now());

    let slices = 0;
    let last: SliceOutcome | { kind: "finished"; status: "failed" } = { kind: "finished", status: "failed" };

    for (let i = 0; i < backfillSlicesPerRun(); i++) {
      const slice = await step.run(`run-slice-${i}`, async () => {
        const job = await getJob(db, jobId);
        if (!job) return { outcome: { kind: "finished" as const, status: "failed" as const }, ref: null };
        const outcome = await runBackfillSlice(db, job);
        // Strings only across the boundary, for the same reason as above.
        return { outcome, ref: { orgId: job.orgId, connectionId: job.connectionId, streamHash: job.streamHash } };
      });
      const { outcome, ref } = slice;
      last = outcome;
      slices = i + 1;
      if (!ref) return { jobId, outcome, slices };

      /**
       * Phase 7 — recompute at CHECKPOINT boundaries, not per record.
       *
       * Marking stale and stopping there is the batching: staleness is
       * idempotent, so however many slices land between two runs of the
       * ten-minute sweep, they collapse into one recompute. Emitting
       * `flow/recompute.requested` per checkpoint instead would NOT coalesce
       * usefully — its debounce is ten seconds, and now that slices run back to
       * back rather than five minutes apart, every slice would drag the whole
       * stale set through a full pass. Draining the loop made that argument
       * STRONGER, not weaker.
       */
      if (outcome.kind === "progressed" && outcome.rows > 0) {
        await step.run(`mark-stale-at-checkpoint-${i}`, () =>
          markStaleForSource(db, ref.orgId, provider, ref.connectionId, [ref.streamHash]),
        );
      }

      /**
       * On completion, ONE authoritative full recompute — and it must not be a
       * `markStaleForSource` that a concurrent sweep has already cleared.
       *
       * `materializeFlow` reruns the published graph from scratch against stored
       * data and never consults the stale flag, so the final number is computed
       * once over everything the import landed rather than accumulated from the
       * partial passes along the way.
       *
       * `failed` is excluded: a failed job imported nothing authoritative, and
       * its checkpoint recomputes already covered whatever did land.
       */
      if (outcome.kind === "finished") {
        if (outcome.status !== "failed") {
          const flowIds = await step.run(`collect-affected-flows-${i}`, () =>
            markStaleForSource(db, ref.orgId, provider, ref.connectionId, [ref.streamHash]),
          );
          if (flowIds.length > 0) {
            await step.sendEvent(
              `authoritative-recompute-${i}`,
              flowIds.map((flowId) => ({ name: "flow/materialize.requested" as const, data: { orgId: ref.orgId, flowId } })),
            );
          }
        }
        return { jobId, outcome, slices };
      }

      /**
       * DEFERRED STOPS THE LOOP, and this is the most important line in it.
       *
       * `deferred` is the provider budget refusing (`claimCalls`) or a tripped
       * breaker, and it carries a `retryAfterMs`. Looping past it would do the
       * exact thing the ceiling exists to prevent — hammer an API that has
       * already said no, from the lowest-priority work in the system. One slice
       * per five minutes hid this because the next attempt was always far away;
       * draining the loop is what makes it something that has to be handled.
       *
       * Returning rather than breaking, so the outcome the caller sees is the
       * refusal itself rather than a count that looks like ordinary progress.
       */
      if (outcome.kind === "deferred") return { jobId, outcome, slices };

      // Out of wall clock. The job keeps its checkpoint and the next sweep tick
      // picks it up exactly where this run stopped.
      if (Date.now() - startedAt >= backfillRunBudgetMs()) break;
    }
    return { jobId, outcome: last, slices };
  },
);
