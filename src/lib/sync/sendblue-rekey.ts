import { and, eq, isNull, like, sql } from "drizzle-orm";
import { connections, events } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * ONE-TIME cleanup after Sendblue's event ids stopped embedding the message
 * status.
 *
 * Old shape: `sendblue:<connection>:<sms_type>:<handle>`
 * New shape: `sendblue:<connection>:<handle>`
 *
 * The two never collide, so from the moment the new connector deploys **every
 * Sendblue message that was already stored exists twice** — once under each
 * scheme — and counts read HIGH until this runs. A message that arrived by
 * webhook at all three lifecycle stages counts four times: three old rows plus
 * the one new one.
 *
 * Two classes of stale row, and only one cleans itself up:
 *
 * - **Poll-written** rows sit at generation >= 1, so a **full re-sync** retires
 *   them through the existing generation mechanism. No new code, no risk.
 * - **Webhook-written** rows sit at generation 0 with `stream_hash` NULL, and
 *   **no sweep can reach them**: every sweep's soft-delete is either
 *   generation-guarded or stream-hash-scoped, by construction, because the
 *   append-only class must survive every sweep. Disconnect does reach them — it
 *   tombstones a whole connection, reversibly — but that hides everything rather
 *   than repairing this. They are permanent until something deliberately targets
 *   them, which is what this is.
 *
 * That second class is why this exists.
 *
 * Safety, in the same shape as `legacy-reconciliation.ts`:
 * - matches ONLY ids carrying an old `:sms_*:` segment, so a new-shape row can
 *   never be caught;
 * - matches ONLY `deleted_at IS NULL`, which is what makes a re-run (or a
 *   resumed interrupted run) find nothing left;
 * - soft-deletes; nothing is destroyed;
 * - scoped to sendblue connections, so no other source is touchable.
 */

/** Rows retired per batch, so one statement can't lock the table for long. */
const BATCH = 2_000;

/**
 * The old id shapes, exactly. `statusToType` could only ever produce these
 * five, so an explicit list beats a wildcard that might match a handle
 * containing "sms_".
 */
const OLD_SEGMENTS = ["sms_received", "sms_delivered", "sms_sent", "sms_queued", "sms_error"] as const;

export type SendblueRekeyReport = {
  /** Sendblue connections inspected. */
  connections: number;
  /** Old-shape rows still live. */
  candidates: number;
  /** Of those, the ones no sweep can ever retire (webhook-written, generation 0). */
  unreachableByAnySweep: number;
  /** Rows actually tombstoned (0 in dry-run). */
  tombstoned: number;
  dryRun: boolean;
};

async function sendblueConnectionIds(db: DB): Promise<string[]> {
  const rows = await db.select({ id: connections.id }).from(connections).where(eq(connections.source, "sendblue"));
  return rows.map((r) => r.id);
}

/** Live rows on `connectionId` whose id still carries a status segment. */
function oldShapeCondition(connectionId: string) {
  const anyOldSegment = OLD_SEGMENTS.map((seg) => like(events.eventId, `sendblue:${connectionId}:${seg}:%`));
  return and(
    eq(events.connectionId, connectionId),
    isNull(events.deletedAt),
    sql`(${sql.join(anyOldSegment, sql` or `)})`,
  );
}

/**
 * Inspect (default) or retire the old-shape rows.
 *
 * Ordering matters and the caller must respect it: run a **full re-sync first**,
 * then this. Reversed, the re-sync re-imports under new ids after this has
 * already counted, and the report no longer describes what is there.
 */
export async function rekeySendblueIds(db: DB, opts: { apply?: boolean } = {}): Promise<SendblueRekeyReport> {
  const dryRun = !opts.apply;
  const ids = await sendblueConnectionIds(db);
  let candidates = 0;
  let unreachableByAnySweep = 0;
  let tombstoned = 0;

  for (const connectionId of ids) {
    const [row] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(events)
      .where(oldShapeCondition(connectionId));
    candidates += Number(row?.c ?? 0);

    const [gen0] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(events)
      .where(and(oldShapeCondition(connectionId), eq(events.syncGeneration, 0)));
    unreachableByAnySweep += Number(gen0?.c ?? 0);

    if (dryRun) continue;

    // Batched drain: bounded per statement, safe to interrupt, safe to re-run.
    for (;;) {
      const batch = await db
        .select({ id: events.id })
        .from(events)
        .where(oldShapeCondition(connectionId))
        .limit(BATCH);
      if (batch.length === 0) break;
      const done = await db
        .update(events)
        .set({ deletedAt: new Date() })
        .where(
          sql`${events.id} in (${sql.join(batch.map((b) => sql`${b.id}`), sql`, `)})`,
        )
        .returning({ id: events.id });
      tombstoned += done.length;
      if (done.length < BATCH) break;
    }
  }

  return { connections: ids.length, candidates, unreachableByAnySweep, tombstoned, dryRun };
}
