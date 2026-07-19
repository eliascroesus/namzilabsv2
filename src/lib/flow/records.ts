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
 * without a leading "properties."). Supports nested objects and arrays via
 * dotted segments and numeric indices (e.g. `properties.utm.source` or
 * `properties.items.0.price`) so the data browser can drill into structured
 * payloads from any connector. Flat keys — including keys that literally contain
 * a dot — keep their existing meaning (they are matched first).
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
      const rest = path.startsWith("properties.") ? path.slice("properties.".length) : path;
      const props = rec.properties;
      if (props == null) return undefined;
      // Exact literal key first, preserving keys that contain dots.
      if (Object.prototype.hasOwnProperty.call(props, rest)) return props[rest];
      return walkPath(props, rest);
    }
  }
}

/** Walk a dotted path (with numeric array indices) through nested objects/arrays. */
export function walkPath(root: unknown, dotted: string): unknown {
  let cur: unknown = root;
  for (const seg of dotted.split(".")) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(seg);
      cur = Number.isInteger(idx) ? cur[idx] : undefined;
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

/** Coerce a resolved field into a finite number, or null. */
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}
