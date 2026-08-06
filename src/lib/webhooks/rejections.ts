import { and, eq, gte, sql } from "drizzle-orm";
import { deliveryLog } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * A REJECTED DELIVERY LEAVES A TRACE, WITHOUT STORING WHAT WAS REJECTED.
 *
 * The inbound route has two 401 paths — an unreadable signing secret and a
 * failed signature check — and between them they produced no persistent record
 * at all: nothing in `raw_events` (correct, the payload is unverified), nothing
 * in `delivery_log`, and the signature branch did not even log. So a connection
 * could refuse every delivery indefinitely and the only evidence was the
 * platform's request log, which nothing aggregates and nobody is watching at
 * 3am. That is the same shape as every other counter in this codebase that had
 * to have a reader added: the signal existed and reached nothing.
 *
 * WHAT IS RECORDED IS THE FACT, NEVER THE BODY. A rejected request failed
 * authentication, so its contents are exactly the thing not to trust — and
 * `raw_events` is the replay source of truth, which an unverified payload must
 * never enter. A `delivery_log` row with a NULL `raw_event_id` says "a delivery
 * was attempted and refused, here, at this time, for this reason" and says
 * nothing else. The table already permits a null `raw_event_id`, is already
 * indexed by connection and status, and is already pruned at 30 days, so this
 * costs no schema and no new retention decision.
 *
 * ONE ROW PER CONNECTION PER MINUTE, and that bound is the point rather than an
 * optimisation. The flood that prompted this ran at one to three requests a
 * second; recording each would be a quarter of a million rows a day against a
 * prune that removes five thousand a night, so the observability fix would
 * become the disk problem. A minute's grain answers every question anyone asks
 * of it — is this happening, since when, is it still happening — and none of the
 * questions it cannot answer are worth that trade.
 *
 * The window is held in memory, so several instances may each write a row for
 * the same minute. Bounded and harmless: the reader below counts distinct
 * minutes rather than rows, and a handful per minute is still four orders of
 * magnitude below the raw rate.
 */

/** Coarse de-duplication window. One row per connection per minute, per instance. */
const RECORD_EVERY_MS = 60_000;

/**
 * Last time a rejection was recorded for a connection, in this instance.
 *
 * Module-level, therefore shared across concurrent requests on one instance —
 * which is what makes it work rather than a hazard. It is keyed by connection id
 * and holds only a timestamp, so there is nothing here one tenant could read
 * about another, and the worst a race can do is write two rows for one minute.
 */
const lastRecorded = new Map<string, number>();

export type RejectionReason = "unreadable-secret" | "invalid-signature" | "oversized-body";

/**
 * Note that a delivery was refused. Best-effort: an endpoint that is already
 * rejecting must not also start failing on its own bookkeeping, so every error
 * here is swallowed.
 */
export async function recordRejectedDelivery(
  db: DB,
  conn: { id: string; orgId: string; source: string },
  reason: RejectionReason,
  now = Date.now(),
): Promise<boolean> {
  const last = lastRecorded.get(conn.id) ?? 0;
  if (now - last < RECORD_EVERY_MS) return false;
  lastRecorded.set(conn.id, now);
  try {
    await db.insert(deliveryLog).values({
      orgId: conn.orgId,
      connectionId: conn.id,
      // NEVER a payload. There is no raw event, because storing an unverified
      // body is the thing this path exists to refuse.
      rawEventId: null,
      status: "rejected",
      attempt: 1,
      error: `${reason} (${conn.source}); at least one delivery refused in this minute`,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Has THIS connection refused a delivery recently?
 *
 * The same question as `rejectingConnections` asks of everything, and a
 * different query on purpose. The aggregate below is unscoped — it filters on
 * `status` and `created_at`, neither of which is usefully indexed
 * (`delivery_log_status_idx` holds four values, `created_at` holds none), groups
 * the whole table, and is therefore a sequential scan. That is fine once a
 * night. On the sweep it was being run once per connection and all but one row
 * of the result thrown away: a full aggregate of a table that grows with every
 * delivery, on the hot path, N times per sweep, to answer a yes/no question
 * about one row.
 *
 * This form leads with `connection_id`, so it uses `delivery_log_conn_idx` and
 * stops at the first match. No migration: the index it needs already exists, and
 * scoping first makes the unindexed columns a filter over one connection's rows
 * rather than over the table.
 */
export async function connectionRefusedRecently(
  db: DB,
  connectionId: string,
  sinceMs: number,
  now = new Date(),
): Promise<boolean> {
  const cutoff = new Date(now.getTime() - sinceMs);
  const rows = await db
    .select({ id: deliveryLog.id })
    .from(deliveryLog)
    .where(
      and(
        eq(deliveryLog.connectionId, connectionId),
        eq(deliveryLog.status, "rejected"),
        gte(deliveryLog.createdAt, cutoff),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Connections that have refused at least one delivery recently.
 *
 * Read by the nightly invariant scan, which is the whole reason this is written
 * down rather than logged. Counts MINUTES in which something was refused, not
 * requests — the recorder samples, so a request count would be a number nobody
 * could interpret.
 *
 * WHOLE-TABLE AND UNSCOPED, which is correct HERE and was wrong on the sweep.
 * Once a night, asking about every connection at once, a scan is the right plan
 * and an index would be maintained on every write to be read once a day. The
 * hot-path caller uses `connectionRefusedRecently` instead.
 */
export async function rejectingConnections(
  db: DB,
  sinceMs: number,
  now = new Date(),
): Promise<Array<{ connectionId: string; minutes: number; lastAt: Date; lastError: string | null }>> {
  const cutoff = new Date(now.getTime() - sinceMs);
  const rows = await db
    .select({
      connectionId: deliveryLog.connectionId,
      minutes: sql<number>`count(*)::int`,
      lastAt: sql<Date>`max(${deliveryLog.createdAt})`,
      lastError: sql<string | null>`min(${deliveryLog.error})`,
    })
    .from(deliveryLog)
    .where(and(eq(deliveryLog.status, "rejected"), gte(deliveryLog.createdAt, cutoff)))
    .groupBy(deliveryLog.connectionId);
  return rows.map((r) => ({ ...r, lastAt: new Date(r.lastAt) }));
}
