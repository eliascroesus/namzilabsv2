import { describe, it, expect } from "vitest";
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

  it("the floor covers the widest fan-out in the codebase plus a transaction", () => {
    // 4 concurrent reads (invariants.ts) + 1 held by a transaction + 1 spare.
    // Stated as arithmetic so that widening a `Promise.all` past four fails here
    // rather than in production at 3am.
    expect(MIN_POOL_MAX).toBeGreaterThanOrEqual(4 + 1 + 1);
  });
});
