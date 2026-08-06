import { eq } from "drizzle-orm";
import { inngest } from "../client";
import { getDb } from "@/db/client";
import { runSync, reprocessConnection, syncChanged } from "@/lib/sync/resync";
import { markStaleForSource, materializeStaleAll } from "@/lib/flow/materialize";
import { pruneOperationalTables, pruneSettledTestRuns, retentionBacklog } from "@/lib/storage-lifecycle";
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
import { runBackfillSlice } from "@/lib/backfill/run";
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
  // Scoped to the org whose event this is — the debounce and concurrency keys
  // above only mean what they claim when the body works on that org alone. An
  // unscoped pass here recomputed EVERY tenant's stale flows under a per-org
  // lock, so two orgs' bursts ran two concurrent fleet-wide passes over the
  // same rows.
  async ({ event, step }) =>
    step.run("materialize-stale", () => materializeStaleAll(getDb(), { orgId: (event.data as { orgId: string }).orgId })),
);

/** Scheduled backstop: anything the event path missed still recomputes —
 * fleet-wide by design, longest-stale first, under the pass's time budget. */
export const materializeStale = inngest.createFunction(
  { id: "materialize-stale", retries: 2, triggers: [{ cron: "*/10 * * * *" }] },
  async ({ step }) => step.run("materialize-stale", () => materializeStaleAll(getDb())),
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
    }
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
export const backfillDispatch = inngest.createFunction(
  { id: "backfill-dispatch", retries: 2, concurrency: { limit: 1 }, triggers: [{ cron: "*/5 * * * *" }] },
  async ({ step }) => {
    const db = getDb();
    const due = await step.run("pick-runnable-jobs", async () =>
      (await runnableJobsByProvider(db, BACKFILL_PROVIDERS_PER_TICK)).map((r) => ({
        jobId: r.job.id,
        orgId: r.job.orgId,
        provider: r.provider,
      })),
    );
    if (due.length === 0) return { dispatched: 0 };
    await step.sendEvent(
      "dispatch-backfill-slices",
      due.map((d) => ({ name: "backfill/slice.requested" as const, data: d })),
    );
    return { dispatched: due.length };
  },
);

/**
 * The worker. One slice per invocation, so every unit is durable and an
 * interruption costs a slice rather than an import.
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
    const slice = await step.run("run-slice", async () => {
      const job = await getJob(db, jobId);
      if (!job) return { outcome: { kind: "finished" as const, status: "failed" as const }, ref: null };
      const outcome = await runBackfillSlice(db, job);
      // Strings only across the boundary, for the same reason as above.
      return { outcome, ref: { orgId: job.orgId, connectionId: job.connectionId, streamHash: job.streamHash } };
    });
    const { outcome, ref } = slice;
    if (!ref) return { jobId, outcome };

    /**
     * Phase 7 — recompute at CHECKPOINT boundaries, not per record.
     *
     * Marking stale and stopping there is the batching: staleness is idempotent,
     * so however many slices land between two runs of the ten-minute
     * `materializeStale` cron, they collapse into one recompute. Emitting
     * `flow/recompute.requested` per checkpoint instead would NOT coalesce —
     * its debounce window is ten seconds and slices are five minutes apart, so
     * every slice would drag the whole stale set through a full pass.
     *
     * `syncConnection` already works exactly this way: mark, and let the cron
     * recompute.
     */
    if (outcome.kind === "progressed" && outcome.rows > 0) {
      await step.run("mark-stale-at-checkpoint", () =>
        markStaleForSource(db, ref.orgId, provider, ref.connectionId, [ref.streamHash]),
      );
    }

    /**
     * On completion, ONE authoritative full recompute — and it must not be a
     * `markStaleForSource` that a concurrent cron pass has already cleared.
     *
     * `materializeFlow` reruns the published graph from scratch against stored
     * data and never consults the stale flag, so the final number is computed
     * once over everything the import landed rather than accumulated from the
     * partial passes along the way.
     *
     * `failed` is excluded: a failed job imported nothing authoritative, and its
     * checkpoint recomputes already covered whatever did land.
     */
    if (outcome.kind === "finished" && outcome.status !== "failed") {
      const flowIds = await step.run("collect-affected-flows", () =>
        markStaleForSource(db, ref.orgId, provider, ref.connectionId, [ref.streamHash]),
      );
      if (flowIds.length > 0) {
        await step.sendEvent(
          "authoritative-recompute",
          flowIds.map((flowId) => ({ name: "flow/materialize.requested" as const, data: { orgId: ref.orgId, flowId } })),
        );
      }
    }
    return { jobId, outcome };
  },
);
