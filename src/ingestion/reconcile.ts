import { and, eq, isNull, lte, or } from "drizzle-orm";
import { connections, syncState } from "@/db/schema";
import type { DB } from "@/db/types";
import { getConnector } from "@/connectors/registry";
import { isStreamScoped } from "@/connectors/catalog";
import { getConnectionCredentials } from "@/lib/credentials";
import { claimCalls, isPaused, pauseConnection, recordProviderError, recordSuccess, tripBreaker } from "@/lib/provider-gateway/budget";
import { pollOperation } from "@/lib/provider-gateway/operations";
import { withConnectionSyncLock } from "@/lib/sync/locks";
import { upsertEvents } from "./pipeline";
import { activeStreams, syncStream } from "@/lib/sync/streams";
import { applyCadence, decideCadence } from "@/lib/sync/cadence";

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
    const healthy = result.webhook === "ok" || result.webhook === "reregistered";
    const decision = decideCadence({
      changed: reconcileChanged(result),
      incomplete: result.incomplete,
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
      const v = await connector.verifyWebhookSubscription({ connectionId: conn.id, webhookUrl, credentials });
      webhook = v.healthy ? (v.reregistered ? "reregistered" : "ok") : "failed";
      if (!v.healthy) {
        await db
          .update(connections)
          .set({ lastError: `Webhook subscription check failed: ${v.detail ?? "unknown"}`, updatedAt: new Date() })
          .where(eq(connections.id, conn.id));
      }
    } catch (e) {
      webhook = "failed";
      await db
        .update(connections)
        .set({ lastError: `Webhook subscription check failed: ${e instanceof Error ? e.message : String(e)}`, updatedAt: new Date() })
        .where(eq(connections.id, conn.id));
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
    const changedStreamHashes: string[] = [];
    for (const stream of streams) {
      // F.1: each stream poll claims from the connection's per-minute budget,
      // against the endpoint THIS stream will actually call — two streams on one
      // connection can hit endpoints with different published limits.
      const claim = await claimCalls(db, conn, pollOperation(conn.source, stream.config));
      if (!claim.allowed) {
        const until = await pauseConnection(db, conn.id, claim.retryAfterMs, `${claim.reason} — resumes automatically`);
        return withCadence({
          inserted, updated, softDeleted, deduped,
          polled: true, webhook, changedStreamHashes,
          deferredUntil: until, orgId: conn.orgId, source: conn.source,
        });
      }
      try {
        const r = await syncStream(db, conn, stream, 5);
        inserted += r.inserted;
        updated += r.updated;
        softDeleted += r.softDeleted;
        deduped += r.deduped;
        if (r.incomplete) incomplete = true;
        // G.1: remember WHICH streams changed, so staleness stays stream-scoped.
        if (r.inserted + r.updated + r.softDeleted > 0) changedStreamHashes.push(stream.configHash);
      } catch (e) {
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
    if (streams.length > 0 && failures === 0) await recordSuccess(db, conn.id, { clearError: webhook !== "failed" });
    return withCadence({ inserted, updated, softDeleted, deduped, polled: streams.length > 0, webhook, changedStreamHashes, incomplete, orgId: conn.orgId, source: conn.source });
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
    const claim = await claimCalls(db, conn, pollOperation(conn.source, conn.config));
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
    try {
      ({ records, nextCursor, incomplete } = await poll({
        connectionId,
        cursor,
        credentials,
        config: conn.config ?? undefined,
      }));
    } catch (e) {
      // F.6: trip one notch of the probe ladder — paused, never terminal.
      await recordProviderError(db, conn);
      const until = await tripBreaker(db, conn.id, e instanceof Error ? e.message : String(e));
      return withCadence({
        inserted: 0, updated: 0, softDeleted: 0, deduped: 0,
        polled: true, webhook, changedStreamHashes: [],
        deferredUntil: until.pausedUntil, orgId: conn.orgId, source: conn.source,
      });
    }

    // Connection-scoped reconciliation writes at the connection's current
    // generation (>= 1): these are poll-managed rows a future full re-sync must
    // be able to retire, not append-only webhook rows.
    const res = await upsertEvents(
      db,
      { orgId: conn.orgId, connectionId, source: conn.source, generation: Math.max(1, conn.syncGeneration ?? 0) },
      records,
    );
    await upsertSyncCursor(db, connectionId, nextCursor);
    // A clean poll clears any breaker state — the connection is healthy again
    // (but never erases a standing webhook-health warning).
    await recordSuccess(db, conn.id, { clearError: webhook !== "failed" });

    return withCadence({ inserted: res.inserted, updated: res.updated, softDeleted: 0, deduped: res.deduped, polled: true, webhook, changedStreamHashes: [], incomplete, orgId: conn.orgId, source: conn.source });
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
