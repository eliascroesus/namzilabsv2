import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jobBudget, parseWaitSeconds } from "../scripts/lib/job-budget";

/**
 * The guard that stops `verify-calendly.ts` starting a run the CI runner will
 * kill before it finishes.
 *
 * The failure it exists to prevent is specific and expensive: CL11 has to sleep
 * for 600s (base cadence) or 3600s (the webhook backstop) for its answer to say
 * anything about the connector, and a job killed at the ceiling produces NO
 * report — CL0 through CL10 all pass and all of it is discarded. An hour spent,
 * nothing learned.
 *
 * Three properties, and the third is the one that would go wrong silently:
 *
 *   1. the sum includes every term (a forgotten one always over-approves);
 *   2. an unusable wait value is reported, never coerced into a small number
 *      that produces a confident measurement of nothing;
 *   3. the script parses the wait ONCE and guards BEFORE the first request.
 *      A guard that budgets for a different number than the code sleeps for,
 *      or that runs after the requests, is decoration.
 */

const S = (o: Partial<Parameters<typeof jobBudget>[0]> = {}) =>
  jobBudget({
    waitSeconds: 0,
    workSeconds: 0,
    reserveSeconds: 0,
    elapsedSeconds: 0,
    ceilingSeconds: null,
    ...o,
  });

describe("jobBudget — the arithmetic", () => {
  it("adds wait, work and reserve, and names each one in the explanation", () => {
    const b = S({ waitSeconds: 3600, workSeconds: 300, reserveSeconds: 900, ceilingSeconds: 21_600 });
    expect(b.needSeconds).toBe(4800);
    // A refusal has to carry its own reason, so every term must be legible.
    expect(b.explain).toContain("3600s of sleeps");
    expect(b.explain).toContain("300s for this script's own requests");
    expect(b.explain).toContain("900s reserved for later steps");
    expect(b.explain).toContain("4800s");
  });

  it("counts the reserve for later steps — a step that fits alone can still push the ones after it over", () => {
    const tight = { waitSeconds: 3600, workSeconds: 300, elapsedSeconds: 0, ceilingSeconds: 4200 };
    // Without the reserve this fits exactly; with it, it does not. The whole
    // point of the term: Calendly finishing is not the same as the job finishing.
    expect(S({ ...tight, reserveSeconds: 0 }).fits).toBe(true);
    expect(S({ ...tight, reserveSeconds: 900 }).fits).toBe(false);
  });

  it("subtracts time already burned, so a late step is judged on what is LEFT", () => {
    const need = { waitSeconds: 3600, workSeconds: 300, reserveSeconds: 0, ceilingSeconds: 5000 };
    expect(S({ ...need, elapsedSeconds: 0 }).fits).toBe(true);
    expect(S({ ...need, elapsedSeconds: 1200 }).fits).toBe(false);
    expect(S({ ...need, elapsedSeconds: 1200 }).remainingSeconds).toBe(3800);
  });

  it("fits at the exact boundary — need == remaining is not an overrun", () => {
    const b = S({ waitSeconds: 600, workSeconds: 300, reserveSeconds: 100, elapsedSeconds: 0, ceilingSeconds: 1000 });
    expect(b.needSeconds).toBe(1000);
    expect(b.remainingSeconds).toBe(1000);
    expect(b.fits).toBe(true);
  });

  it("the real workflow numbers fit: 3600s wait, all four providers, 6h ceiling", () => {
    // Stated in the workflow input's description, so it has to be true. Close
    // and install run before Calendly; 20 minutes is a generous stand-in.
    const b = S({ waitSeconds: 3600, workSeconds: 300, reserveSeconds: 900, elapsedSeconds: 1200, ceilingSeconds: 360 * 60 });
    expect(b.fits).toBe(true);
    expect(b.remainingSeconds! - b.needSeconds).toBeGreaterThan(4 * 3600);
  });

  it("no ceiling — a laptop — always fits, and says why rather than inventing a limit", () => {
    const b = S({ waitSeconds: 3600, workSeconds: 300, ceilingSeconds: null });
    expect(b.fits).toBe(true);
    expect(b.remainingSeconds).toBeNull();
    expect(b.explain).toContain("no job ceiling declared");
  });

  it("a ceiling with no start time is optimistic, and SAYS SO", () => {
    // The dangerous shape: elapsed silently treated as 0 reads exactly like a
    // measured 0. If the guard is going to be optimistic it has to admit it.
    const b = S({ waitSeconds: 60, ceilingSeconds: 21_600, elapsedSeconds: 0, elapsedKnown: false });
    expect(b.fits).toBe(true);
    expect(b.explain).toContain("ASSUMED");
  });

  it("garbage ceilings and negative elapsed do not become huge budgets", () => {
    expect(S({ waitSeconds: 60, ceilingSeconds: Number.NaN }).remainingSeconds).toBeNull();
    expect(S({ waitSeconds: 60, ceilingSeconds: 0 }).remainingSeconds).toBeNull();
    expect(S({ waitSeconds: 60, workSeconds: 0, reserveSeconds: 0, elapsedSeconds: -5000, ceilingSeconds: 100 }).remainingSeconds).toBe(100);
  });
});

describe("parseWaitSeconds — an unusable wait must not become a small one", () => {
  it("reads the workflow's three choices", () => {
    expect(parseWaitSeconds("60").seconds).toEqual([60]);
    expect(parseWaitSeconds("600").seconds).toEqual([600]);
    expect(parseWaitSeconds("3600").seconds).toEqual([3600]);
  });

  it("reads a bracket, in order, with whitespace", () => {
    expect(parseWaitSeconds(" 60 , 540 ").seconds).toEqual([60, 540]);
  });

  it("REPORTS unusable entries instead of coercing them", () => {
    // `Math.max(1, Number(x) || 0)` — the obvious version — turns this into a
    // 1-second wait and reports a 1-second token lifetime. That is a made-up
    // number wearing the costume of a measurement.
    const r = parseWaitSeconds("ten minutes");
    expect(r.seconds).toEqual([]);
    expect(r.rejected).toEqual(["ten minutes"]);
  });

  it("rejects zero and negatives rather than sleeping for nothing", () => {
    const r = parseWaitSeconds("0,-30,600");
    expect(r.seconds).toEqual([600]);
    expect(r.rejected).toEqual(["0", "-30"]);
  });

  it("an all-bad value yields NO waits, so the caller skips instead of substituting a default", () => {
    expect(parseWaitSeconds("abc,def").seconds).toEqual([]);
  });
});

/**
 * Source assertions. The wiring cannot be imported — `verify-calendly.ts` runs
 * `main()` at import time — but these two properties are the ones that make the
 * guard real rather than decorative, so they get pinned anyway.
 */
describe("verify-calendly wiring", () => {
  const source = readFileSync(join(process.cwd(), "scripts/verify-calendly.ts"), "utf8");

  it("guards BEFORE the first request, not after the last one", () => {
    const guard = source.indexOf("  runtimeGuard();");
    const firstSection = source.indexOf('head("SECTION 0');
    expect(guard).toBeGreaterThan(-1);
    expect(firstSection).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(firstSection);
  });

  it("reads CALENDLY_TOKEN_WAIT in exactly one place", () => {
    // Two parse sites is how the guard ends up budgeting for 60s while CL11
    // sleeps for 3600 — the silent-wrong-answer shape, in the guard itself.
    const reads = source.match(/process\.env\.CALENDLY_TOKEN_WAIT/g) ?? [];
    expect(reads).toHaveLength(1);
  });
});
