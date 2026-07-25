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

function build(driver: Driver, url: string): DB {
  if (driver === "pool") {
    const pool = new Pool({ connectionString: url });
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
