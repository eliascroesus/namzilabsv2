import { isEmptyValue } from "@/lib/flow/schema-infer";
import { and, desc, eq, isNull, notInArray, sql } from "drizzle-orm";
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

/**
 * Nesting depth past which an object is recorded as a leaf, not descended.
 *
 * MIRRORS `MAX_DEPTH` IN normalize-dates.ts, and the number matching matters
 * more than the number itself: properties are date-normalized to depth 4 at
 * ingest, so a registry path deeper than that would describe values the
 * normalizer never visits — fields the pickers would offer and the engine
 * would then read un-normalized. It also bounds the walk on pathological
 * payloads: this recursion had NO limit, so a deeply-nested (or cyclic)
 * provider payload produced unbounded dotted paths — and, before the batching
 * below, one database round trip for every one of them.
 */
const MAX_DEPTH = 4;

/** Flatten a record's properties into dotted paths (arrays are leaves). */
function flatten(obj: Record<string, unknown>, prefix = "", out: Map<string, unknown> = new Map(), depth = 1): Map<string, unknown> {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && depth < MAX_DEPTH) flatten(v as Record<string, unknown>, path, out, depth + 1);
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
export async function recordFields(
  db: DB,
  scope: RegistryScope,
  records: CanonicalEvent[],
  opts: {
    /**
     * This batch IS the entire resource — every record it currently holds, not
     * a page or a window. Only a whole-resource read can conclude that a field
     * it did not see no longer exists, so only a whole-resource read may retire
     * one. See the retirement note below.
     */
    wholeResource?: boolean;
  } = {},
): Promise<number> {
  if (records.length === 0) return 0;

  // Aggregate the batch in memory first: one upsert per distinct field, not per
  // field per row.
  const seen = new Map<string, { type: string; distinct: Set<string>; count: number; sample: unknown }>();
  for (const rec of records) {
    for (const [path, value] of flatten(rec.properties ?? {})) {
      const entry = seen.get(path) ?? { type: classify(value), distinct: new Set<string>(), count: 0, sample: value };
      entry.count += 1;
      // A BLANK CELL IS NOT A VALUE. This was `value != null`, so "" counted
      // as one distinct value and a column the account never fills scored
      // cardinality 1 — offered in every picker forever. `String(value)` has
      // the same blind spot for {} and [], which collapse to
      // "[object Object]" and "". One judgement about what a value is, shared
      // with the picker (see schema-infer's isEmptyValue).
      if (!isEmptyValue(value) && entry.distinct.size < CARDINALITY_CEILING) entry.distinct.add(String(value));
      // A non-null type wins over "null" so an occasional empty cell doesn't
      // brand the whole field as null-typed.
      if (entry.type === "null") entry.type = classify(value);
      if (entry.sample == null) entry.sample = value;
      seen.set(path, entry);
    }
  }

  const now = new Date();
  /**
   * ONE multi-row statement per chunk, not one per field. The loop this
   * replaces awaited a separate INSERT … ON CONFLICT per distinct field path
   * — a 60-column sheet was 60 sequential round trips after EVERY page of
   * every poll, on the write path of every connector. Distinct paths within
   * one scope are distinct conflict keys, so a single VALUES list is legal;
   * the per-row numbers move into `excluded.*` so each row still folds with
   * its own counts.
   */
  const FIELD_CHUNK = 500;
  const rows = [...seen.entries()].map(([fieldPath, info]) => ({
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
  }));
  for (let i = 0; i < rows.length; i += FIELD_CHUNK) {
    await db
      .insert(streamFields)
      .values(rows.slice(i, i + FIELD_CHUNK))
      .onConflictDoUpdate({
        target: [streamFields.connectionId, streamFields.streamHash, streamFields.fieldPath],
        set: {
          // Cardinality across batches is a MAX, not a sum: the same values
          // recur every mirror sweep, so summing would inflate without bound.
          approxCardinality: sql`greatest(${streamFields.approxCardinality}, excluded.approx_cardinality)`,
          seenCount: sql`${streamFields.seenCount} + excluded.seen_count`,
          inferredType: sql`case when ${streamFields.inferredType} = 'null' then excluded.inferred_type else ${streamFields.inferredType} end`,
          lastSeen: sql`excluded.last_seen`,
        },
      });
  }

  /**
   * A COLUMN THAT NO LONGER EXISTS STOPS BEING OFFERED.
   *
   * The registry deliberately remembers every field ever seen, because a
   * column that stopped being FILLED is still a real column and a sampled scan
   * would drop it from every picker. But a column that has been REMOVED —
   * renamed at the source, most often — is a different thing, and remembering
   * it forever is what put two of every question in the picker after a Google
   * Form's wording changed: seven abandoned headers sitting beside the seven
   * that replaced them, identical but for a suffix.
   *
   * It is worse than clutter. The mirror rewrites every row with the CURRENT
   * headers, so the old key survives nowhere in the data — but it is still
   * offered, and a metric built on it reads whatever the engine can find,
   * which is nothing.
   *
   * ONLY A WHOLE-RESOURCE READ MAY RETIRE ANYTHING, and that is the whole
   * safety argument. A mirror re-reads its entire tab every sweep, so a header
   * it did not return is genuinely gone. An incremental source returns only
   * what is NEW: Close's `lost_reason` appears solely on lost opportunities, so
   * a quiet afternoon would "prove" it no longer exists and delete a real field
   * from every picker. Hence the flag, set by the two mirror paths and nobody
   * else.
   *
   * Costs one statement on the sweeps that actually wrote something, returns no
   * rows, and is scoped by the same unique index the upsert above uses.
   */
  /**
   * `seen.size > 0` IS LOAD-BEARING, not a tidy-up. An empty path set makes the
   * NOT-IN predicate vacuously true, so a whole-resource read that produced
   * records with no fields at all — a tab whose header row is blank — would
   * delete every registered field for the stream. A DELETE is the one
   * operation where being wrong is unrecoverable, so it does not get to
   * depend on how a query builder renders an empty array.
   */
  if (opts.wholeResource && seen.size > 0) {
    await db.delete(streamFields).where(
      and(
        // The tenant wall, re-asserted. `connection_id` is globally unique so
        // this cannot currently widen the scope — it is here for the same
        // reason the writer's own conflict clause states it: a delete is the
        // one operation where being wrong is unrecoverable, and the predicate
        // should not depend on a uniqueness argument made in another table.
        eq(streamFields.orgId, scope.orgId),
        eq(streamFields.connectionId, scope.connectionId),
        // NULL is a real scope here (connection-scoped sources), and the live
        // unique index is NULLS NOT DISTINCT — so the delete has to match rows
        // the same way the upsert above targets them.
        scope.streamHash == null ? isNull(streamFields.streamHash) : eq(streamFields.streamHash, scope.streamHash),
        notInArray(streamFields.fieldPath, [...seen.keys()]),
      ),
    );
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

/**
 * E.7's dedupe guardrail used to live here, judged from these connection-wide
 * stats — and it could contradict the run receipt rendered directly beneath
 * it ("would collapse 23,262 of 23,420" above "No duplicates found", both
 * about one 402-record step). The collapse warning is now part of the
 * DedupeOutcome receipt itself, measured on the run (`DedupeReport.groups`).
 */
