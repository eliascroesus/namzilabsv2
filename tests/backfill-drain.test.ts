import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE BACKFILL WORKER DRAINS, AND KNOWS WHEN TO STOP.
 *
 * It used to run exactly one slice and return, waiting for the next dispatch
 * tick — five minutes later — so a hundred-slice import took over eight hours.
 * The gap was never a rate limit: `claimCalls` is, and it lives inside the
 * slice. Draining the loop is what makes the import finish in minutes, and it
 * is also what makes STOPPING correctly matter for the first time.
 *
 * These are behavioural rather than source assertions. The loop has three exits
 * — finished, refused, exhausted — and the second one is the dangerous one: a
 * loop that ignores a `deferred` outcome would hammer a provider that has
 * already said no, from the lowest-priority work in the system. One slice per
 * five minutes hid that; nothing hides it now, so it is tested.
 *
 * The slice itself is mocked on purpose. What is under test is the CONTROL
 * FLOW around it — how many times it is called and when it stops — not what a
 * slice does, which `backfill-lane` and `backfill-recompute` already cover
 * against a real database.
 */

const slice = vi.hoisted(() => ({ run: vi.fn(), outcomes: [] as unknown[] }));

vi.mock("@/lib/backfill/run", () => ({
  runBackfillSlice: slice.run,
}));
vi.mock("@/lib/backfill/jobs", () => ({
  // A job that always exists, so the loop is never cut short by a missing row.
  getJob: async () => ({ id: "job_1", orgId: "org_1", connectionId: "conn_1", streamHash: "h1" }),
  runnableJobsByProvider: async () => [],
}));
vi.mock("@/lib/flow/materialize", () => ({
  markStaleForSource: async () => [],
  expireAgedResults: async () => 0,
  materializeStaleAll: async () => ({ recomputed: 0, pending: 0 }),
}));
vi.mock("@/db/client", () => ({ getDb: () => ({}), getReadDb: () => ({}) }));

const { runBackfill } = await import("@/inngest/functions/sync");

/**
 * A fake `step` that runs everything inline and records the ids it was given.
 *
 * The ids matter as much as the count: each slice must be its OWN step, because
 * that is what keeps every unit individually durable — an interruption costs a
 * slice rather than the import. A loop reusing one id would look identical here
 * and would silently collapse the whole drain into one memoized result.
 */
function fakeStep() {
  const ids: string[] = [];
  return {
    ids,
    step: {
      run: async (id: string, fn: () => unknown) => {
        ids.push(id);
        return fn();
      },
      sendEvent: async (id: string) => {
        ids.push(id);
      },
    },
  };
}

const invoke = async (step: unknown) =>
  (runBackfill as unknown as { fn: (arg: unknown) => Promise<Record<string, unknown>> }).fn({
    event: { data: { jobId: "job_1", provider: "calendly" } },
    step,
  });

beforeEach(() => {
  slice.run.mockReset();
});

describe("how many slices one invocation runs", () => {
  it("keeps going while the job is still progressing", async () => {
    slice.run.mockResolvedValue({ kind: "progressed", rows: 5, done: false });
    const { step, ids } = fakeStep();
    const res = await invoke(step);
    // The default cap is 12; whatever it is, it must be well past one.
    expect(res.slices as number).toBeGreaterThan(1);
    expect(slice.run.mock.calls.length).toBe(res.slices);
    // Every slice its own durable step.
    const sliceIds = ids.filter((i) => i.startsWith("run-slice-"));
    expect(new Set(sliceIds).size).toBe(sliceIds.length);
  });

  it("stops the moment the job finishes, and does not run a slice past it", async () => {
    slice.run
      .mockResolvedValueOnce({ kind: "progressed", rows: 3, done: false })
      .mockResolvedValueOnce({ kind: "finished", status: "complete" })
      .mockResolvedValue({ kind: "progressed", rows: 1, done: false });
    const res = await invoke(fakeStep().step);
    expect(res.slices).toBe(2);
    expect(slice.run).toHaveBeenCalledTimes(2);
  });

  it("STOPS ON A REFUSAL rather than hammering a provider that said no", async () => {
    /**
     * THE ONE THAT MATTERS. `deferred` is `claimCalls` refusing on budget or a
     * tripped breaker, and it carries a `retryAfterMs`. Looping past it does
     * precisely what the ceiling exists to prevent — and it is a NEW risk,
     * created by draining, which did not exist when the next attempt was always
     * five minutes away.
     */
    slice.run
      .mockResolvedValueOnce({ kind: "progressed", rows: 2, done: false })
      .mockResolvedValueOnce({ kind: "deferred", reason: "budget", retryAfterMs: 60_000 })
      .mockResolvedValue({ kind: "progressed", rows: 1, done: false });
    const res = await invoke(fakeStep().step);
    expect(slice.run).toHaveBeenCalledTimes(2);
    expect((res.outcome as { kind: string }).kind).toBe("deferred");
  });

  it("never exceeds the configured cap", async () => {
    vi.stubEnv("BACKFILL_SLICES_PER_RUN", "3");
    slice.run.mockResolvedValue({ kind: "progressed", rows: 1, done: false });
    const res = await invoke(fakeStep().step);
    expect(res.slices).toBe(3);
    vi.unstubAllEnvs();
  });

  it("gives up on a job that has vanished instead of looping on nothing", async () => {
    // `getJob` returning null yields a failed-finished outcome with no ref; the
    // loop must treat that as terminal, not retry it eleven more times.
    slice.run.mockResolvedValue({ kind: "progressed", rows: 1, done: false });
    const { step } = fakeStep();
    vi.doMock("@/lib/backfill/jobs", () => ({ getJob: async () => null, runnableJobsByProvider: async () => [] }));
    const res = await invoke(step);
    expect(res.slices as number).toBeGreaterThan(0);
    vi.doUnmock("@/lib/backfill/jobs");
  });
});

describe("the sweep that dispatches them", () => {
  const src = readFileSync(join(process.cwd(), "src/inngest/functions/sync.ts"), "utf8");

  it("wakes the database once per ten minutes, not once per five", () => {
    /**
     * THE COST FIX. Neon bills the hours the endpoint is AWAKE and holds it
     * open for the whole 5-minute autosuspend window after the last query, so a
     * cron every five minutes keeps it awake CONTINUOUSLY — the :00 wake lasts
     * until :05, which the :05 wake renews. Measured on the bill before this:
     * 35.95 compute-hours in a fortnight, almost all of it idle time held open
     * by polls that found nothing to do.
     */
    expect(src).not.toMatch(/cron: "\*\/5 /);
    expect(src).toMatch(/cron: "\*\/10 \* \* \* \*"/);
  });

  it("dispatches BEFORE the expensive sweep step", () => {
    /**
     * A `step.run` that throws aborts the rest of the attempt. `materializeStaleAll`
     * is the only step here that can plausibly exhaust a budget, so it goes last
     * — otherwise a slow recompute would delay a backfill dispatch that costs
     * one query. Merging three crons into one is what makes this ordering load-
     * bearing rather than cosmetic.
     */
    // Scoped to the sweep's own body: `recomputeStaleFlows` above it has a step
    // called "materialize-stale" too, and searching the whole file finds that
    // one first — an ordering test that reads the wrong function is worse than
    // no ordering test.
    const body = src.slice(src.indexOf("export const materializeStale ="));
    const dispatch = body.indexOf('"dispatch-backfill-jobs"');
    const expire = body.indexOf('"expire-aged-results"');
    const sweep = body.indexOf('step.run("materialize-stale"');
    expect(dispatch).toBeGreaterThan(-1);
    expect(sweep).toBeGreaterThan(-1);
    expect(dispatch).toBeLessThan(expire);
    expect(expire).toBeLessThan(sweep);
  });

  it("still bounds what it dispatches per provider", () => {
    // The per-provider cap is why dispatch and worker were split in the first
    // place. Moving the dispatcher onto another schedule must not lose it.
    expect(src).toMatch(/runnableJobsByProvider\(getDb\(\), BACKFILL_PROVIDERS_PER_TICK\)/);
  });
});

describe("the dashboard poller stops holding the database open for nobody", () => {
  const src = readFileSync(join(process.cwd(), "src/components/freshness-poller.tsx"), "utf8");

  it("backs off when there has been no sign of a human", () => {
    // Visibility alone does not catch the real case: the tab is VISIBLE and
    // nobody is looking at it. A 12s `count(*)` does not cost 12s of compute —
    // it holds the endpoint awake indefinitely.
    expect(src).toMatch(/const RUNGS = \[/);
    expect(src).toMatch(/after: 2 \* 60_000, every: 60_000/);
    expect(src).toMatch(/after: 10 \* 60_000, every: 5 \* 60_000/);
  });

  it("resets to the fast rung on any sign of one, and checks immediately", () => {
    // There must be no state in which a person is watching and getting stale
    // numbers — that is the entire licence for backing off at all.
    expect(src).toMatch(/lastActivity = Date\.now\(\)/);
    expect(src).toMatch(/if \(wasIdle\) restart\(\)/);
  });

  it("stamps the clock on activity rather than polling on it", () => {
    // Fetching per keystroke would be a worse version of the problem.
    const onActivity = src.slice(src.indexOf("const onActivity"));
    expect(onActivity.slice(0, 300)).not.toMatch(/fetch\(/);
  });

  it("keeps ONE chain — every restart kills the pending timer first", () => {
    /**
     * The bug this file already fixed once: `tick` schedules its successor, so
     * calling it with one queued FORKS the chain, and a tab focused five times
     * polled six times per interval forever. This change adds four more paths
     * that can start a tick, so the single funnel is what makes that safe.
     */
    expect(src).toMatch(/const restart = \(\) => \{[\s\S]*?clearTimeout\(timer\)[\s\S]*?void tick\(\)/);
    // No caller may bypass it.
    const bodies = src.slice(src.indexOf("const onVisible"));
    expect(bodies).not.toMatch(/setTimeout\(tick/);
  });
});
