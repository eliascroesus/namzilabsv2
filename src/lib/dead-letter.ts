import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { connections, deadLetter } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * Read surface for the dead-letter queue — the door the red dashboard count
 * never had. Payloads that exhausted their retries are parked in
 * `dead_letter`, never dropped, and are replayable (`replayRawEvent`
 * reprocesses from the stored raw body — no provider call involved). All of
 * that was true and none of it was VISIBLE: the dashboard showed a count, the
 * README promised a replay UI, and no page listed a single row.
 *
 * Both reads are org-scoped at the query, same as every other read surface
 * the tenant-isolation net covers.
 */

/** Mirrors REPORT_LIMIT's reasoning (health/invariants.ts): a list a human
 *  reads, bounded so one flood cannot make the page unrenderable. */
const LIST_LIMIT = 50;

export type DeadLetterRow = {
  id: string;
  rawEventId: string | null;
  error: string;
  attempts: number;
  createdAt: Date;
};

/** Unresolved dead letters for one connection, newest first. */
export async function unresolvedDeadLetters(db: DB, orgId: string, connectionId: string): Promise<DeadLetterRow[]> {
  return db
    .select({
      id: deadLetter.id,
      rawEventId: deadLetter.rawEventId,
      error: deadLetter.error,
      attempts: deadLetter.attempts,
      createdAt: deadLetter.createdAt,
    })
    .from(deadLetter)
    .where(and(eq(deadLetter.orgId, orgId), eq(deadLetter.connectionId, connectionId), isNull(deadLetter.resolvedAt)))
    .orderBy(desc(deadLetter.createdAt))
    .limit(LIST_LIMIT);
}

/**
 * Unresolved counts per connection, with the connection's name — so the
 * dashboard's red number can say WHERE and link to the page that can fix it,
 * instead of being a dead-end scalar.
 */
export async function unresolvedDeadLetterCountsByConnection(
  db: DB,
  orgId: string,
): Promise<Array<{ connectionId: string; name: string; count: number }>> {
  return db
    .select({
      connectionId: deadLetter.connectionId,
      name: sql<string>`coalesce(${connections.name}, 'Unknown connection')`,
      count: sql<number>`count(*)::int`,
    })
    .from(deadLetter)
    .leftJoin(connections, eq(connections.id, deadLetter.connectionId))
    .where(and(eq(deadLetter.orgId, orgId), isNull(deadLetter.resolvedAt)))
    .groupBy(deadLetter.connectionId, connections.name)
    .orderBy(desc(sql`count(*)`));
}
