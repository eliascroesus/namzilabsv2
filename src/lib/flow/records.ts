import type { events } from "@/db/schema";

/** A canonical event flattened into the record shape the engine operates on. */
export type FlowRecord = {
  id: string;
  source: string;
  eventType: string;
  subject: string | null;
  occurredAt: string; // ISO
  value: number | null;
  currency: string | null;
  connectionId: string;
  properties: Record<string, unknown>;
};

type EventRow = typeof events.$inferSelect;

export function eventToRecord(row: EventRow): FlowRecord {
  return {
    id: row.id,
    source: row.source,
    eventType: row.eventType,
    subject: row.subject ?? null,
    occurredAt: (row.occurredAt instanceof Date ? row.occurredAt : new Date(row.occurredAt)).toISOString(),
    value: row.value != null ? Number(row.value) : null,
    currency: row.currency ?? null,
    connectionId: row.connectionId,
    properties: (row.properties as Record<string, unknown>) ?? {},
  };
}

/** Standard (non-property) fields, in picker order. */
export const STANDARD_FIELDS = ["subject", "source", "eventType", "value", "currency", "occurredAt", "id"] as const;

/**
 * Resolve a field path against a record. Reuses the metric convention:
 * standard columns by name, everything else read from `properties` (with or
 * without a leading "properties.").
 */
export function getField(rec: FlowRecord, path: string): unknown {
  switch (path) {
    case "subject":
      return rec.subject;
    case "source":
      return rec.source;
    case "eventType":
      return rec.eventType;
    case "value":
      return rec.value;
    case "currency":
      return rec.currency;
    case "occurredAt":
      return rec.occurredAt;
    case "id":
      return rec.id;
    default: {
      const key = path.startsWith("properties.") ? path.slice("properties.".length) : path;
      return rec.properties?.[key];
    }
  }
}

/** Coerce a resolved field into a finite number, or null. */
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}
