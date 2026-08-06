import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { poolTuning, MIN_POOL_MAX } from "@/db/client";

/**
 * POOL SIZING, asserted rather than trusted.
 *
 * The pool was built as `new Pool({ connectionString })` — node-postgres's
 * default of 10 sockets per container, with no idle timeout and no `end()`
 * anywhere. Every one of those is fine on a long-lived server and wrong on
 * serverless, where containers are many, short-lived, and frozen rather than
 * shut down. Reaching a Postgres connection ceiling does not slow one query
 * down; it refuses connections across the whole app.
 *
 * These are cheap assertions about a pure function, and they exist because the
 * alternative is a number nobody can check sitting in a constructor call.
 */
describe("pool tuning", () => {
  it("caps connections per container, and releases idle ones", () => {
    const t = poolTuning({} as NodeJS.ProcessEnv);
    expect(t.max).toBe(MIN_POOL_MAX);
    // The two settings whose ABSENCE was the bug: without an idle timeout a
    // socket is held until the container dies, and without a connect timeout a
    // request hangs on an exhausted pool instead of failing where it can be seen.
    expect(t.idleTimeoutMillis).toBeGreaterThan(0);
    expect(t.connectionTimeoutMillis).toBeGreaterThan(0);
  });

  it("lets an operator raise the cap", () => {
    expect(poolTuning({ DB_POOL_MAX: "12" } as unknown as NodeJS.ProcessEnv).max).toBe(12);
  });

  /**
   * THE CLAMP, and why it is not politeness about bad input.
   *
   * `scanInvariants` issues four queries through one `Promise.all`, and a
   * transaction holds its client for its whole body — `awaitStreamWriteLock`
   * parks on `pg_advisory_xact_lock` for up to 15 seconds while holding one. A
   * pool smaller than that does not run slower, it DEADLOCKS: the transaction
   * holds the last client waiting for a lock, and the query that would release
   * that lock cannot get a client.
   *
   * So a too-small value is refused rather than honoured. Someone trimming this
   * to fit under a connection ceiling is solving the right problem in the one
   * place that cannot solve it — the lever is container count.
   */
  it("refuses a cap below what one invocation can need", () => {
    for (const v of ["1", "2", "5", "0", "-3", "not a number"]) {
      expect(poolTuning({ DB_POOL_MAX: v } as unknown as NodeJS.ProcessEnv).max).toBe(MIN_POOL_MAX);
    }
  });

  /**
   * The floor is EXACTLY the widest fan-out plus a parked transaction plus a
   * spare — measured from the source, not restated by hand.
   *
   * The previous form was `>= 4 + 1 + 1`, and that inequality is how a real
   * deadlock shipped: `scanInvariants` grew a fifth concurrent read
   * (`rejectingConnections`) while `MIN_POOL_MAX` stayed at 6, and a `>=`
   * against a hand-typed 4 stayed green the whole time. Counting the
   * `Promise.all` destructure in the file itself means widening the fan-out
   * without moving the floor fails HERE, in the same commit, rather than as a
   * hung nightly job at 3am on the pool driver.
   */
  it("the floor is exactly the widest fan-out in the codebase plus a transaction plus a spare", () => {
    const src = readFileSync("src/lib/health/invariants.ts", "utf8");
    const destructure = src.match(/const \[([^\]]+)\]\s*=\s*await Promise\.all/);
    expect(destructure, "scanInvariants' Promise.all destructure not found — update this test's parser").toBeTruthy();
    const fanOut = destructure![1].split(",").map((s) => s.trim()).filter(Boolean).length;
    expect(MIN_POOL_MAX).toBe(fanOut + 1 + 1);
  });
});
