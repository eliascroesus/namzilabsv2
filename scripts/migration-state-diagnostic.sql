-- ============================================================================
-- READ-ONLY migration-state diagnostic for namzilabsv2 / Neon.
-- Paste into the Neon SQL Editor. Contains NO writes, NO DDL, NO DML.
-- Every check uses to_regclass / catalog views, so it never errors on a
-- missing table, column or index -- it just reports false.
--
-- !! BEFORE YOU ACT ON THE RESULTS, READ THE WARNING IN SECTION 6. !!
-- The obvious repair (deleting the 0003 row from the tracker) is itself the
-- trigger for total, silent loss of every flow in the database.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1a. Does the drizzle tracker exist, and where?
-- ---------------------------------------------------------------------------
SELECT
  to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS tracker_in_drizzle_schema,
  to_regclass('public.__drizzle_migrations')  IS NOT NULL AS tracker_in_public_schema,
  EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'drizzle') AS drizzle_schema_exists;

-- ---------------------------------------------------------------------------
-- 1b. Full tracker contents.  (Run ONLY if tracker_in_drizzle_schema = true.)
--
-- The `migration` column maps each stored hash back to the file that produced
-- it. drizzle hashes the ENTIRE raw .sql file (sha256 of the UTF-8 bytes,
-- including comments and the --> statement-breakpoint markers). A hash that
-- shows as 'UNKNOWN' means the .sql file was edited after it was applied --
-- which drizzle will never notice, because it never reads the hash back.
-- ---------------------------------------------------------------------------
SELECT
  id,
  created_at,
  CASE WHEN created_at IS NULL THEN NULL
       ELSE to_timestamp(created_at / 1000.0) AT TIME ZONE 'UTC' END AS created_at_utc,
  CASE hash
    WHEN 'd7e87874bd0924b9a56d461ae1ab5a3f0b5b91f07964c03f5ecf5bee85be8dc0' THEN '0000_salty_karen_page'
    WHEN '0e58a801112632a53bcffabc9a8e3bed0973868a0a13036b0741b5f91762be96' THEN '0001_quick_big_bertha'
    WHEN 'ecef4f9c267c0bc312f95e22204d079d775a8c5d6c874e39935e6442afac8f53' THEN '0002_easy_joshua_kane'
    WHEN '2d903d9ed440ad3ce76489a101073f6df3034132ac3d201a415eee67a8e99ba2' THEN '0003_wipe_flows  <-- THE DANGEROUS ONE'
    WHEN '39f21e599d00d29399c8f630c413afc682369b93757396314aee31010ca72f83' THEN '0004_source_streams'
    WHEN '1899b942e43ecd2686895a1ce727c3871563faa132fbe2b6aa6106bc72c86b6f' THEN '0005_workable_titania'
    WHEN 'f694393da00ee27c0bdd4ea0f61615661f0e3c51c5281bbb6c834796812e4cbd' THEN '0006_dashing_ma_gnuci'
    WHEN '05bb5f001a8970d83a8122b99a95577d2b709e450f15d2e819e0617c9d410dbc' THEN '0007_quiet_lyja'
    WHEN '7bd8b4695964096ba126af13f500d28c1ebc2a71733a2f5f8151453d8de81deb' THEN '0008_same_mysterio'
    WHEN 'aa74ed4452f7e8e7ad1b87e4484b83dcfd930e5f1bb0a92574c9fe637fa4ff75' THEN '0009_clear_wendigo'
    WHEN 'fb29db4846f58954c5ff207f1eff519f856988d68956a815f2d94b97748bc1d4' THEN '0010_youthful_spencer_smythe'
    WHEN '54f64f851f85103737cafe8248cd1ee378b27a2277cefafc31e0dda125d44729' THEN '0011_brainy_pepper_potts'
    ELSE 'UNKNOWN (file edited after apply, or hand-written row)'
  END AS migration,
  hash
FROM drizzle.__drizzle_migrations
ORDER BY created_at NULLS FIRST;

-- ---------------------------------------------------------------------------
-- 1c. THE ONE VALUE THAT DECIDES EVERYTHING -- read exactly as drizzle reads it.
--
-- This is drizzle's own query, verbatim from
--   node_modules/drizzle-orm/neon-http/migrator.js
-- It then applies every journal entry whose `when` is STRICTLY GREATER than
-- Number(created_at) of this single row. The `hash` column is never compared.
--
-- DO NOT substitute max(created_at) here. In Postgres, ORDER BY ... DESC
-- implies NULLS FIRST, so a row with a NULL created_at WINS this query --
-- and Number(null) === 0 in JavaScript, which makes EVERY migration eligible.
-- max() ignores NULLs and would report a confidently wrong answer.
-- A hand-written INSERT that omitted created_at produces exactly this row.
-- ---------------------------------------------------------------------------
SELECT id, hash, created_at
FROM drizzle.__drizzle_migrations
ORDER BY created_at DESC
LIMIT 1;

-- 1d. Interpretation of 1c, plus the NULL trap made explicit.
SELECT
  count(*)                                    AS rows_in_tracker,
  count(*) FILTER (WHERE created_at IS NULL)  AS rows_with_null_created_at,
  CASE
    WHEN count(*) = 0 THEN
      'EMPTY TRACKER -> drizzle replays ALL 12 from 0000 -> dies on CREATE TABLE "connections" (42P07). Loud, no data loss.'
    WHEN count(*) FILTER (WHERE created_at IS NULL) > 0 THEN
      'NULL created_at ROW PRESENT -> drizzle picks it, Number(null)=0, ALL 12 replay from 0000 -> dies on CREATE TABLE "connections" (42P07). Loud, no data loss.'
    WHEN max(created_at) >= 1785600000000 THEN
      'HWM >= 0003 stamp -> NOTHING runs. db:migrate prints "Migrations applied." and applies zero statements. 0004-0011 are skipped PERMANENTLY.'
    ELSE
      'HWM < 0003 stamp -> 0003_wipe_flows WILL RE-RUN AND DELETE ALL flows/flow_versions/flow_results. See section 6.'
  END AS what_db_migrate_would_do
FROM drizzle.__drizzle_migrations;

-- ---------------------------------------------------------------------------
-- 2a. Physical evidence: tables. One row, one column per migration's marker.
-- ---------------------------------------------------------------------------
SELECT
  to_regclass('public.connections')       IS NOT NULL AS m0000_connections,
  to_regclass('public.events')            IS NOT NULL AS m0000_events,
  to_regclass('public.metrics')           IS NOT NULL AS m0001_metrics,
  to_regclass('public.flows')             IS NOT NULL AS m0002_flows,
  to_regclass('public.flow_versions')     IS NOT NULL AS m0002_flow_versions,
  to_regclass('public.flow_results')      IS NOT NULL AS m0002_flow_results,
  to_regclass('public.source_streams')    IS NOT NULL AS m0004_source_streams,
  to_regclass('public.webhook_endpoints') IS NULL     AS m0005_webhook_endpoints_dropped,
  to_regclass('public.test_runs')         IS NOT NULL AS m0007_test_runs,
  to_regclass('public.usage_ledger')      IS NOT NULL AS m0008_usage_ledger,
  to_regclass('public.stream_fields')     IS NOT NULL AS m0010_stream_fields;

-- ---------------------------------------------------------------------------
-- 2b. Physical evidence: columns added by ALTER TABLE migrations.
-- ---------------------------------------------------------------------------
SELECT
  bool_or(table_name='connections'  AND column_name='sync_generation')          AS m0002_conn_sync_generation,
  bool_or(table_name='connections'  AND column_name='historical_synced_at')     AS m0002_conn_historical_synced_at,
  bool_or(table_name='events'       AND column_name='sync_generation')          AS m0002_events_sync_generation,
  bool_or(table_name='events'       AND column_name='deleted_at')               AS m0002_events_deleted_at,
  bool_or(table_name='events'       AND column_name='stream_hash')              AS m0004_events_stream_hash,
  bool_or(table_name='connections'  AND column_name='paused_until')             AS m0008_conn_paused_until,
  bool_or(table_name='connections'  AND column_name='paused_reason')            AS m0008_conn_paused_reason,
  bool_or(table_name='connections'  AND column_name='consecutive_failures')     AS m0008_conn_consecutive_failures,
  bool_or(table_name='connections'  AND column_name='next_sweep_at')            AS m0009_conn_next_sweep_at,
  bool_or(table_name='connections'  AND column_name='consecutive_no_op_sweeps') AS m0009_conn_no_op_sweeps,
  bool_or(table_name='connections'  AND column_name='webhook_healthy_at')       AS m0009_conn_webhook_healthy_at,
  bool_or(table_name='events'       AND column_name='identifiers')              AS m0010_events_identifiers,
  bool_or(table_name='flow_results' AND column_name='provenance')               AS m0011_flow_results_provenance
FROM information_schema.columns
WHERE table_schema = 'public';

-- ---------------------------------------------------------------------------
-- 2c. Physical evidence: indexes. 0006 is the only migration that DROPS
-- indexes, so the three "old_*_still_present" flags must be FALSE if it ran.
-- ---------------------------------------------------------------------------
SELECT
  bool_or(indexname='events_occurred_idx')           AS m0006_old_occurred_still_present,
  bool_or(indexname='events_conn_idx')               AS m0006_old_conn_still_present,
  bool_or(indexname='events_conn_stream_idx')        AS m0006_old_conn_stream_still_present,
  bool_or(indexname='events_conn_stream_live_idx')   AS m0006_new_conn_stream_live,
  bool_or(indexname='events_org_live_occurred_idx')  AS m0006_new_org_live_occurred,
  bool_or(indexname='events_conn_gen_live_idx')      AS m0006_new_conn_gen_live,
  bool_or(indexname='source_streams_conn_cfg_uq')    AS m0004_source_streams_uq,
  bool_or(indexname='test_runs_org_idx')             AS m0007_test_runs_org,
  bool_or(indexname='usage_ledger_bucket_uq')        AS m0008_usage_ledger_uq,
  bool_or(indexname='stream_fields_key_uq')          AS m0010_stream_fields_uq
FROM pg_indexes
WHERE schemaname = 'public';

-- ---------------------------------------------------------------------------
-- 6. DATA AT RISK -- and the warning.
--
-- These three counts are exactly what 0003_wipe_flows.sql deletes:
--     DELETE FROM "flow_results"; DELETE FROM "flow_versions"; DELETE FROM "flows";
--
-- 0003 is the ONLY migration made of DML rather than DDL. Every other migration
-- fails loudly on a re-run ("relation already exists"). 0003 SUCCEEDS.
--
-- Its journal timestamp (1785600000000 = 2026-08-01T16:00:00Z) is HIGHER than
-- every other entry, including 0011. So it re-fires in every tracker state
-- EXCEPT one where the stored high-water mark is already >= that value.
--
-- !!! THE OBVIOUS REPAIR IS THE TRIGGER !!!
-- Deleting or nulling 0003's tracker row LOWERS the high-water mark below
-- 1785600000000, which makes 0003 eligible again -- and because every other
-- migration sits below the new mark, 0003 runs ALONE, succeeds, and exits 0.
-- A healthy production database is silently emptied of its entire flow
-- subsystem by a green deploy.
--
-- The safe repair edits drizzle/meta/_journal.json FIRST and ships it, and
-- only THEN touches the tracker row (UPDATE, never DELETE, never to NULL).
-- Do not run pnpm db:migrate until that has been done in that order.
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM flows)         AS flows_at_risk,
  (SELECT count(*) FROM flow_versions) AS flow_versions_at_risk,
  (SELECT count(*) FROM flow_results)  AS flow_results_at_risk;
