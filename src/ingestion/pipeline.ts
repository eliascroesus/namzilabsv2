import { eq } from "drizzle-orm";
import { rawEvents, events, deliveryLog, deadLetter, connections } from "@/db/schema";
import type { DB } from "@/db/types";
import type { CanonicalEvent } from "@/connectors/types";
import { getConnector } from "@/connectors/registry";

export type ProcessResult = { inserted: number; deduped: number; total: number };

type EventMeta = {
  orgId: string;
  connectionId: string;
  source: string;
  rawEventId?: string | null;
};

/**
 * Upsert canonical events with dedup on the stable `eventId`. Uses
 * ON CONFLICT DO NOTHING so re-delivery of the same event (at-least-once
 * delivery) is a harmless no-op — this is the idempotency guarantee.
 */
export async function upsertEvents(db: DB, meta: EventMeta, canonical: CanonicalEvent[]): Promise<ProcessResult> {
  let inserted = 0;
  for (const ev of canonical) {
    const rows = await db
      .insert(events)
      .values({
        eventId: ev.eventId,
        orgId: meta.orgId,
        connectionId: meta.connectionId,
        source: meta.source,
        eventType: ev.eventType,
        subject: ev.subject ?? null,
        occurredAt: ev.occurredAt,
        value: ev.value != null ? String(ev.value) : null,
        currency: ev.currency ?? null,
        properties: ev.properties ?? {},
        rawEventId: meta.rawEventId ?? null,
      })
      .onConflictDoNothing({ target: events.eventId })
      .returning({ id: events.id });
    if (rows.length > 0) inserted += 1;
  }
  if (inserted > 0) {
    await db
      .update(connections)
      .set({ lastEventAt: new Date(), updatedAt: new Date() })
      .where(eq(connections.id, meta.connectionId));
  }
  return { inserted, deduped: canonical.length - inserted, total: canonical.length };
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

/** Record a failed-but-will-retry attempt (used per retry by the durable layer). */
export async function recordRetry(
  db: DB,
  raw: { id: string; orgId: string; connectionId: string },
  attempt: number,
  error: string,
): Promise<void> {
  await db.insert(deliveryLog).values({
    orgId: raw.orgId,
    connectionId: raw.connectionId,
    rawEventId: raw.id,
    status: "retry",
    attempt,
    error,
  });
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
 * the events table.
 */
export async function replayRawEvent(db: DB, rawEventId: string): Promise<ProcessResult> {
  const result = await processRawEvent(db, rawEventId);
  await db
    .update(deadLetter)
    .set({ resolvedAt: new Date() })
    .where(eq(deadLetter.rawEventId, rawEventId));
  return result;
}
