import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { streamFields } from "@/db/schema";
import type { DB } from "@/db/types";
import type { CanonicalEvent } from "@/connectors/types";

/**
 * A.1 — the field registry.
 *
 * Field pickers used to infer a step's fields by READING a sample of its
 * events on every request (`inferSchema` over a 100-row scan). That cost grows
 * with the table and returns whatever happened to be in the sample. Instead the
 * WRITER records what it wrote: one row per (connection, stream, field path),
 * updated in place, so a picker is an indexed lookup and the answer covers
 * everything ever seen — not a sample.
 *
 * Cardinality is approximate BY DESIGN: an exact distinct-count per field
 * would cost more than the write itself. It is used for guidance (E.7's dedupe
 * warning), never for a number a customer sees.
 */

/** Values above this are treated as "many distinct" and stop being counted. */
const CARDINALITY_CEILING = 1_000;

function classify(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  const s = String(value);
  if (s !== "" && Number.isFinite(Number(s))) return "number";
  if (/^\d{4}-\d{2}-\d{2}([T ]|$)/.test(s)) return "date";
  return "string";
}

/** Flatten a record's properties into dotted paths (arrays are leaves). */
function flatten(obj: Record<string, unknown>, prefix = "", out: Map<string, unknown> = new Map()): Map<string, unknown> {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v as Record<string, unknown>, path, out);
    else out.set(path, v);
  }
  return out;
}

export type RegistryScope = { orgId: string; connectionId: string; streamHash?: string | null };

/**
 * Record the fields present in a batch. Called by the writer after a
 * successful upsert; failures here must never fail an ingest, so callers
 * wrap it defensively.
 */
export async function recordFields(db: DB, scope: RegistryScope, records: CanonicalEvent[]): Promise<number> {
  if (records.length === 0) return 0;

  // Aggregate the batch in memory first: one upsert per distinct field, not per
  // field per row.
  const seen = new Map<string, { type: string; distinct: Set<string>; count: number; sample: unknown }>();
  for (const rec of records) {
    for (const [path, value] of flatten(rec.properties ?? {})) {
      const entry = seen.get(path) ?? { type: classify(value), distinct: new Set<string>(), count: 0, sample: value };
      entry.count += 1;
      if (value != null && entry.distinct.size < CARDINALITY_CEILING) entry.distinct.add(String(value));
      // A non-null type wins over "null" so an occasional empty cell doesn't
      // brand the whole field as null-typed.
      if (entry.type === "null") entry.type = classify(value);
      if (entry.sample == null) entry.sample = value;
      seen.set(path, entry);
    }
  }

  const now = new Date();
  for (const [fieldPath, info] of seen) {
    await db
      .insert(streamFields)
      .values({
        orgId: scope.orgId,
        connectionId: scope.connectionId,
        streamHash: scope.streamHash ?? null,
        fieldPath,
        inferredType: info.type,
        approxCardinality: info.distinct.size,
        seenCount: info.count,
        sample: { value: info.sample ?? null },
        firstSeen: now,
        lastSeen: now,
      })
      .onConflictDoUpdate({
        target: [streamFields.connectionId, streamFields.streamHash, streamFields.fieldPath],
        set: {
          // Cardinality across batches is a MAX, not a sum: the same values
          // recur every mirror sweep, so summing would inflate without bound.
          approxCardinality: sql`greatest(${streamFields.approxCardinality}, ${info.distinct.size})`,
          seenCount: sql`${streamFields.seenCount} + ${info.count}`,
          inferredType: sql`case when ${streamFields.inferredType} = 'null' then ${info.type} else ${streamFields.inferredType} end`,
          lastSeen: now,
        },
      });
  }
  return seen.size;
}

export type RegisteredField = { fieldPath: string; inferredType: string; approxCardinality: number; seenCount: number; sample: unknown };

/** The registered fields for a scope, most-populated first. */
export async function listRegisteredFields(db: DB, scope: RegistryScope): Promise<RegisteredField[]> {
  const rows = await db
    .select({
      fieldPath: streamFields.fieldPath,
      inferredType: streamFields.inferredType,
      approxCardinality: streamFields.approxCardinality,
      seenCount: streamFields.seenCount,
      sample: streamFields.sample,
    })
    .from(streamFields)
    .where(
      and(
        eq(streamFields.orgId, scope.orgId),
        eq(streamFields.connectionId, scope.connectionId),
        scope.streamHash ? eq(streamFields.streamHash, scope.streamHash) : isNull(streamFields.streamHash),
      ),
    )
    .orderBy(desc(streamFields.seenCount));
  return rows;
}

export type DedupeWarning = { field: string; approxCardinality: number; seenCount: number; message: string };

/**
 * E.7 — the dedupe guardrail.
 *
 * "Match duplicates by <field>" collapses every record sharing a value. If the
 * chosen field has few distinct values relative to the record count (a status,
 * a channel, a blank column), that silently throws away most of the data and
 * the resulting number looks plausible. This turns that into a warning BEFORE
 * the number is trusted.
 */
export async function dedupeWarningFor(db: DB, scope: RegistryScope, field: string): Promise<DedupeWarning | null> {
  const fields = await listRegisteredFields(db, scope);
  const match = fields.find((f) => f.fieldPath === field || `properties.${f.fieldPath}` === field);
  if (!match || match.seenCount === 0) return null;
  // Fewer than one distinct value per 5 records is a strong smell; a
  // genuinely-unique key (email, id) sits at ~1 distinct per record.
  const ratio = match.approxCardinality / match.seenCount;
  if (ratio >= 0.2 || match.approxCardinality >= CARDINALITY_CEILING) return null;
  const collapsed = match.seenCount - match.approxCardinality;
  return {
    field,
    approxCardinality: match.approxCardinality,
    seenCount: match.seenCount,
    message: `Matching duplicates by "${field}" would collapse about ${collapsed} of ${match.seenCount} records — it only has ~${match.approxCardinality} distinct values. Pick a field that identifies one record (an email or an id).`,
  };
}
