-- 0021 — stream_fields: collapse null-hash duplicates, then make the
-- uniqueness treat NULL stream_hash as equal (NULLS NOT DISTINCT, PG15+).
--
-- HAND-WRITTEN, not generated: drizzle-orm 0.45 can only express
-- NULLS NOT DISTINCT on table constraints, not on uniqueIndex(), and
-- drizzle-kit's snapshot has no field for it either way — so schema.ts keeps
-- the uniqueIndex declaration (same name, same columns) and THIS FILE is the
-- truth about null handling. drizzle-kit cannot see the difference, so no
-- later db:generate can emit a spurious "correction".
--
-- WHY: stream_hash is NULL for connection-scoped sources, and a default
-- unique index treats NULLs as distinct — recordFields' ON CONFLICT never
-- fired for those scopes, so every batch inserted a fresh row per field path.
-- Unbounded duplicate rows on the write path of every poll, inflated field
-- lists, and a dedupe warning computed off one fragment of the counts.
--
-- The merge below folds duplicates exactly the way the writer folds batches
-- (registry.ts recordFields ON CONFLICT set): seen_count sums,
-- approx_cardinality takes the max, first_seen the min, last_seen the max,
-- inferred_type keeps the first non-'null' (the sticky-type rule), and the
-- KEEPER is the earliest-inserted row — whose insert-only sample is the one
-- the writer would have preserved. Dedupe MUST precede the index swap: the
-- new index cannot build over the duplicates it exists to prevent.
WITH dupes AS (
  SELECT
    connection_id,
    field_path,
    min(first_seen) AS first_seen,
    max(last_seen) AS last_seen,
    sum(seen_count)::int AS seen_count,
    max(approx_cardinality) AS approx_cardinality,
    (array_agg(inferred_type ORDER BY (inferred_type = 'null'), first_seen, id))[1] AS inferred_type,
    (array_agg(id ORDER BY first_seen, id))[1] AS keep_id
  FROM "stream_fields"
  WHERE stream_hash IS NULL
  GROUP BY connection_id, field_path
  HAVING count(*) > 1
)
UPDATE "stream_fields" sf
SET
  seen_count = d.seen_count,
  approx_cardinality = d.approx_cardinality,
  first_seen = d.first_seen,
  last_seen = d.last_seen,
  inferred_type = d.inferred_type
FROM dupes d
WHERE sf.id = d.keep_id;--> statement-breakpoint
WITH dupes AS (
  SELECT
    connection_id,
    field_path,
    (array_agg(id ORDER BY first_seen, id))[1] AS keep_id
  FROM "stream_fields"
  WHERE stream_hash IS NULL
  GROUP BY connection_id, field_path
  HAVING count(*) > 1
)
DELETE FROM "stream_fields" sf
USING dupes d
WHERE sf.stream_hash IS NULL
  AND sf.connection_id = d.connection_id
  AND sf.field_path = d.field_path
  AND sf.id <> d.keep_id;--> statement-breakpoint
DROP INDEX "stream_fields_key_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "stream_fields_key_uq" ON "stream_fields" USING btree ("connection_id","stream_hash","field_path") NULLS NOT DISTINCT;
