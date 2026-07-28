import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { events } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * Retire the canonical events belonging to a connection the user has removed.
 *
 * Removing an integration has to remove its DATA from the product, not just its
 * credentials. Nothing else does this: `events.connection_id` carries no foreign
 * key, so deleting a connection row leaves every event it ever wrote behind,
 * still live, still counted by any read that isn't scoped to a connection that
 * now no longer exists — classic dashboard metrics read org-wide, so a removed
 * integration's records would keep inflating those numbers forever, with no
 * surface left in the UI to find or remove them.
 *
 * SOFT delete, deliberately, on both counts:
 *
 *  - It is what makes the data disappear. Every read path filters
 *    `deleted_at IS NULL` (a convention pinned on the table in schema.ts and in
 *    DATA_MODEL.md), so tombstoning is the supported way to take rows out of
 *    circulation.
 *  - It is reversible. Disconnecting is a single click and there is no in-place
 *    re-authentication in this app — a user fixing an expired credential makes a
 *    NEW connection — so a mis-click must not be destructive. Clearing
 *    `deleted_at` for the connection restores everything exactly.
 *
 * Matches only rows that are still live, which makes it idempotent: a re-run
 * finds nothing, and rows tombstoned by an earlier sweep keep their original
 * deletion time rather than being re-stamped.
 *
 * Batched so one statement can never hold a long lock on a big `events` table;
 * each batch commits on its own, so an interrupted run is safely resumable.
 */

/** Rows retired per batch — matches the legacy reconciliation's batch size. */
const BATCH = 2_000;

/** The rows a removal retires: this connection's, in this org, still live. */
function liveRowsOf(orgId: string, connectionId: string) {
  return and(
    eq(events.orgId, orgId),
    eq(events.connectionId, connectionId),
    isNull(events.deletedAt),
  );
}

/**
 * Tombstone every live event of `connectionId`. Returns how many were retired.
 * Org-scoped, so it can never reach another tenant's rows even if a connection
 * id were guessed.
 */
export async function retireConnectionEvents(db: DB, orgId: string, connectionId: string): Promise<number> {
  let retired = 0;
  for (;;) {
    const batch = await db
      .select({ id: events.id })
      .from(events)
      .where(liveRowsOf(orgId, connectionId))
      .limit(BATCH);
    if (batch.length === 0) break;
    const done = await db
      .update(events)
      .set({ deletedAt: new Date() })
      .where(
        inArray(
          events.id,
          batch.map((r) => r.id),
        ),
      )
      .returning({ id: events.id });
    retired += done.length;
    if (batch.length < BATCH) break;
  }
  return retired;
}

/**
 * Un-tombstone a reconnected connection's events. The exact inverse of
 * `retireConnectionEvents`, and it lives beside it so the two cannot drift.
 *
 * This is what makes reconnecting free. The rows were never destroyed and the
 * connection UUID never changed, so every `eventId` still matches what the
 * connector would produce today — clearing `deleted_at` restores the dataset in
 * place, with no provider call and no second copy.
 *
 * Matches only rows that are actually dead, which keeps it idempotent, and
 * scoped to the org for the same reason the retire is.
 *
 * The honest limit: this restores what is still THERE. Once a purge has
 * hard-deleted rows (Phase 2 half B, at thirty days), there is nothing to
 * restore and reconnecting re-imports from the provider instead — which is why
 * the disconnect confirmation has to state that date.
 */
export async function restoreConnectionEvents(db: DB, orgId: string, connectionId: string): Promise<number> {
  let restored = 0;
  for (;;) {
    const batch = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.orgId, orgId), eq(events.connectionId, connectionId), isNotNull(events.deletedAt)))
      .limit(BATCH);
    if (batch.length === 0) break;
    const done = await db
      .update(events)
      .set({ deletedAt: null })
      .where(
        inArray(
          events.id,
          batch.map((r) => r.id),
        ),
      )
      .returning({ id: events.id });
    restored += done.length;
    if (batch.length < BATCH) break;
  }
  return restored;
}
