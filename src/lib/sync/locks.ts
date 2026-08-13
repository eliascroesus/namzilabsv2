import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { syncState } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * C.1 — mutual exclusion primitives, at two scopes.
 *
 * STREAM scope (advisory locks, below). Three layers, by design:
 * 1. Inngest `concurrency` keys serialize runs per connection at the queue
 *    layer (declarative, active everywhere today).
 * 2. Postgres advisory locks are the belt-and-braces around the WRITE critical
 *    section — they require real sessions, so they only take effect once the
 *    `pool` driver is live (`DB_DRIVER=pool`, after the read soak;
 *    PRE_LAUNCH_CHECKLIST.md item 4). Until then `withStreamWriteLock` runs
 *    its body without a lock, exactly as the code behaves today.
 *
 * IMPORTANT: the advisory critical section must contain ONLY database writes
 * (the upsert + soft-delete swap), never provider I/O — holding a transaction
 * open across HTTP calls pins pool connections and bloats vacuum horizons.
 *
 * CONNECTION scope (the lease, further down). Sources with no streams
 * (Close, Instantly) get no cover from the per-stream lock, and the queue keys
 * do not close it either: Inngest scopes `singleton`/`concurrency` PER FUNCTION,
 * so `sync-connection` and `reconcile-one-connection` never exclude each other,
 * and the inline Test path does not enter Inngest at all. Their critical section
 * also has to span the provider poll, which the paragraph above forbids doing
 * with a transaction — hence a durable lease rather than an advisory lock. See
 * `tryConnectionSyncLock` for the full reasoning.
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

/**
 * Q6 — the user-initiated Test's side of contention: AWAIT the in-flight
 * writer, never skip and never error. Blocks (bounded by `timeoutMs`) until no
 * writer holds the scope's swap lock, then releases immediately — the caller's
 * next step is to RE-CHECK freshness and read, not to hold the lock.
 *
 * Returns "free" when the lock was acquired (any prior writer has finished),
 * "timeout" when the holder outlived the bound (the caller proceeds with its
 * own sync — safe under the guarded writer, and strictly better than erroring
 * at the user), and "unsupported" on the http driver (no session semantics —
 * the Inngest per-connection concurrency key is the serializer there).
 */
export async function awaitStreamWriteLock(
  db: DB,
  scope: string,
  timeoutMs = 15_000,
): Promise<"free" | "timeout" | "unsupported"> {
  if (!advisoryLocksEnabled()) return "unsupported";
  const key = advisoryLockKey(scope);
  try {
    await db.transaction(async (tx) => {
      // lock_timeout is LOCAL to the transaction; the enum-free integer is
      // validated by Number() at the boundary.
      await tx.execute(sql.raw(`set local lock_timeout = ${Math.max(1, Math.floor(Number(timeoutMs)))}`));
      await tx.execute(sql`select pg_advisory_xact_lock(${key})`);
      // Acquired → the previous holder committed; releasing via commit.
    });
    return "free";
  } catch {
    return "timeout";
  }
}

// ---------------------------------------------------------------------------
// C.1, connection scope — mutual exclusion for sources that have no streams
// ---------------------------------------------------------------------------

/**
 * The lock's identity, in the same `scope:id` shape the stream locks use, and
 * the prefix every issued token carries.
 *
 * Row-level exclusion is already keyed by `sync_state.connection_id`, so this
 * string is not what makes the lease work — it is what makes a held lease
 * legible. Someone looking at a stuck `sync_state` row reads
 * `connection:<id>:<uuid>` and knows the scope and the holder, rather than a
 * bare UUID that could have come from anywhere. It is also the exact key a
 * connection-scoped advisory lock would use if the pool driver ever adds one.
 */
export function connectionLockScope(connectionId: string): string {
  return `connection:${connectionId}`;
}

/**
 * How long a holder may keep the connection before the lease is considered
 * abandoned. Must exceed the longest a sync can legitimately take, and this
 * runtime bounds that hard: every sync-bearing route is `maxDuration = 60`, so
 * a holder still alive past 90s does not exist — it was killed mid-poll, and
 * killed holders must not lock a connection forever.
 */
export const CONNECTION_LOCK_TTL_MS = 90_000;

export type ConnectionLock = { token: string; until: Date };

/**
 * WHY THIS IS A LEASE AND NOT AN ADVISORY LOCK.
 *
 * The stream locks above guard a critical section containing only DB writes, so
 * a transaction-scoped advisory lock fits: `pg_try_advisory_xact_lock` inside
 * `db.transaction()`. The connection-level section cannot be written that way,
 * for three independent reasons:
 *
 * 1. It must span the PROVIDER POLL. Excluding only the write leaves both
 *    writers free to read the same cursor and poll — which is exactly the
 *    duplicate call and cursor interleave this guards against. But holding a
 *    transaction open across an HTTP call is precisely what the header of this
 *    file forbids: it pins a pool connection and holds a snapshot against
 *    vacuum for the length of a network round trip.
 * 2. Advisory locks need sessions, so `advisoryLocksEnabled()` is false until
 *    `DB_DRIVER=pool`. The race is live on the http driver TODAY; a guard that
 *    only engages after a future migration does not fix it.
 * 3. A serverless container killed mid-poll is a thing that happens here — it
 *    is the failure this codebase just spent a release fixing. A session lock
 *    dies with its session, which sounds right until you notice the http driver
 *    has no session to die. A lease with a deadline recovers under either.
 *
 * So: a compare-and-set on `sync_state`, which is already the per-connection
 * sync bookkeeping row. Acquisition is one statement and therefore atomic on
 * every driver — the `WHERE` runs inside the `ON CONFLICT DO UPDATE`, so two
 * simultaneous callers cannot both see the lease as free.
 */
export async function tryConnectionSyncLock(
  db: DB,
  connectionId: string,
  now: Date = new Date(),
  ttlMs: number = CONNECTION_LOCK_TTL_MS,
): Promise<ConnectionLock | null> {
  const token = `${connectionLockScope(connectionId)}:${randomUUID()}`;
  const until = new Date(now.getTime() + ttlMs);
  const [row] = await db
    .insert(syncState)
    .values({ connectionId, syncLockUntil: until, syncLockToken: token, updatedAt: now })
    .onConflictDoUpdate({
      target: syncState.connectionId,
      set: { syncLockUntil: until, syncLockToken: token, updatedAt: now },
      // Taken only when nobody holds it, or the holder's deadline has passed.
      setWhere: or(isNull(syncState.syncLockUntil), lt(syncState.syncLockUntil, now)),
    })
    .returning({ connectionId: syncState.connectionId });
  return row ? { token, until } : null;
}

/**
 * Release, fenced by the token. A waiter that timed out and proceeded anyway
 * (see `awaitConnectionSyncLock`) would otherwise clear the lease of the writer
 * it gave up on, letting a third writer in while that one is still polling.
 */
export async function releaseConnectionSyncLock(db: DB, connectionId: string, token: string): Promise<void> {
  await db
    .update(syncState)
    .set({ syncLockUntil: null, syncLockToken: null })
    .where(and(eq(syncState.connectionId, connectionId), eq(syncState.syncLockToken, token)));
}

/**
 * Run `fn` holding the connection's lease. Mirrors `withStreamWriteLock`'s
 * contract: `acquired: false` means another writer is already doing this
 * connection's work and the caller should SKIP, not wait and not error.
 */
export async function withConnectionSyncLock<T>(
  db: DB,
  connectionId: string,
  fn: () => Promise<T>,
  now: Date = new Date(),
): Promise<StreamLockResult<T>> {
  const lock = await tryConnectionSyncLock(db, connectionId, now);
  if (!lock) return { acquired: false, result: null };
  try {
    return { acquired: true, result: await fn() };
  } finally {
    // Always released, including when `fn` throws — a failed sync must not
    // lock the connection out for the rest of the TTL.
    await releaseConnectionSyncLock(db, connectionId, lock.token);
  }
}

/**
 * Q6, connection scope: the user-initiated Test's side of contention. WAIT for
 * the in-flight sync rather than skipping — the person is looking at a spinner,
 * and the sync they are waiting on is about to produce exactly the data they
 * asked for.
 *
 * Returns "free" once no lease is held (the caller then re-checks freshness and
 * may adopt the other writer's result instead of polling again), or "timeout"
 * when the holder outlived the bound. On timeout the caller proceeds with its
 * own sync, which is safe: acquisition is still a compare-and-set, so it will
 * simply skip if the holder is genuinely still there.
 */
export async function awaitConnectionSyncLock(
  db: DB,
  connectionId: string,
  timeoutMs = 15_000,
  pollMs = 250,
): Promise<"free" | "timeout"> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [row] = await db
      .select({ until: syncState.syncLockUntil })
      .from(syncState)
      .where(eq(syncState.connectionId, connectionId))
      .limit(1);
    const held = row?.until != null && row.until.getTime() > Date.now();
    if (!held) return "free";
    if (Date.now() >= deadline) return "timeout";
    await new Promise((r) => setTimeout(r, Math.min(pollMs, Math.max(1, deadline - Date.now()))));
  }
}
