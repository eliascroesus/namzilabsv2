import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DB } from "@/db/types";

/**
 * C.1 — per-stream mutual exclusion primitives.
 *
 * Two layers, by design (see the hardening plan):
 * 1. Inngest `concurrency` keys serialize runs per connection at the queue
 *    layer (declarative, active everywhere today).
 * 2. Postgres advisory locks are the belt-and-braces around the WRITE critical
 *    section — they require real sessions, so they only take effect once the
 *    `pool` driver is live (`DB_DRIVER=pool`, after the read soak;
 *    PRE_LAUNCH_CHECKLIST.md item 4). Until then `withStreamWriteLock` runs
 *    its body without a lock, exactly as the code behaves today.
 *
 * IMPORTANT: the critical section must contain ONLY database writes (the
 * upsert + soft-delete swap), never provider I/O — holding a transaction open
 * across HTTP calls pins pool connections and bloats vacuum horizons.
 */

/**
 * Deterministic 64-bit advisory lock key for a stream (or any string scope).
 * First 8 bytes of sha256, interpreted as a signed bigint — the full advisory
 * key space, stable across processes and deploys.
 */
export function advisoryLockKey(scope: string): bigint {
  const digest = createHash("sha256").update(scope).digest();
  return digest.readBigInt64BE(0);
}

/** Whether the active driver supports sessions (transactions + advisory locks). */
export function advisoryLocksEnabled(): boolean {
  return process.env.DB_DRIVER === "pool";
}

export type StreamLockResult<T> = { acquired: boolean; result: T | null };

/**
 * Run `fn` inside a transaction holding the stream's advisory lock, when the
 * driver supports it. If another writer holds the lock, DO NOT wait or double
 * -run: return `acquired: false` so the caller skips (the other writer is
 * already doing this stream's work; the next sweep re-covers it).
 *
 * On the http driver this degrades to running `fn(db)` directly — no worse
 * than the pre-C.1 behavior, and the Inngest concurrency key remains the
 * first-line serializer either way.
 */
export async function withStreamWriteLock<T>(
  db: DB,
  scope: string,
  fn: (tx: DB) => Promise<T>,
): Promise<StreamLockResult<T>> {
  if (!advisoryLocksEnabled()) {
    return { acquired: true, result: await fn(db) };
  }
  const key = advisoryLockKey(scope);
  return db.transaction(async (tx) => {
    const res = await tx.execute(sql`select pg_try_advisory_xact_lock(${key}) as ok`);
    const rows =
      (res as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? (res as unknown as Array<Record<string, unknown>>);
    if (!rows[0]?.ok) return { acquired: false, result: null };
    return { acquired: true, result: await fn(tx as unknown as DB) };
  });
}
