import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzlePool } from "drizzle-orm/neon-serverless";
import { neon, Pool } from "@neondatabase/serverless";
import * as schema from "./schema";
import type { DB } from "./types";

/**
 * Staged driver migration (plan B.3):
 *
 * - `http`  — Neon's stateless HTTP driver. One statement per request, no
 *             interactive transactions, no advisory locks. The long-standing
 *             default and the instant rollback path.
 * - `pool`  — Neon's WebSocket Pool driver. Real sessions: `db.transaction()`,
 *             `pg_advisory_xact_lock`, multi-statement atomicity. Required by
 *             the atomic upsert+soft-delete swap and per-stream mutual
 *             exclusion (C.1).
 *
 * Rollout: flip `DB_DRIVER_READ=pool` first and SOAK the read paths in
 * production; only after the soak flip `DB_DRIVER=pool` for the writer. Either
 * flag reverts to `http` instantly. On Node >= 22 the global WebSocket is used
 * automatically; no extra dependency.
 */
type Driver = "http" | "pool";

let cachedDefault: DB | null = null;
let cachedRead: DB | null = null;

function envDriver(name: string, fallback: Driver): Driver {
  const v = process.env[name];
  return v === "pool" || v === "http" ? v : fallback;
}

/**
 * The MOST simultaneous clients one invocation of this app can need.
 *
 * Not a guess and not a comfort margin — a floor derived from the code:
 *   5  `scanInvariants` runs FIVE queries through one `Promise.all`
 *      (`src/lib/health/invariants.ts` — unswept, failing, stalled, empty,
 *      rejecting), and the helpers inside them are sequential, so five is the
 *      widest read fan-out anywhere.
 *
 *      The floor was 6 while that array held four reads; the fifth
 *      (`rejectingConnections`) was added without moving this number, which is
 *      precisely the failure mode the derivation warns about — and the reason
 *      `tests/pool-tuning.test.ts` now asserts the EXACT arithmetic instead of
 *      a `>=` that stays green while the fan-out grows past the floor.
 *
 *      `retentionBacklog` and the inspect path of `pruneOperationalTables`
 *      (`src/lib/storage-lifecycle.ts`) sit at four. None of the three sites
 *      overlap — Inngest runs steps sequentially — but a wider fan-out added
 *      to ANY of them invalidates this number, and the symptom is the
 *      deadlock below rather than a slow query.
 *   1  a transaction holds its client for the whole body, and
 *      `awaitStreamWriteLock` deliberately BLOCKS on `pg_advisory_xact_lock`
 *      for up to 15 seconds while holding it.
 *   1  headroom for a query issued while that transaction is parked.
 *
 * A pool smaller than this does not degrade — it DEADLOCKS: the transaction
 * holds the last client while waiting for a lock, and the query that would
 * release it cannot get one. So `DB_POOL_MAX` is clamped up to this floor
 * rather than honoured below it, and the lever for staying under a connection
 * ceiling is how many containers run, not how small each pool is.
 */
export const MIN_POOL_MAX = 7;

/** Fail fast when the ceiling is reached, rather than hanging the request. */
const CONNECT_TIMEOUT_MS = 5_000;
/**
 * How long an unused socket is kept.
 *
 * THIS IS WHAT ACTUALLY RECLAIMS A CONNECTION HERE, because `pool.end()` cannot
 * be called: a Vercel serverless invocation is frozen once it responds, there is
 * no reliable shutdown hook, and calling `end()` in a `finally` would close the
 * pool after every request — which is not pooling, it is the HTTP driver with
 * extra steps. So sockets are released three ways and only one of them is ours:
 * node-postgres closing a client after `idleTimeoutMillis` (this), the container
 * eventually being reclaimed and its sockets dropped, and Postgres/Neon timing
 * out an idle session from its side.
 *
 * Ten seconds: long enough that back-to-back sweeps in a warm container reuse a
 * socket, short enough that a container idling between invocations is not
 * holding any.
 */
const IDLE_TIMEOUT_MS = 10_000;

export type PoolTuning = { max: number; idleTimeoutMillis: number; connectionTimeoutMillis: number };

/**
 * Pool sizing, as a pure function so the arithmetic can be asserted.
 *
 * The default was `new Pool({ connectionString })` — node-postgres's default of
 * **10 sockets per container, never released, never closed.** That is not a
 * tuning oversight so much as an outage waiting for the first fan-out: nothing
 * capped it, nothing timed it out, and the symptom of reaching a Postgres
 * connection ceiling is refused connections across the whole app rather than a
 * slow query somewhere.
 *
 * Sizing is a ceiling divided by a container count, and neither is knowable from
 * inside the code — so `DB_POOL_MAX` exists and `PRE_LAUNCH_CHECKLIST.md` item 4
 * carries the arithmetic. Note the ceiling that matters is the DIRECT endpoint's:
 * Neon's `-pooler` host is transaction-mode PgBouncer, which does not keep a
 * session across statements and therefore breaks the advisory locks this driver
 * exists to enable.
 */
export function poolTuning(env: NodeJS.ProcessEnv = process.env): PoolTuning {
  const raw = Number(env.DB_POOL_MAX);
  const asked = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : MIN_POOL_MAX;
  return {
    max: Math.max(MIN_POOL_MAX, asked),
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  };
}

function build(driver: Driver, url: string): DB {
  if (driver === "pool") {
    const pool = new Pool({ connectionString: url, ...poolTuning() });
    return drizzlePool(pool, { schema }) as unknown as DB;
  }
  return drizzleHttp(neon(url), { schema }) as unknown as DB;
}

function requireUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

/**
 * The default (and writer) handle. Lazy so the app can build without
 * DATABASE_URL and so import-time never crashes. Driver: `DB_DRIVER`
 * (default `http` until the write soak completes).
 */
export function getDb(): DB {
  if (cachedDefault) return cachedDefault;
  cachedDefault = build(envDriver("DB_DRIVER", "http"), requireUrl());
  return cachedDefault;
}

/**
 * Read-path handle — the soak seam. Driver: `DB_DRIVER_READ`, falling back to
 * `DB_DRIVER`. Read-only surfaces (dashboard, list pages) use this so the pool
 * driver can prove itself on reads before any write moves.
 */
export function getReadDb(): DB {
  if (cachedRead) return cachedRead;
  const driver = envDriver("DB_DRIVER_READ", envDriver("DB_DRIVER", "http"));
  cachedRead = driver === envDriver("DB_DRIVER", "http") ? getDb() : build(driver, requireUrl());
  return cachedRead;
}
