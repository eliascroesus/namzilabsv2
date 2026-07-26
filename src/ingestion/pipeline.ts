import { eq, sql } from "drizzle-orm";
import { rawEvents, events, deliveryLog, deadLetter, connections } from "@/db/schema";
import type { DB } from "@/db/types";
import type { CanonicalEvent } from "@/connectors/types";
import { getConnector } from "@/connectors/registry";
import { normalizeDatesDeep } from "@/lib/normalize-dates";
import { extractIdentifiers } from "@/lib/identity/normalize";
import { recordFields } from "@/lib/schema-registry/registry";

export type ProcessResult = {
  /** Rows that did not exist before. */
  inserted: number;
  /** Existing rows whose content/generation/tombstone actually changed. */
  updated: number;
  /** Rows left untouched: identical redeliveries and stale (older-generation) pages. */
  deduped: number;
  total: number;
};

type EventMeta = {
  orgId: string;
  connectionId: string;
  source: string;
  rawEventId?: string | null;
  /** Stream (resource) identity for polled events; null for webhook/instant events. */
  streamHash?: string | null;
  /**
   * Sync-generation class of this write. 0 (default) = append-only webhook /
   * instant rows — never touched by generation sweeps. Poll/backfill/re-sync
   * writers pass their generation (>= 1) so full re-syncs can retire rows no
   * longer seen upstream.
   */
  generation?: number;
  /**
   * Keep an existing row's occurred_at on update. For mirror-style sources
   * (sheet rows) occurred_at is synthesized at read time — every sweep would
   * shift it, so the first-seen time is the stable truth. Sources with a real
   * upstream timestamp leave this false so genuine reschedules propagate.
   */
  preserveOccurredAt?: boolean;
};

/** Multi-row VALUES chunk size (~12 params/row, comfortably under limits). */
const UPSERT_CHUNK = 500;

/**
 * THE single writer for the canonical `events` table (docs/DATA_MODEL.md).
 * Chunked multi-row upsert, deduped on the stable `eventId`. On conflict:
 *
 * - a row is updated ONLY when the incoming generation is >= the stored one
 *   (a late/re-delivered older-generation page can neither resurrect a
 *   tombstone, downgrade the generation, nor overwrite newer data) AND
 *   something actually changes (identical redeliveries are no-ops, so sweeps
 *   over unchanged data report `updated: 0` and trigger no recompute);
 * - `sync_generation` only ever ratchets up (GREATEST);
 * - `deleted_at` clears only via that same guarded path — a record re-seen at
 *   the current/newer generation genuinely exists upstream again;
 * - `occurred_at` follows the source unless `preserveOccurredAt` pins it;
 * - `raw_event_id` keeps its first value (provenance of the original ingest).
 */
export async function upsertEvents(db: DB, meta: EventMeta, canonical: CanonicalEvent[]): Promise<ProcessResult> {
  const generation = meta.generation ?? 0;
  let inserted = 0;
  let updated = 0;

  for (let at = 0; at < canonical.length; at += UPSERT_CHUNK) {
    const chunk = canonical.slice(at, at + UPSERT_CHUNK);
    // Last write wins WITHIN a chunk: ON CONFLICT can't touch the same row
    // twice in one statement, so collapse duplicate eventIds first.
    const byId = new Map<string, CanonicalEvent>();
    for (const ev of chunk) byId.set(ev.eventId, ev);
    const rows = [...byId.values()].map((ev) => ({
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
      // A.2: harvested at write time so later identity work needs no re-ingest.
      identifiers: extractIdentifiers({ subject: ev.subject ?? null, properties: ev.properties ?? null }),
      rawEventId: meta.rawEventId ?? null,
      streamHash: meta.streamHash ?? null,
      syncGeneration: generation,
    }));

    const occurredAtSet = meta.preserveOccurredAt ? sql`${events.occurredAt}` : sql`excluded.occurred_at`;
    const occurredAtChanged = meta.preserveOccurredAt
      ? sql`false`
      : sql`${events.occurredAt} is distinct from excluded.occurred_at`;

    const returned = await db
      .insert(events)
      .values(rows)
      .onConflictDoUpdate({
        target: events.eventId,
        set: {
          eventType: sql`excluded.event_type`,
          subject: sql`excluded.subject`,
          occurredAt: occurredAtSet,
          value: sql`excluded.value`,
          currency: sql`excluded.currency`,
          properties: sql`excluded.properties`,
          identifiers: sql`excluded.identifiers`,
          streamHash: sql`excluded.stream_hash`,
          syncGeneration: sql`greatest(${events.syncGeneration}, excluded.sync_generation)`,
          deletedAt: sql`null`,
        },
        setWhere: sql`excluded.sync_generation >= ${events.syncGeneration} and (
          ${events.deletedAt} is not null
          or ${events.syncGeneration} is distinct from greatest(${events.syncGeneration}, excluded.sync_generation)
          or ${events.eventType} is distinct from excluded.event_type
          or ${events.subject} is distinct from excluded.subject
          or ${events.value} is distinct from excluded.value
          or ${events.currency} is distinct from excluded.currency
          or ${events.properties} is distinct from excluded.properties
          or ${events.identifiers} is distinct from excluded.identifiers
          or ${events.streamHash} is distinct from excluded.stream_hash
          or ${occurredAtChanged}
        )`,
      })
      .returning({ id: events.id, freshInsert: sql<boolean>`(xmax = 0)` });

    for (const r of returned) {
      if (r.freshInsert) inserted += 1;
      else updated += 1;
    }
  }

  if (inserted + updated > 0) {
    await db
      .update(connections)
      .set({ lastEventAt: new Date(), updatedAt: new Date() })
      .where(eq(connections.id, meta.connectionId));
    // A.1: record what we wrote so field pickers read an index instead of
    // scanning a sample. Best-effort — the registry is a convenience, and a
    // hiccup here must never fail an ingest.
    try {
      await recordFields(db, { orgId: meta.orgId, connectionId: meta.connectionId, streamHash: meta.streamHash ?? null }, canonical);
    } catch {
      // Registry is rebuildable from the events themselves.
    }
  }
  return { inserted, updated, deduped: canonical.length - inserted - updated, total: canonical.length };
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

  // preserveOccurredAt: connectors fall back to "now" when a payload carries no
  // timestamp, so re-processing the same raw event would drift occurred_at on
  // every redelivery. First write wins; genuine changes still update the row.
  const result = await upsertEvents(
    db,
    { orgId: raw.orgId, connectionId: raw.connectionId, source: raw.source, rawEventId: raw.id, preserveOccurredAt: true },
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
