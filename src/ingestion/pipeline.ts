import { eq, sql } from "drizzle-orm";
import { rawEvents, events, deliveryLog, deadLetter, connections } from "@/db/schema";
import type { DB } from "@/db/types";
import type { CanonicalEvent } from "@/connectors/types";
import { getConnector } from "@/connectors/registry";
import { normalizeDatesDeep } from "@/lib/normalize-dates";

export type ProcessResult = { inserted: number; updated: number; deduped: number; total: number };

type EventMeta = {
  orgId: string;
  connectionId: string;
  source: string;
  rawEventId?: string | null;
  /** Stream (resource) identity for polled events; null for webhook/instant events. */
  streamHash?: string | null;
  /** Poll/mirror generation stamp (≥1). Webhook/instant events leave it at 0. */
  generation?: number;
  /** Connector flag: occurredAt is synthetic first-seen — keep the stored value on conflict. */
  preserveOccurredAt?: boolean;
};

/** Multi-row insert chunk size — bounds statement size while cutting round-trips. */
const UPSERT_CHUNK = 500;

/**
 * THE single events writer. Dedup key is the stable `eventId`; conflicts REFRESH
 * the stored copy (ON CONFLICT DO UPDATE) so a re-read record — an edited sheet
 * row, a rescheduled meeting, a redelivered webhook — always converges on the
 * source's current truth instead of being silently discarded:
 *
 *  - updatable:   eventType, subject, value, currency, properties, streamHash,
 *                 occurredAt (unless the connector marks it first-seen),
 *                 deletedAt := null (re-seen ⇒ alive),
 *                 syncGeneration := GREATEST(stored, incoming) — a gen-0
 *                 webhook redelivery can never downgrade a poll-managed row.
 *  - insert-only: receivedAt, rawEventId, id, orgId, connectionId, source.
 *
 * Records flagged `deleted` (a source-reported cancellation/deletion) become
 * soft-deletes: on conflict ONLY deletedAt + generation change (the skeleton
 * payload never clobbers stored fields); a never-seen deletion inserts as an
 * invisible tombstone. Identical redeliveries remain no-ops in effect.
 */
export async function upsertEvents(db: DB, meta: EventMeta, canonical: CanonicalEvent[]): Promise<ProcessResult> {
  // Postgres rejects the same conflict target twice in one INSERT — last wins.
  const byId = new Map<string, CanonicalEvent>();
  for (const ev of canonical) byId.set(ev.eventId, ev);
  const unique = [...byId.values()];

  const generation = meta.generation ?? 0;
  const toRow = (ev: CanonicalEvent) => ({
    eventId: ev.eventId,
    orgId: meta.orgId,
    connectionId: meta.connectionId,
    source: meta.source,
    eventType: ev.eventType,
    subject: ev.subject ?? null,
    occurredAt: ev.occurredAt,
    value: ev.value != null ? String(ev.value) : null,
    currency: ev.currency ?? null,
    // Date-looking property values are canonicalized at ingest, so every
    // stored event speaks one date format (raw_events keeps the original).
    properties: normalizeDatesDeep(ev.properties),
    rawEventId: meta.rawEventId ?? null,
    streamHash: meta.streamHash ?? null,
    syncGeneration: generation,
    deletedAt: ev.deleted ? new Date() : null,
  });

  const live = unique.filter((ev) => !ev.deleted);
  const dead = unique.filter((ev) => ev.deleted);
  const genSet = sql`GREATEST(${events.syncGeneration}, excluded.sync_generation)`;

  let inserted = 0;
  let updated = 0;
  const count = (rows: Array<{ isInsert: number }>) => {
    for (const r of rows) {
      if (Number(r.isInsert) === 1) inserted += 1;
      else updated += 1;
    }
  };

  for (let i = 0; i < live.length; i += UPSERT_CHUNK) {
    const chunk = live.slice(i, i + UPSERT_CHUNK).map(toRow);
    const set: Record<string, unknown> = {
      eventType: sql`excluded.event_type`,
      subject: sql`excluded.subject`,
      value: sql`excluded.value`,
      currency: sql`excluded.currency`,
      properties: sql`excluded.properties`,
      streamHash: sql`excluded.stream_hash`,
      syncGeneration: genSet,
      deletedAt: sql`excluded.deleted_at`, // null — re-seen ⇒ alive
    };
    if (!meta.preserveOccurredAt) set.occurredAt = sql`excluded.occurred_at`;
    const rows = await db
      .insert(events)
      .values(chunk)
      .onConflictDoUpdate({ target: events.eventId, set })
      // xmax = 0 ⇔ the row was freshly inserted (not updated) — real Postgres semantics.
      .returning({ isInsert: sql<number>`(xmax = 0)::int` });
    count(rows);
  }

  for (let i = 0; i < dead.length; i += UPSERT_CHUNK) {
    const chunk = dead.slice(i, i + UPSERT_CHUNK).map(toRow);
    const rows = await db
      .insert(events)
      .values(chunk)
      .onConflictDoUpdate({
        target: events.eventId,
        set: { deletedAt: sql`excluded.deleted_at`, syncGeneration: genSet },
      })
      .returning({ isInsert: sql<number>`(xmax = 0)::int` });
    count(rows);
  }

  if (inserted > 0) {
    await db
      .update(connections)
      .set({ lastEventAt: new Date(), updatedAt: new Date() })
      .where(eq(connections.id, meta.connectionId));
  }
  return { inserted, updated, deduped: updated, total: canonical.length };
}

/**
 * Process a single raw event: normalize via its connector, upsert (deduped)
 * into the canonical events table, and record a success in the delivery log.
 * Throws on failure so the durable layer (Inngest) retries with backoff.
 */
export async function processRawEvent(db: DB, rawEventId: string): Promise<ProcessResult> {
  const [raw] = await db.select().from(rawEvents).where(eq(rawEvents.id, rawEventId)).limit(1);
  if (!raw) throw new Error(`raw event ${rawEventId} not found`);

  const connector = getConnector(raw.source);
  if (!connector) throw new Error(`no connector registered for source "${raw.source}"`);

  const canonical = connector.normalize(raw.payload, {
    connectionId: raw.connectionId,
    headers: raw.headers,
  });

  const result = await upsertEvents(
    db,
    { orgId: raw.orgId, connectionId: raw.connectionId, source: raw.source, rawEventId: raw.id },
    canonical,
  );

  await db.insert(deliveryLog).values({
    orgId: raw.orgId,
    connectionId: raw.connectionId,
    rawEventId: raw.id,
    status: "success",
    attempt: 1,
  });

  return result;
}

/**
 * Move an event to the dead-letter queue after retries are exhausted, and flag
 * the connection as errored. Nothing is dropped — the DLQ row is replayable.
 */
export async function deadLetterRawEvent(
  db: DB,
  rawEventId: string,
  attempts: number,
  error: string,
): Promise<void> {
  const [raw] = await db.select().from(rawEvents).where(eq(rawEvents.id, rawEventId)).limit(1);
  if (!raw) return;
  await db.insert(deadLetter).values({
    orgId: raw.orgId,
    connectionId: raw.connectionId,
    rawEventId: raw.id,
    attempts,
    error,
  });
  await db.insert(deliveryLog).values({
    orgId: raw.orgId,
    connectionId: raw.connectionId,
    rawEventId: raw.id,
    status: "failed",
    attempt: attempts,
    error,
  });
  await db
    .update(connections)
    .set({ status: "error", lastError: error, updatedAt: new Date() })
    .where(eq(connections.id, raw.connectionId));
}

/**
 * Re-run processing for a raw event (from the DLQ or the admin UI) and mark any
 * matching dead-letter rows resolved. Safe to call repeatedly — dedup protects
 * the events table. When `orgId` is supplied, the raw event must belong to that
 * organization or the replay is refused (tenant isolation).
 */
export async function replayRawEvent(db: DB, rawEventId: string, orgId?: string): Promise<ProcessResult> {
  if (orgId) {
    const [raw] = await db
      .select({ orgId: rawEvents.orgId })
      .from(rawEvents)
      .where(eq(rawEvents.id, rawEventId))
      .limit(1);
    if (!raw) throw new Error(`raw event ${rawEventId} not found`);
    if (raw.orgId !== orgId) throw new Error("forbidden: cross-tenant replay");
  }
  const result = await processRawEvent(db, rawEventId);
  await db
    .update(deadLetter)
    .set({ resolvedAt: new Date() })
    .where(eq(deadLetter.rawEventId, rawEventId));
  return result;
}
