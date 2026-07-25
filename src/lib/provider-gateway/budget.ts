import { and, eq, sql } from "drizzle-orm";
import { connections, usageLedger } from "@/db/schema";
import type { DB } from "@/db/types";
import { catalogEntry } from "@/connectors/catalog";

/**
 * Workstream F (proactive) — provider-call governance.
 *
 * Three cooperating rules, all enforced through the `usage_ledger` so
 * concurrent workers share one truth:
 *
 * - **F.1 token budget.** Never spend 100% of a provider's published limit: we
 *   claim a configurable SHARE of it (default 70%) per minute window, per
 *   (connection, operation). Claims are atomic — the INSERT … ON CONFLICT
 *   returns the post-increment count, so two workers racing the last token
 *   cannot both win.
 * - **F.3 defer, never drop.** A denied claim doesn't lose work: the caller
 *   reschedules and the connection records "paused until ~T, because X" for
 *   the UI. Nothing is silently skipped.
 * - **F.6 circuit breaker, never terminal.** Consecutive failures pause a
 *   connection on a probe ladder (1h → 4h → daily); every pause carries an
 *   expiry, so a connection ALWAYS retries itself and heals when the provider
 *   recovers. Success resets the ladder.
 */

/** Fraction of a provider's published limit we're willing to consume. */
const BUDGET_SHARE = 0.7;
/** Fallback per-minute budget when a connector declares none. */
const DEFAULT_RPM = 60;
/** F.6 probe ladder: consecutive-failure count → how long to pause. */
const PROBE_LADDER_MS = [60 * 60_000, 4 * 60 * 60_000, 24 * 60 * 60_000];

export type ClaimResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterMs: number; reason: string };

/** The per-minute call budget for one operation (published limit × share). */
export function budgetFor(source: string, operation = "*"): number {
  const declared = catalogEntry(source)?.rateLimits?.[operation]?.requestsPerMinute;
  const rpm = declared ?? DEFAULT_RPM;
  return Math.max(1, Math.floor(rpm * BUDGET_SHARE));
}

function windowStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000);
}

/**
 * Atomically claim `cost` calls against the (connection, operation) budget for
 * the current minute. Returns whether the caller may proceed; on denial, how
 * long until the window resets.
 */
export async function claimCalls(
  db: DB,
  conn: { id: string; orgId: string; source: string },
  operation = "*",
  cost = 1,
  now = new Date(),
): Promise<ClaimResult> {
  const limit = budgetFor(conn.source, operation);
  const start = windowStart(now);

  const [row] = await db
    .insert(usageLedger)
    .values({ orgId: conn.orgId, connectionId: conn.id, provider: conn.source, operation, windowStart: start, calls: cost })
    .onConflictDoUpdate({
      target: [usageLedger.connectionId, usageLedger.operation, usageLedger.windowStart],
      set: { calls: sql`${usageLedger.calls} + ${cost}`, updatedAt: new Date() },
    })
    .returning({ calls: usageLedger.calls });

  const used = row?.calls ?? cost;
  if (used <= limit) return { allowed: true, remaining: Math.max(0, limit - used) };

  // Over budget: give the tokens back so the counter reflects reality, and
  // record the throttle for the ledger's audit trail.
  await db
    .update(usageLedger)
    .set({ calls: sql`greatest(0, ${usageLedger.calls} - ${cost})`, throttled: sql`${usageLedger.throttled} + 1`, updatedAt: new Date() })
    .where(and(eq(usageLedger.connectionId, conn.id), eq(usageLedger.operation, operation), eq(usageLedger.windowStart, start)));

  const retryAfterMs = start.getTime() + 60_000 - now.getTime();
  return {
    allowed: false,
    retryAfterMs: Math.max(1_000, retryAfterMs),
    reason: `Respecting ${catalogEntry(conn.source)?.name ?? conn.source}'s rate limit`,
  };
}

/** Record a provider error against the window (breaker evidence). */
export async function recordProviderError(
  db: DB,
  conn: { id: string; orgId: string; source: string },
  operation = "*",
  now = new Date(),
): Promise<void> {
  const start = windowStart(now);
  await db
    .insert(usageLedger)
    .values({ orgId: conn.orgId, connectionId: conn.id, provider: conn.source, operation, windowStart: start, errors: 1 })
    .onConflictDoUpdate({
      target: [usageLedger.connectionId, usageLedger.operation, usageLedger.windowStart],
      set: { errors: sql`${usageLedger.errors} + 1`, updatedAt: new Date() },
    });
}

/**
 * F.3 — defer work without losing it. Records WHEN the connection resumes and
 * WHY, in language the connection page can show verbatim.
 */
export async function pauseConnection(
  db: DB,
  connectionId: string,
  forMs: number,
  reason: string,
  now = new Date(),
): Promise<Date> {
  const until = new Date(now.getTime() + forMs);
  await db
    .update(connections)
    .set({ pausedUntil: until, pausedReason: reason, updatedAt: now })
    .where(eq(connections.id, connectionId));
  return until;
}

/**
 * F.6 — trip the breaker one notch. Never sets a terminal state: every trip
 * has an expiry, so the connection probes itself back to life (1h → 4h →
 * daily) and heals automatically when the provider recovers.
 */
export async function tripBreaker(
  db: DB,
  connectionId: string,
  error: string,
  now = new Date(),
): Promise<{ pausedUntil: Date; attempt: number }> {
  const [conn] = await db
    .select({ failures: connections.consecutiveFailures })
    .from(connections)
    .where(eq(connections.id, connectionId))
    .limit(1);
  const attempt = (conn?.failures ?? 0) + 1;
  const waitMs = PROBE_LADDER_MS[Math.min(attempt, PROBE_LADDER_MS.length) - 1];
  const until = new Date(now.getTime() + waitMs);
  await db
    .update(connections)
    .set({
      consecutiveFailures: attempt,
      pausedUntil: until,
      pausedReason: `Paused after ${attempt} failed attempt${attempt === 1 ? "" : "s"}: ${error.slice(0, 200)}`,
      lastError: error,
      updatedAt: now,
    })
    .where(eq(connections.id, connectionId));
  return { pausedUntil: until, attempt };
}

/**
 * Any successful poll clears the breaker AND the pause — the connection is
 * healthy for SYNC purposes.
 *
 * `clearError` exists because "the poll worked" doesn't mean "everything is
 * fine": a webhook-subscription check (D.6) can be failing on the same
 * connection, and a successful poll must not erase that standing warning —
 * the user would lose the only signal that their instant path is broken.
 */
export async function recordSuccess(
  db: DB,
  connectionId: string,
  opts: { clearError?: boolean; now?: Date } = {},
): Promise<void> {
  const { clearError = true, now = new Date() } = opts;
  await db
    .update(connections)
    .set({
      consecutiveFailures: 0,
      pausedUntil: null,
      pausedReason: null,
      status: "active",
      updatedAt: now,
      ...(clearError ? { lastError: null } : {}),
    })
    .where(eq(connections.id, connectionId));
}

/**
 * Is this connection currently deferred? Callers skip it until the expiry —
 * and BECAUSE every pause has an expiry, "skip" is always temporary.
 */
export function isPaused(conn: { pausedUntil: Date | null }, now = new Date()): boolean {
  return conn.pausedUntil != null && conn.pausedUntil.getTime() > now.getTime();
}
