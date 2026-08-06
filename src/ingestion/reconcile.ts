import { and, eq, isNull, lte, or } from "drizzle-orm";
import { connections, syncState } from "@/db/schema";
import type { DB } from "@/db/types";
import { getConnector } from "@/connectors/registry";
import { isStreamScoped } from "@/connectors/catalog";
import { getConnectionCredentials } from "@/lib/credentials";
import { applyObservedRateLimit, claimCalls, isPaused, pauseConnection, recordObservedLimit, recordProviderError, recordSuccess, settlePollCalls, tripBreaker } from "@/lib/provider-gateway/budget";
import { pollOperation } from "@/lib/provider-gateway/operations";
import { HttpError } from "@/lib/http-client";
import { withConnectionSyncLock } from "@/lib/sync/locks";
import { upsertEvents } from "./pipeline";
import { activeStreams, syncStream } from "@/lib/sync/streams";
import { applyCadence, decideCadence } from "@/lib/sync/cadence";
import { connectionRefusedRecently } from "@/lib/webhooks/rejections";

/**
 * HOW LONG A REFUSED DELIVERY IS REMEMBERED, when deciding whether a provider's
 * paused subscription may be switched back on.
 *
 * Twenty-four hours, and the number is a duty cycle rather than a timeout.
 *
 * No finite window ends the cycle it guards against. A provider that pauses
 * after N days of total failure stops delivering at the pause, so the refusals
 * stop too, so any window eventually goes quiet and the next sweep re-activates
 * — and if nothing was actually repaired the failure period simply begins again.
 * What the window sets is the RATIO: with a three-day pause threshold, one hour
 * of memory means a broken endpoint is under flood ~97% of the time, and a day
 * of memory means ~75%. It is a dial on wasted load, not a switch.
 *
 * So the trade is: every hour of memory is an hour a genuinely REPAIRED
 * connection stays dark, because a deploy that fixes verification is invisible
 * from `delivery_log` — evidence from five minutes before the fix reads exactly
 * like evidence from now. And the cost of staying dark is LATENCY, not data:
 * the poll lane imports the same records on the next sweep, which is precisely
 * why a webhook path failing 100% of the time went unnoticed for months. Being
 * slow is cheap; running a three-day flood of rejected requests, each one a
 * database read and a decrypt, is not. So the window leans long.
 *
 * A day is also one nightly invariant scan. A connection held back from
 * re-activation is reported to a human at least once before the guard next lets
 * it try on its own, which is the property that makes an automatic probe
 * defensible at all.
 *
 * The floor is set by the recorder, not by taste: rejections are sampled at one
 * row per connection per minute, so any window shorter than a few sweep
 * intervals could miss a live flood between two sweeps. A day is 144 sweeps.
 *
 * THERE MAY BE AN EXIT FROM THE CYCLE ENTIRELY, and it is measured rather than
 * assumed. If Close's LIST response carries `signature_key`, comparing it with
 * the stored secret answers "will verification succeed?" directly — positive
 * evidence, before a delivery is attempted — and a mismatch is repairable from
 * here, which holds both the database and the encryption key. That would make
 * this window a cost dial rather than the correctness mechanism. The update
 * endpoint's documented response includes the field; the list endpoint is a
 * different endpoint, and providers routinely omit secrets from collection
 * responses. `scripts/verify-close-subscription-fields.ts` settles it.
 */
const REJECTION_MEMORY_MS = 24 * 3_600_000;

/**
 * The health check could not be afforded this sweep.
 *
 * A distinct type rather than a flag because it travels through the same
 * `catch` as a real provider failure, and the two must not be recorded the same
 * way: one means the subscription is in trouble, the other means we chose not to
 * ask. Conflating them would write a scary `lastError` for a request that was
 * never sent.
 */
class SkipHealthCheck extends Error {}

export type ReconcileResult = {
  inserted: number;
  /** Existing rows whose content actually changed (mirror refresh, upstream edit). */
  updated: number;
  /** Rows soft-deleted because a mirror re-read no longer produced them. */
  softDeleted: number;
  deduped: number;
  polled: boolean;
  /**
   * Provider-side webhook subscription state, for sources whose connector can
   * verify it: "ok" (present), "reregistered" (was missing, re-created this
   * sweep), "failed" (couldn't verify — detail on the connection's lastError).
   * Undefined when the source has no verifiable subscription.
   */
  webhook?: "ok" | "reregistered" | "failed";
  /**
   * Stream hashes whose data actually changed this sweep (G.1) — staleness can
   * be scoped to flows reading THOSE streams. Empty for connection-scoped
   * sources (no streams; source/connection-level staleness applies).
   */
  changedStreamHashes: string[];
  /**
   * F.3 — this sweep did no provider work because the connection is deferred
   * (rate budget spent, or the breaker is open). The work is NOT lost: the
   * connection resumes automatically at `pausedUntil`.
   */
  deferredUntil?: Date;
  /**
   * C.1 — another writer held this connection's sync lease (a user's Test, a
   * "Sync now", the previous tick still finishing), so this sweep stood down.
   * The sweep SKIPS rather than waits: nothing is lost, because whoever holds
   * the lease is doing exactly this work, and the next tick re-covers it.
   */
  skipped?: boolean;
  /**
   * At least one stream stopped on its page budget with more to fetch. Carried
   * so the cadence can tell "nothing changed" from "not finished" — see
   * CadenceInput.incomplete.
   */
  incomplete?: boolean;
  /**
   * At least one stream (or the connection cursor) ended this sweep holding a
   * provider-issued continuation that expires. The cadence must not widen the
   * gap to the next sweep past its life — see CadenceInput.heldContinuation.
   */
  heldContinuation?: boolean;
  /** Tenant + source identity, so callers can mark dependent flows stale. */
  orgId: string;
  source: string;
};

/** Did this sweep change what dashboards would show? (drives staleness) */
export function reconcileChanged(r: Pick<ReconcileResult, "inserted" | "updated" | "softDeleted">): boolean {
  return r.inserted + r.updated + r.softDeleted > 0;
}

/**
 * The connections a sweep tick should dispatch: active, and not currently
 * deferred.
 *
 * The expiry comparison is what makes F.3/F.6 self-healing REAL: a paused
 * connection is excluded only while its pause is in the future, so the first
 * tick after `paused_until` dispatches it again — that dispatch IS the probe
 * whose success clears the breaker. Without the expiry check, "paused" would
 * be the terminal state the spec forbids.
 */
export async function dueConnectionsForSweep(
  db: DB,
  now = new Date(),
): Promise<Array<{ id: string; orgId: string }>> {
  return db
    .select({ id: connections.id, orgId: connections.orgId })
    .from(connections)
    .where(
      and(
        eq(connections.status, "active"),
        or(isNull(connections.pausedUntil), lte(connections.pausedUntil, now)),
        // H.2: only connections whose adaptive cadence says they're due. A
        // never-swept connection (null) is due immediately.
        or(isNull(connections.nextSweepAt), lte(connections.nextSweepAt, now)),
      ),
    );
}

/**
 * A 429 IS A RATE LIMIT, NOT A FAULT — and the breaker must never see one.
 *
 * A surviving 429 (fetchJson retries once, honoring Retry-After up to its
 * backoff cap) used to land in the same catch as a revoked credential and a
 * 500: recordProviderError → tripBreaker → first rung of the probe ladder =
 * ONE HOUR paused, plus a consecutiveFailures notch that makes the next
 * genuine fault start further up the ladder. For the providers that send
 * `ratelimit-remaining` the observed-limit path already defers proactively;
 * this is the same courtesy for the ones that only say it with a 429.
 *
 * Returns the pause expiry when it handled the error, null when the error is
 * not a 429 (caller falls through to the breaker). The clamp mirrors
 * applyObservedRateLimit: at least 1s, at most 10 minutes, defaulting to 60s
 * when the provider sent no Retry-After. recordProviderError still runs — the
 * ledger's audit trail should show the throttle — but consecutiveFailures is
 * deliberately untouched.
 */
async function pauseForRateLimit(db: DB, conn: typeof connections.$inferSelect, e: unknown): Promise<Date | null> {
  if (!(e instanceof HttpError) || e.status !== 429) return null;
  const waitMs = Math.max(1_000, Math.min(e.retryAfterMs ?? 60_000, 10 * 60_000));
  await recordProviderError(db, conn);
  return pauseConnection(db, conn.id, waitMs, `${conn.source} rate limited (429) — resumes automatically`);
}

/**
 * The safety net that makes "never breaks" true: re-pull recent records from the
 * source and dedup them against what we already have, so any event a webhook
 * missed is still captured on the next sweep.
 *
 * Stream-scoped sources (Sheets, Calendar — the resource is chosen per flow)
 * poll each of their streams with its own cursor; a failing stream records its
 * error on the stream row and never blocks the others. Connection-scoped
 * sources keep the single connection-level cursor.
 */
export async function reconcileConnection(db: DB, connectionId: string): Promise<ReconcileResult> {
  const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId)).limit(1);
  if (!conn) throw new Error(`connection ${connectionId} not found`);

  /**
   * Has this endpoint refused a delivery inside the memory window?
   *
   * Read once, below, and consumed by two decisions that must not disagree:
   * whether a paused subscription may be switched back on, and whether a
   * "healthy" subscription licenses widening the poll floor. False until the
   * read happens, and it stays false for sources with no health check — which
   * is right, because those never widen the floor either.
   */
  let recentlyRejecting = false;

  /**
   * H.1/H.2/F.5 — every exit path records the next due time, so a connection
   * can never be left without a cadence. Wrapped here rather than sprinkled
   * through the returns.
   */
  const withCadence = async (result: ReconcileResult): Promise<ReconcileResult> => {
    // Deferred sweeps keep their existing cadence — the pause already schedules
    // the retry, and a no-op streak shouldn't grow from work we never did.
    // A skipped sweep is the same case for the same reason, plus one more: the
    // writer that DID hold the lease sets the cadence from real work.
    if (result.deferredUntil || result.skipped) return result;
    /**
     * A HEALTHY SUBSCRIPTION WIDENS THE POLL FLOOR, so "healthy" had better mean
     * deliveries are arriving — and on its own it does not.
     *
     * `decideCadence` raises any interval below sixty minutes up to sixty when
     * this is true (F.5): the poll becomes a backstop because the instant path
     * is carrying the data. That is sound when the instant path works and
     * backwards when it does not. If deliveries land, `promoteToBaseCadence`
     * holds the connection at base anyway and the widening never bites; if they
     * do not, nothing promotes it and freshness silently drops from ten minutes
     * to sixty. The widening happens exactly when the instant path is broken.
     *
     * Close is the proof. It had no `verifyWebhookSubscription` at all, so this
     * never fired for it; adding one made a subscription reporting
     * `status: "active"` sufficient to triple its poll interval — and
     * `status: "active"` is precisely the state that connection held for months
     * while rejecting every single POST with a 401.
     *
     * So the same evidence that decides whether a paused subscription may be
     * switched back on also decides this: if this endpoint refused a delivery
     * inside the memory window, the instant path is not carrying anything and
     * the poll is not a backstop. ONE reading of `delivery_log`, both verdicts.
     */
    const healthy = (result.webhook === "ok" || result.webhook === "reregistered") && !recentlyRejecting;
    const decision = decideCadence({
      changed: reconcileChanged(result),
      incomplete: result.incomplete,
      heldContinuation: result.heldContinuation,
      previousNoOps: conn.consecutiveNoOpSweeps ?? 0,
      webhookHealthyAt: healthy ? new Date() : conn.webhookHealthyAt,
    });
    await applyCadence(db, conn.id, decision, healthy);
    return result;
  };

  const connector = getConnector(conn.source);

  // F.3/F.6 — deferred work is not lost work. A connection paused by budget
  // exhaustion or a tripped breaker is skipped until its expiry; every pause
  // HAS an expiry, so this can never become a permanent halt.
  if (isPaused(conn)) {
    return withCadence({
      inserted: 0,
      updated: 0,
      softDeleted: 0,
      deduped: 0,
      polled: false,
      changedStreamHashes: [],
      deferredUntil: conn.pausedUntil ?? undefined,
      orgId: conn.orgId,
      source: conn.source,
    });
  }

  // Webhook-subscription health (D.6): sources whose connector can check the
  // provider side get verified every sweep, re-registering a lost subscription
  // before its absence turns into a data gap. Never blocks the poll below.
  let webhook: ReconcileResult["webhook"];
  if (connector?.verifyWebhookSubscription) {
    try {
      const credentials = await getConnectionCredentials(db, conn);
      // Same construction as webhookUrlFor (src/lib/connections.ts), inlined so
      // the ingestion layer doesn't pull in app-layer modules.
      const webhookUrl = `${process.env.APP_BASE_URL ?? ""}/api/webhooks/${conn.id}`;
      // Read here rather than in the connector, which has no database. ONE
      // reading, TWO decisions — see `webhookHealthy` for the second, which is
      // the one that quietly triples this connection's poll interval.
      recentlyRejecting = await connectionRefusedRecently(db, conn.id, REJECTION_MEMORY_MS);
      // THE HEALTH CHECK IS A PROVIDER CALL AND THE LEDGER MUST SEE IT.
      //
      // One GET per connection per sweep, plus a PUT when a paused subscription
      // is re-activated, all of it previously invisible to the budget — the same
      // shape as the settle bug: requests leaving the process that the model of
      // our own traffic does not contain. It draws on the SAME operation bucket
      // as the poll because it is the same provider quota; a separate bucket
      // would be a second model of one limit, which is how you go over it.
      //
      // A refused claim SKIPS the check rather than deferring the sweep. This is
      // a backstop competing with the primary path for a scarce resource, and a
      // backstop that can starve the thing it backs up is worse than one that
      // occasionally does not run. `webhook` stays undefined, which reads as
      // "not verifiable this sweep" — not as failure, and not as health.
      const healthOp = pollOperation(conn.source, conn.config);
      const healthClaimedAt = new Date();
      const healthClaim = await claimCalls(db, conn, healthOp, 1, healthClaimedAt);
      if (!healthClaim.allowed) throw new SkipHealthCheck();
      const v = await connector.verifyWebhookSubscription({ connectionId: conn.id, webhookUrl, credentials, recentlyRejecting });
      // The GET always happens; the PUT only on a re-activation. Settling the
      // real number is the half the settle bug got wrong.
      await settlePollCalls(db, conn, healthOp, { providerCalls: v.reregistered ? 2 : 1 }, 1, healthClaimedAt);
      webhook = v.healthy ? (v.reregistered ? "reregistered" : "ok") : "failed";
      if (!v.healthy) {
        await db
          .update(connections)
          .set({ lastError: `Webhook subscription check failed: ${v.detail ?? "unknown"}`, updatedAt: new Date() })
          .where(eq(connections.id, conn.id));
      }
    } catch (e) {
      // A skipped check is not a failed one. Leaving `webhook` undefined keeps
      // it out of BOTH verdicts: nothing is written to the connection, and the
      // cadence floor is not widened on the strength of a check never made.
      if (!(e instanceof SkipHealthCheck)) {
        webhook = "failed";
        await db
          .update(connections)
          .set({ lastError: `Webhook subscription check failed: ${e instanceof Error ? e.message : String(e)}`, updatedAt: new Date() })
          .where(eq(connections.id, conn.id));
      }
    }
  }

  // Sources that only push (no list endpoint) have nothing to reconcile.
  if (!connector?.poll)
    return withCadence({ inserted: 0, updated: 0, softDeleted: 0, deduped: 0, polled: false, webhook, changedStreamHashes: [], orgId: conn.orgId, source: conn.source });

  // Bound here, where the guard above has narrowed it: a closure cannot carry
  // the narrowing of a mutable property across its boundary.
  const poll = connector.poll.bind(connector);

  if (isStreamScoped(conn.source)) {
    const streams = (await activeStreams(db, connectionId)).filter((s) => s.status !== "disabled");
    let inserted = 0;
    let updated = 0;
    let softDeleted = 0;
    let deduped = 0;
    let failures = 0;
    let incomplete = false;
    // ORed across streams: one stream mid-walk is enough to keep the whole
    // connection at base cadence, because the sweep gap is a property of the
    // connection and the continuation belongs to a stream inside it.
    let heldContinuation = false;
    // The earliest moment a denied claim said the budget frees up. Held instead
    // of acted on, because acting on it used to mean RETURNING — and the first
    // stream denied budget silenced every stream after it in the list. A claim
    // denial is a fact about one (operation, minute) bucket, never about the
    // connection: Sheets' tab read and its Drive probe are different buckets 40×
    // apart, so the streams behind the denied one may have budget of their own.
    // Each still-denied stream costs one ledger roundtrip, not a provider call.
    let deferred: { reason: string; retryAfterMs: number } | undefined;
    const changedStreamHashes: string[] = [];
    for (const stream of streams) {
      try {
        // F.1: the budget is claimed per PROVIDER REQUEST inside syncStream —
        // it is the only place that knows how many pages a walk actually took.
        // Claiming once out here authorised the whole walk, so a budget of N
        // permitted N × maxPages real calls against the provider's limit.
        const r = await syncStream(db, conn, stream, 5);
        if (r.deferred) {
          // Skip THIS stream, not the sweep. Rows already written still count;
          // the walk resumes from its stored cursor next time, so nothing is
          // lost — and the streams after this one get their own claim.
          if (!deferred || r.deferred.retryAfterMs < deferred.retryAfterMs) deferred = r.deferred;
          inserted += r.inserted;
          updated += r.updated;
          softDeleted += r.softDeleted;
          deduped += r.deduped;
          if (r.inserted + r.updated + r.softDeleted > 0) changedStreamHashes.push(stream.configHash);
          continue;
        }
        inserted += r.inserted;
        updated += r.updated;
        softDeleted += r.softDeleted;
        deduped += r.deduped;
        if (r.incomplete) incomplete = true;
        if (r.heldContinuation) heldContinuation = true;
        // G.1: remember WHICH streams changed, so staleness stays stream-scoped.
        if (r.inserted + r.updated + r.softDeleted > 0) changedStreamHashes.push(stream.configHash);
        // The PROVIDER said its quota is spent — the opposite call from the
        // ledger's `deferred` above. That denial is about one operation bucket
        // and the next stream may have its own; this is about the credential
        // every stream here shares, so polling on would spend requests straight
        // into a wall the provider just named. The pause is already on the
        // connection row (written where the header was observed); returning
        // before recordSuccess is what keeps it there.
        if (r.observedPause) {
          return withCadence({
            inserted, updated, softDeleted, deduped,
            polled: true, webhook, changedStreamHashes,
            deferredUntil: r.observedPause, orgId: conn.orgId, source: conn.source,
          });
        }
      } catch (e) {
        // A 429 STOPS THE SWEEP — the same taxonomy as `observedPause` above:
        // it is the provider's account of the CREDENTIAL's quota, which every
        // stream here shares, so polling the next stream would spend requests
        // straight into the wall. It does NOT count into `failures`: the
        // breaker rung below is for faults, and a rate limit is not one.
        // Returning here also keeps the pause alive — recordSuccess (which
        // nulls pausedUntil) is never reached.
        const rateLimited = await pauseForRateLimit(db, conn, e);
        if (rateLimited) {
          return withCadence({
            inserted, updated, softDeleted, deduped,
            polled: true, webhook, changedStreamHashes,
            deferredUntil: rateLimited, orgId: conn.orgId, source: conn.source,
          });
        }
        failures += 1;
        await recordProviderError(db, conn);
        // Recorded on the stream row; other streams keep syncing.
        if (failures === streams.length) {
          // EVERY stream failed → the connection itself is unhealthy.
          const until = await tripBreaker(db, conn.id, e instanceof Error ? e.message : String(e));
          return withCadence({
            inserted, updated, softDeleted, deduped,
            polled: true, webhook, changedStreamHashes,
            deferredUntil: until.pausedUntil, orgId: conn.orgId, source: conn.source,
          });
        }
      }
    }
    // `!deferred` keeps recordSuccess honest: a budget-deferred sweep may have
    // made no provider contact at all (denied at page 0 of every stream), and
    // clearing `consecutiveFailures` on the strength of calls never made would
    // reset the probe ladder without evidence. Same rule as before this loop
    // learned to skip — deferral always returned before recordSuccess.
    if (streams.length > 0 && failures === 0 && !deferred) await recordSuccess(db, conn.id, { clearError: webhook !== "failed" });
    if (deferred) {
      // Paused AFTER the loop, once, on the earliest retry the ledger offered —
      // every stream got its claim first. recordSuccess clears pausedUntil, so
      // this must stay behind the guard above, never before it.
      const until = await pauseConnection(db, conn.id, deferred.retryAfterMs, `${deferred.reason} — resumes automatically`);
      return withCadence({
        inserted, updated, softDeleted, deduped,
        polled: true, webhook, changedStreamHashes,
        deferredUntil: until, orgId: conn.orgId, source: conn.source,
      });
    }
    return withCadence({ inserted, updated, softDeleted, deduped, polled: streams.length > 0, webhook, changedStreamHashes, incomplete, heldContinuation, orgId: conn.orgId, source: conn.source });
  }

  /**
   * C.1 — the whole read-poll-write span is one critical section, held under
   * the connection's lease. It has to include the poll: excluding only the
   * write would still let this sweep and a concurrent Test both read the same
   * cursor and both call the provider, which is the duplicate call and the
   * cursor interleave the lease exists to prevent.
   *
   * Taken BEFORE the budget claim, so a sweep that stands down spends no quota
   * on work it is not going to do.
   */
  const swept = await withConnectionSyncLock(db, connectionId, async (): Promise<ReconcileResult> => {
    // F.1: claim before spending a provider call, against the endpoint the poll
    // will hit (see pollOperation — "*" is correct for one-bucket providers).
    // One instant for the claim and its settle-up below — a poll that straddles a
    // minute boundary must not settle into the next window (settlePollCalls).
    const claimedAt = new Date();
    const claim = await claimCalls(db, conn, pollOperation(conn.source, conn.config), 1, claimedAt);
    if (!claim.allowed) {
      const until = await pauseConnection(db, conn.id, claim.retryAfterMs, `${claim.reason} — resumes automatically`);
      return withCadence({
        inserted: 0, updated: 0, softDeleted: 0, deduped: 0,
        polled: false, webhook, changedStreamHashes: [],
        deferredUntil: until, orgId: conn.orgId, source: conn.source,
      });
    }

    const [state] = await db.select().from(syncState).where(eq(syncState.connectionId, connectionId)).limit(1);
    const cursor = state?.cursor ?? null;

    const credentials = await getConnectionCredentials(db, conn);

    let records: Awaited<ReturnType<typeof poll>>["records"];
    let nextCursor: string | null;
    // A connection-scoped poll is called ONCE — the connector's own page walk is
    // invisible to this runner — so `incomplete` is the only way Close or
    // Sendblue can say it still has history to fetch. Without it a connection
    // mid-import reads as idle and tiers down, which slows the very pages it is
    // still waiting on.
    let incomplete: boolean | undefined;
    let providerCalls: number | undefined;
    let extraCalls: Record<string, number> | undefined;
    let rateLimit: Awaited<ReturnType<typeof poll>>["rateLimit"];
    try {
      ({ records, nextCursor, incomplete, providerCalls, extraCalls, rateLimit } = await poll({
        connectionId,
        cursor,
        credentials,
        config: conn.config ?? undefined,
      }));
    } catch (e) {
      // A rate limit defers; only a FAULT trips the breaker (see
      // pauseForRateLimit). The old path sent a surviving 429 up the probe
      // ladder: one unlucky minute cost an hour of freshness.
      const rateLimited = await pauseForRateLimit(db, conn, e);
      if (rateLimited) {
        return withCadence({
          inserted: 0, updated: 0, softDeleted: 0, deduped: 0,
          polled: true, webhook, changedStreamHashes: [],
          deferredUntil: rateLimited, orgId: conn.orgId, source: conn.source,
        });
      }
      // F.6: trip one notch of the probe ladder — paused, never terminal.
      await recordProviderError(db, conn);
      const until = await tripBreaker(db, conn.id, e instanceof Error ? e.message : String(e));
      return withCadence({
        inserted: 0, updated: 0, softDeleted: 0, deduped: 0,
        polled: true, webhook, changedStreamHashes: [],
        deferredUntil: until.pausedUntil, orgId: conn.orgId, source: conn.source,
      });
    }

    // The claim above bought ONE call, but a connector that pages internally
    // may have spent several. Settle up: the spend cannot be un-made, but the
    // next sweep must not be authorised on a false reading.
    await settlePollCalls(db, conn, pollOperation(conn.source, conn.config), { providerCalls, extraCalls }, 1, claimedAt);

    // Connection-scoped reconciliation writes at the connection's current
    // generation (>= 1): these are poll-managed rows a future full re-sync must
    // be able to retire, not append-only webhook rows.
    const res = await upsertEvents(
      db,
      { orgId: conn.orgId, connectionId, source: conn.source, generation: Math.max(1, conn.syncGeneration ?? 0) },
      records,
    );
    await upsertSyncCursor(db, connectionId, nextCursor);
    // Keep what the provider said its ceiling WAS. It was parsed on the way past
    // and thrown away, and it is the only evidence this system has about a real
    // provider budget — four of seven sources currently run on a DEFAULT_RPM
    // nobody published. Recorded, never acted on: a catalog limit should come
    // from a day of these, not from one header.
    await recordObservedLimit(db, conn, pollOperation(conn.source, conn.config), rateLimit);
    // A clean poll clears any breaker state — the connection is healthy again
    // (but never erases a standing webhook-health warning). BEFORE the observed
    // pause below, and the order is load-bearing: recordSuccess nulls
    // `pausedUntil`, so the old order wrote the pause and erased it three lines
    // later — the sweep reported a deferral the connection row no longer
    // carried, and the next sweep polled straight into the exhausted quota.
    await recordSuccess(db, conn.id, { clearError: webhook !== "failed" });
    // The provider's own account of its remaining quota beats our declared
    // guess. Exhausted means exhausted — defer rather than learn it via a 429.
    const observedPause = await applyObservedRateLimit(db, conn, rateLimit);

    return withCadence({
      inserted: res.inserted, updated: res.updated, softDeleted: 0, deduped: res.deduped,
      polled: true, webhook, changedStreamHashes: [], incomplete,
      // Asked of the cursor just persisted, which for Close and Sendblue is
      // where a mid-walk `cont` lives. It is not the same question as
      // `incomplete`: Close's 400-handler returns a cursor with `cont` cleared
      // AND `incomplete: true`, while a budget-bounded walk returns both set —
      // only the stored cursor says whether something with a deadline is being
      // held.
      heldContinuation: connector.holdsContinuation?.(nextCursor) ?? false,
      ...(observedPause ? { deferredUntil: observedPause } : {}),
      orgId: conn.orgId, source: conn.source,
    });
  });

  if (swept.acquired && swept.result) return swept.result;
  // Someone else is mid-sync on this connection. Stand down — no poll, no
  // cadence change, nothing lost: the holder is doing this work right now.
  return withCadence({
    inserted: 0, updated: 0, softDeleted: 0, deduped: 0,
    polled: false, webhook, changedStreamHashes: [],
    skipped: true, orgId: conn.orgId, source: conn.source,
  });
}

async function upsertSyncCursor(db: DB, connectionId: string, cursor: string | null): Promise<void> {
  const now = new Date();
  await db
    .insert(syncState)
    .values({ connectionId, cursor, lastPolledAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: syncState.connectionId,
      set: { cursor, lastPolledAt: now, updatedAt: now },
    });
}
