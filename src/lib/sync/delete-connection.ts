import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  backfillJobs,
  connections,
  deadLetter,
  deliveryLog,
  events,
  rawEvents,
  sourceStreams,
  streamFields,
  syncState,
  usageLedger,
} from "@/db/schema";
import type { DB } from "@/db/types";
import { FLEET_CONNECTION_ID, FLEET_ORG_ID } from "@/lib/provider-gateway/budget";
import { markStaleForSource } from "@/lib/flow/materialize";

/**
 * REMOVING A CONNECTION AND EVERYTHING SYNCED FROM IT. Irreversible.
 *
 * The other half of `retire-connection.ts`, and the two must stay obviously
 * different: that one hides an integration and can be undone, this one destroys
 * it. Both exist because collapsing them is what the product did before —
 * "remove" hard-deleted the row, and since every connector namespaces its
 * `eventId` with the connection UUID, re-adding the same account imported a
 * SECOND complete copy instead of restoring the first.
 *
 * Takes `db` for the same reason `retire-connection.ts` does: the wrapper in
 * `connections.ts` is `server-only` and reaches for `getDb()`, which makes it
 * untestable, and this is the last function in the codebase that should be
 * asserted indirectly.
 */

/** Rows removed per statement, so one pass can never lock a hot table. */
const DELETE_BATCH = 5_000;

export type DeleteConnectionResult = { removed: boolean; rows: Record<string, number> };

/**
 * Delete in bounded batches until a table holds none of this connection's rows.
 *
 * `events`, `raw_events` and `delivery_log` are the three that can be large — a
 * busy webhook connection holds a raw row per delivery, forever — and an
 * unbounded `DELETE ... WHERE connection_id = ?` on them holds a lock for as
 * long as it takes. The rest are bounded by streams, operations or failures and
 * go in one statement each.
 */
async function deleteAllOf<T>(
  select: (limit: number) => Promise<Array<{ id: T }>>,
  remove: (ids: T[]) => Promise<void>,
): Promise<number> {
  let removed = 0;
  for (;;) {
    const batch = await select(DELETE_BATCH);
    if (batch.length === 0) return removed;
    await remove(batch.map((r) => r.id));
    removed += batch.length;
    if (batch.length < DELETE_BATCH) return removed;
  }
}

/**
 * Delete a connection and every row anywhere that belongs to it.
 *
 * NOTHING CASCADES. There is not one foreign key to `connections` in this
 * schema, so every table has to be named here. The old `deleteConnection`
 * (removed in batch 4) deleted `connections` and `source_streams` and left
 * SEVEN tables of orphans behind — rows no UI could reach and no later pass
 * looked for. That is the failure this list exists to prevent, and it is why
 * the list is written out rather than derived: a table added later is a table
 * that leaks, and a reader adding one will see this comment.
 *
 * ORDER IS FOR PARTIAL FAILURE. There is no transaction on the http driver
 * (`db.transaction` does nothing until `DB_DRIVER=pool`, which is off), so this
 * can die halfway. So:
 *   1. mark it DISABLED first — the webhook route 403s a disabled connection
 *      and the sweep skips it, which stops new rows arriving into tables this
 *      is about to empty;
 *   2. tell the dashboards, while the graph still resolves;
 *   3. delete the children;
 *   4. delete the connection row LAST.
 * A crash then leaves a disabled connection with some data gone: visible,
 * re-runnable, and syncing nothing. Deleting the row first would strand every
 * child row instead — no connection means no UI to find them from and no later
 * pass that looks.
 *
 * Idempotent by construction: every step is "delete what matches", so re-running
 * finishes an interrupted pass.
 */
export async function deleteConnectionData(
  db: DB,
  orgId: string,
  id: string,
  /**
   * The connection's name, typed back by whoever is asking.
   *
   * Part of the CONTRACT rather than a courtesy in the browser, because the
   * browser is not the only way here: the server action is reachable without the
   * page, and what it destroys cannot be restored from anywhere. Requiring the
   * caller to name the thing means no path — a form, a script, a future admin
   * tool — can delete a connection without having established WHICH one.
   */
  confirmName: string,
): Promise<DeleteConnectionResult> {
  /**
   * The org predicate is on this READ, and this read gates everything below.
   *
   * Deliberately not repeated on each child delete: `events.org_id` and friends
   * are denormalised copies, and a row whose `connection_id` matches while its
   * `org_id` does not is corruption rather than another tenant's data —
   * filtering it out would silently leave exactly the rows most in need of
   * removing.
   */
  const [conn] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.id, id), eq(connections.orgId, orgId)))
    .limit(1);
  if (!conn) return { removed: false, rows: {} };
  // Named wrong, or not named at all. Nothing happens, and nothing is reported
  // as having happened.
  if (confirmName.trim() !== conn.name.trim()) return { removed: false, rows: {} };
  /**
   * The one row in `usage_ledger` that is nobody's connection: the fleet-wide
   * provider budget, keyed by a nil UUID under a sentinel org. It cannot be
   * reached through the read above — a real connection's id is a generated UUID
   * and its org is a real org — so this is belt to that braces. It is here
   * because the consequence is not "one customer loses data" but "every
   * customer's shared provider ceiling resets", and that is worth a comparison.
   */
  if (id === FLEET_CONNECTION_ID || orgId === FLEET_ORG_ID) return { removed: false, rows: {} };

  const now = new Date();
  await db
    .update(connections)
    .set({
      status: "disabled",
      // Not refreshed if it is already set: `disabled_at` is the clock a
      // retention pass runs on, and this delete is not a reason to move it.
      disabledAt: conn.disabledAt ?? now,
      pausedUntil: null,
      pausedReason: null,
      nextSweepAt: null,
      updatedAt: now,
    })
    .where(and(eq(connections.id, id), eq(connections.orgId, orgId)));

  /**
   * Tell the dashboards BEFORE the data goes.
   *
   * A published flow reading this connection holds a STORED result with a number
   * in it, and nothing recomputes on its own. Deleting the events without
   * marking those results stale leaves the tile reporting a count of records
   * that no longer exist — the silent-wrong-answer class, arriving through the
   * one door that cannot be walked back.
   *
   * Best-effort: a flow whose graph will not parse must not block a delete the
   * user has already confirmed. The scheduled materialize pass is the backstop.
   */
  await markStaleForSource(db, orgId, conn.source, id).catch(() => []);

  const rows: Record<string, number> = {};
  rows.events = await deleteAllOf(
    (limit) => db.select({ id: events.id }).from(events).where(eq(events.connectionId, id)).limit(limit),
    async (ids) => void (await db.delete(events).where(inArray(events.id, ids))),
  );
  rows.raw_events = await deleteAllOf(
    (limit) => db.select({ id: rawEvents.id }).from(rawEvents).where(eq(rawEvents.connectionId, id)).limit(limit),
    async (ids) => void (await db.delete(rawEvents).where(inArray(rawEvents.id, ids))),
  );
  rows.delivery_log = await deleteAllOf(
    (limit) => db.select({ id: deliveryLog.id }).from(deliveryLog).where(eq(deliveryLog.connectionId, id)).limit(limit),
    async (ids) => void (await db.delete(deliveryLog).where(inArray(deliveryLog.id, ids))),
  );
  const count = async (p: Promise<Array<unknown>>) => (await p).length;
  rows.source_streams = await count(db.delete(sourceStreams).where(eq(sourceStreams.connectionId, id)).returning({ id: sourceStreams.id }));
  rows.sync_state = await count(db.delete(syncState).where(eq(syncState.connectionId, id)).returning({ id: syncState.connectionId }));
  rows.usage_ledger = await count(db.delete(usageLedger).where(eq(usageLedger.connectionId, id)).returning({ id: usageLedger.id }));
  rows.dead_letter = await count(db.delete(deadLetter).where(eq(deadLetter.connectionId, id)).returning({ id: deadLetter.id }));
  rows.stream_fields = await count(db.delete(streamFields).where(eq(streamFields.connectionId, id)).returning({ id: streamFields.id }));
  rows.backfill_jobs = await count(db.delete(backfillJobs).where(eq(backfillJobs.connectionId, id)).returning({ id: backfillJobs.id }));

  rows.connections = await count(
    db.delete(connections).where(and(eq(connections.id, id), eq(connections.orgId, orgId))).returning({ id: connections.id }),
  );
  return { removed: rows.connections > 0, rows };
}

/**
 * Live records per connection, for the org's Integrations list.
 *
 * One grouped aggregate rather than a count per row: the list renders every
 * connection an org has, so a query each would make the page cost scale with
 * how many integrations somebody happens to own.
 *
 * LIVE rows only — the same set the dashboards read, so the number in the delete
 * warning is the number the user recognises. A disconnected connection therefore
 * reports nothing, which is honest: its records are tombstoned and invisible
 * until it is reconnected.
 */
export async function recordCountsByConnection(db: DB, orgId: string): Promise<Record<string, number>> {
  const rows = await db
    .select({ connectionId: events.connectionId, n: sql<number>`count(*)::int` })
    .from(events)
    .where(and(eq(events.orgId, orgId), isNull(events.deletedAt)))
    .groupBy(events.connectionId);
  return Object.fromEntries(rows.map((r) => [r.connectionId, r.n]));
}
