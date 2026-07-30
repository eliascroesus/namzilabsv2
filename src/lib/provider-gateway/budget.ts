import { and, eq, sql } from "drizzle-orm";
import { connections, usageLedger } from "@/db/schema";
import type { DB } from "@/db/types";
import { catalogEntry } from "@/connectors/catalog";
import type { ObservedRateLimit } from "@/lib/http-client";

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
/**
 * F.8 — the slice of each budget that ONLY user-interactive work may claim.
 * Background sweeps stop at `budget - reserve`, so a person clicking Test
 * still has headroom even when the fleet has spent its share for the minute.
 */
const INTERACTIVE_RESERVE_SHARE = 0.25;

/**
 * Who is asking, in strict priority order.
 *
 * `interactive` — a person is waiting. May use the whole budget, including the
 *   reserve that exists for exactly this.
 * `background`  — the ten-minute sweep. Stops at `budget - reserve`.
 * `backfill`    — historical import. Gets a slice of what is left AFTER the
 *   sweep's ceiling, so it is strictly the lowest priority and structurally
 *   cannot reach the interactive reserve: its limit is derived from the
 *   background ceiling, which already excludes it. A months-long import must
 *   never be the reason someone's Test is slow.
 */
export type CallLane = "background" | "interactive" | "backfill";

export type ClaimResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterMs: number; reason: string };

/**
 * F.1 (fleet) — the identity a provider-wide bucket is booked against.
 *
 * `usage_ledger.connection_id` is a NOT NULL uuid and `org_id` a NOT NULL text,
 * so a bucket belonging to no single connection needs a stand-in for both. The
 * nil UUID cannot collide with a generated one, and the org sentinel is
 * obviously not an org id at a glance rather than only under inspection.
 *
 * ANY future aggregate over `usage_ledger` — per-org usage, billing, an admin
 * page — MUST exclude these rows. There is no such reader today (the only
 * statements touching the table are this file's four bucket-scoped upserts and
 * reset-data's two whole-table ones), which is precisely why the warning is
 * written here, where the next person to add one will be looking. A fleet row
 * counts one provider's whole-fleet spend; summed into a real org's usage it
 * would attribute every other customer's calls to them.
 *
 * The `provider` column is still filled in, so the rows read as
 * "gsheets, fleet" rather than as an anonymous counter.
 */
export const FLEET_ORG_ID = "__fleet__";
export const FLEET_CONNECTION_ID = "00000000-0000-0000-0000-000000000000";

/** The per-minute call budget for one operation (published limit × share). */
export function budgetFor(source: string, operation = "*"): number {
  const declared = catalogEntry(source)?.rateLimits?.[operation]?.requestsPerMinute;
  const rpm = declared ?? DEFAULT_RPM;
  return Math.max(1, Math.floor(rpm * BUDGET_SHARE));
}

/**
 * The fleet-wide budget for one operation, or null when the source declares
 * none — which is the correct answer for a per-customer credential, where one
 * customer's spend is not another's problem.
 *
 * Note the absence of a DEFAULT_RPM fallback, deliberately: an undeclared fleet
 * limit means "no shared ceiling", not "a guessed one". Inventing a fleet
 * ceiling for a source that does not need one would throttle unrelated
 * customers against each other for no provider-side reason.
 */
export function fleetBudgetFor(source: string, operation = "*"): number | null {
  const declared = catalogEntry(source)?.fleetLimits?.[operation]?.requestsPerMinute;
  if (declared == null) return null;
  return Math.max(1, Math.floor(declared * BUDGET_SHARE));
}

/**
 * The ceiling a given lane may spend (F.8). Background work leaves the reserve
 * untouched; interactive work may use the whole budget.
 */
export function laneLimit(source: string, operation = "*", lane: CallLane = "background"): number {
  return laneCeiling(budgetFor(source, operation), lane);
}

/**
 * The same lane ceiling applied to the FLEET bucket, or null where the source
 * declares none.
 *
 * The counterpart to `laneLimit`, and worth naming rather than leaving inline:
 * the two ceilings are different numbers on Google (60/min per user against
 * 300/min per project), so "what may this lane spend" has two answers and code
 * that reaches for one must be able to say which.
 */
export function fleetLaneLimit(source: string, operation = "*", lane: CallLane = "background"): number | null {
  const total = fleetBudgetFor(source, operation);
  return total == null ? null : laneCeiling(total, lane);
}

/**
 * The share of the SWEEP's ceiling a historical import may spend (6.4's "≤50%").
 *
 * Applied to the background ceiling rather than to the whole budget, which is
 * what makes the ordering structural instead of arithmetic: backfill can only
 * ever spend a fraction of what live sync is already limited to, so no choice
 * of share can let it reach the interactive reserve.
 */
const BACKFILL_SHARE = 0.5;

/** The same reserve arithmetic, over whichever budget is being applied. */
function laneCeiling(total: number, lane: CallLane): number {
  if (lane === "interactive") return total;
  const reserve = Math.max(1, Math.ceil(total * INTERACTIVE_RESERVE_SHARE));
  const background = Math.max(1, total - reserve);
  if (lane === "background") return background;
  // Deliberately NOT floored at 1. When the budget is so tight that live sync
  // has room for a single call, the honest answer is that a backfill does not
  // run this minute — it defers and retries, which is what the lane is built to
  // do. Flooring it at 1 would let an import take the only call there was.
  return Math.floor(background * BACKFILL_SHARE);
}

function windowStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000);
}

/** Increment one bucket and report the running total. */
async function chargeBucket(
  db: DB,
  bucket: { orgId: string; connectionId: string; provider: string },
  operation: string,
  cost: number,
  start: Date,
): Promise<number> {
  const [row] = await db
    .insert(usageLedger)
    .values({ ...bucket, operation, windowStart: start, calls: cost })
    .onConflictDoUpdate({
      target: [usageLedger.connectionId, usageLedger.operation, usageLedger.windowStart],
      set: { calls: sql`${usageLedger.calls} + ${cost}`, updatedAt: new Date() },
    })
    .returning({ calls: usageLedger.calls });
  return row?.calls ?? cost;
}

/**
 * Hand tokens back.
 *
 * `throttled` is a parameter rather than always incremented, and that is the
 * whole reason this is one function instead of two. A bucket that DENIED was
 * throttled and should say so. A bucket that allowed and is being unwound
 * because a LATER bucket denied was not throttled — recording one there would
 * blame a connection for a shortage that was the fleet's.
 */
async function releaseBucket(
  db: DB,
  connectionId: string,
  operation: string,
  cost: number,
  start: Date,
  throttled: boolean,
): Promise<void> {
  await db
    .update(usageLedger)
    .set({
      calls: sql`greatest(0, ${usageLedger.calls} - ${cost})`,
      ...(throttled ? { throttled: sql`${usageLedger.throttled} + 1` } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(usageLedger.connectionId, connectionId), eq(usageLedger.operation, operation), eq(usageLedger.windowStart, start)));
}

/**
 * Atomically claim `cost` calls for the current minute. Returns whether the
 * caller may proceed; on denial, how long until the window resets.
 *
 * TWO buckets, and a request needs room in both:
 *
 * 1. `(connection, operation)` — the customer's own share, always checked.
 * 2. `(fleet, operation)` — checked only where the source declares a
 *    `fleetLimits`, i.e. where every customer's requests reach the provider
 *    under one credential of ours. Google is the case that exists: Sheets and
 *    Calendar share one `GOOGLE_CLIENT_ID`, so the quota is charged to our
 *    Cloud project and ten individually-polite connections can still take the
 *    project down together.
 *
 * Extending this function rather than adding a second one is deliberate: every
 * existing claim site gets the fleet ceiling with no site left to be missed,
 * and there is no way to spend a provider call through a path that checked only
 * one of the two.
 */
export async function claimCalls(
  db: DB,
  conn: { id: string; orgId: string; source: string },
  operation = "*",
  cost = 1,
  now = new Date(),
  lane: CallLane = "background",
): Promise<ClaimResult> {
  const start = windowStart(now);
  const retryAfterMs = Math.max(1_000, start.getTime() + 60_000 - now.getTime());
  const providerName = catalogEntry(conn.source)?.name ?? conn.source;

  const limit = laneLimit(conn.source, operation, lane);
  const used = await chargeBucket(db, { orgId: conn.orgId, connectionId: conn.id, provider: conn.source }, operation, cost, start);
  if (used > limit) {
    // Over budget: give the tokens back so the counter reflects reality, and
    // record the throttle for the ledger's audit trail.
    await releaseBucket(db, conn.id, operation, cost, start, true);
    return { allowed: false, retryAfterMs, reason: `Respecting ${providerName}'s rate limit` };
  }

  const fleetLimit = fleetLaneLimit(conn.source, operation, lane);
  if (fleetLimit == null) return { allowed: true, remaining: Math.max(0, limit - used) };

  const fleetUsed = await chargeBucket(
    db,
    { orgId: FLEET_ORG_ID, connectionId: FLEET_CONNECTION_ID, provider: conn.source },
    operation,
    cost,
    start,
  );
  if (fleetUsed > fleetLimit) {
    await releaseBucket(db, FLEET_CONNECTION_ID, operation, cost, start, true);
    // Unwind the connection's own charge too. Without this a customer burns
    // their personal budget on calls they were never allowed to make, and can
    // end up denied on their OWN limit for the rest of the minute after the
    // shared one frees up — throttled twice for one shortage, the second time
    // invisibly.
    await releaseBucket(db, conn.id, operation, cost, start, false);
    return {
      allowed: false,
      retryAfterMs,
      // Says whose limit it is. The per-connection message would tell someone
      // who has done nothing that THEIR account is at its rate limit, and send
      // them looking for a problem that is not on their side.
      reason: `Waiting for the shared ${providerName} quota used by every account here`,
    };
  }

  return { allowed: true, remaining: Math.max(0, Math.min(limit - used, fleetLimit - fleetUsed)) };
}

/**
 * Add calls the ledger did not authorise but which HAPPENED anyway — a
 * connector that pages internally, so the runner could not claim per request.
 *
 * Deliberately not `claimCalls`: there is nothing to allow or deny after the
 * fact, and `claimCalls` refunds on denial, which would erase exactly the spend
 * we are trying to record. The point is that the NEXT claim sees the truth.
 */
export async function recordExtraCalls(
  db: DB,
  conn: { id: string; orgId: string; source: string },
  operation = "*",
  extra = 0,
  now = new Date(),
): Promise<void> {
  if (extra <= 0) return;
  const start = windowStart(now);
  await chargeBucket(db, { orgId: conn.orgId, connectionId: conn.id, provider: conn.source }, operation, extra, start);
  // The fleet bucket has to see these too, and this is the load-bearing half
  // for Google: its connectors make most of their requests INSIDE one poll, so
  // a fleet ceiling fed only by claims would count one request in three (Sheets)
  // or one in eight (Calendar) and permit that multiple of what it declares.
  if (fleetBudgetFor(conn.source, operation) != null) {
    await chargeBucket(db, { orgId: FLEET_ORG_ID, connectionId: FLEET_CONNECTION_ID, provider: conn.source }, operation, extra, start);
  }
}

/**
 * Settle one poll's real spend across the operations it actually used.
 *
 * `claimed` calls were already charged to `operation` before the poll ran. The
 * poll may then have made more requests than that, and some of them may have
 * gone somewhere else entirely — `extraCalls` names those. They are SUBTRACTED
 * from the primary operation rather than added on, so the total charged always
 * equals `providerCalls`: this redistributes a poll's spend, it does not inflate
 * it.
 *
 * The reason it exists is Sheets. One poll asks Drive whether the file changed
 * and then reads the tab through the Sheets API — 12,000/min per project against
 * 300/min. Charging both to one bucket means the tighter number governs the
 * cheap request too, so a probe designed to SAVE quota would be rationed as if
 * it spent the expensive kind.
 *
 * `now` MUST be the instant the claim was charged at, not the instant the poll
 * finished. Buckets are keyed by minute window, and a poll straddles one often:
 * claim at :59.8, settle at :00.2. A refund computed from the settle time then
 * releases a call from the NEXT window — and on the fleet bucket that window is
 * shared, so it would erase a different customer's real spend and hand the fleet
 * a call of headroom nobody gave back. Every caller passes its claim instant.
 */
export async function settlePollCalls(
  db: DB,
  conn: { id: string; orgId: string; source: string },
  operation: string,
  result: { providerCalls?: number; extraCalls?: Record<string, number> },
  claimed = 1,
  now = new Date(),
): Promise<void> {
  const extra = result.extraCalls ?? {};
  let attributed = 0;
  for (const [op, n] of Object.entries(extra)) {
    if (!(n > 0) || op === operation) continue;
    attributed += n;
    await recordExtraCalls(db, conn, op, n, now);
  }
  // Connectors that report nothing are counted as one request, which is the
  // pre-existing behaviour and correct for a connector that makes one.
  const delta = (result.providerCalls ?? 1) - claimed - attributed;
  if (delta > 0) {
    await recordExtraCalls(db, conn, operation, delta, now);
    return;
  }
  if (delta === 0) return;

  /**
   * The claim RESERVED calls this poll did not make, so hand them back.
   *
   * An unchanged sheet is the case: one Sheets read is claimed up front, then
   * only Drive is asked whether anything changed. Leaving the reservation
   * charged would bill the 300/min bucket for the read the probe exists to
   * AVOID — a skip would cost the same as a read, and the whole change-detection
   * saving would be invisible to the thing that rations the quota.
   *
   * `throttled: false`: nothing was denied, a reservation simply went unused,
   * and marking a throttle here would put a shortage in the audit trail that
   * never happened.
   */
  const start = windowStart(now);
  await releaseBucket(db, conn.id, operation, -delta, start, false);
  if (fleetBudgetFor(conn.source, operation) != null) {
    await releaseBucket(db, FLEET_CONNECTION_ID, operation, -delta, start, false);
  }
}

/**
 * Keep what the provider said its ceiling WAS, so a real number can eventually
 * replace a guessed one.
 *
 * `parseRateLimit` has always read `limit`, `remaining` and `reset`; the runner
 * acted on `remaining` and dropped `limit`. That discarded value is the only
 * evidence this system has ever had about a real provider budget. Four of the
 * seven sources are governed by a `DEFAULT_RPM` of 60 that no provider ever
 * stated — and Close, the highest-volume one, reports its true limit on every
 * response.
 *
 * Recording rather than acting: nothing changes behaviour on the strength of
 * one header. A day of these accumulating is what makes the catalog declaration
 * an observation instead of another guess.
 *
 * Writes only when the provider actually sent a limit, so a window with no
 * observation stays NULL rather than becoming a zero somebody later averages.
 */
export async function recordObservedLimit(
  db: DB,
  conn: { id: string; orgId: string; source: string },
  operation = "*",
  observed: ObservedRateLimit | null | undefined,
  now = new Date(),
): Promise<void> {
  if (observed?.limit == null || !Number.isFinite(observed.limit)) return;
  const start = windowStart(now);
  await db
    .insert(usageLedger)
    .values({
      orgId: conn.orgId,
      connectionId: conn.id,
      provider: conn.source,
      operation,
      windowStart: start,
      observedLimit: observed.limit,
    })
    .onConflictDoUpdate({
      target: [usageLedger.connectionId, usageLedger.operation, usageLedger.windowStart],
      set: { observedLimit: observed.limit, updatedAt: new Date() },
    });
}

/**
 * F.1 (observed) — the provider's own account of its remaining quota beats our
 * declared guess. Exhausted means exhausted; defer until it says otherwise.
 *
 * Returns the pause expiry when it deferred, so the caller can report it.
 */
export async function applyObservedRateLimit(
  db: DB,
  conn: { id: string; orgId: string; source: string },
  observed: { remaining: number; resetSeconds: number | null } | null | undefined,
  now = new Date(),
): Promise<Date | null> {
  if (!observed || observed.remaining > 0) return null;
  const waitMs = Math.max(1_000, Math.min((observed.resetSeconds ?? 60) * 1000, 10 * 60_000));
  return pauseConnection(db, conn.id, waitMs, `${catalogEntry(conn.source)?.name ?? conn.source} reports its rate limit is spent — resumes automatically`, now);
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
