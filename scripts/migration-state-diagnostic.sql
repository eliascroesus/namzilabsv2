-- ============================================================================
-- READ-ONLY migration-state diagnostic for namzilabsv2 / Neon.
-- Paste into the Neon SQL Editor. Contains NO writes, NO DDL, NO DML.
-- Every check uses to_regclass / catalog views, so it never errors on a
-- missing table, column or index -- it just reports false.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Q1a. Does the drizzle tracker exist, and where?
-- ---------------------------------------------------------------------------
SELECT
  to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS tracker_in_drizzle_schema,
  to_regclass('public.__drizzle_migrations')  IS NOT NULL AS tracker_in_public_schema,
  EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'drizzle') AS drizzle_schema_exists;

-- ---------------------------------------------------------------------------
-- Q1b. Full tracker contents.  (Run ONLY if tracker_in_drizzle_schema = true.)
-- ---------------------------------------------------------------------------
SELECT
  id,
  hash,
  created_at,
  to_timestamp(created_at / 1000.0) AT TIME ZONE 'UTC' AS created_at_utc
FROM drizzle.__drizzle_migrations
ORDER BY created_at;

-- ---------------------------------------------------------------------------
-- Q1c. THE ONE NUMBER THAT DECIDES EVERYTHING.
-- drizzle reads exactly this (order by created_at desc limit 1) and applies
-- every journal entry whose `when` is strictly greater. Nothing else matters --
-- the hash column is written but never compared.
-- ---------------------------------------------------------------------------
SELECT
  count(*)                                                AS rows_in_tracker,
  max(created_at)                                         AS high_water_mark,
  to_timestamp(max(created_at) / 1000.0) AT TIME ZONE 'UTC' AS high_water_mark_utc
FROM drizzle.__drizzle_migrations;

-- ---------------------------------------------------------------------------
-- Q3a. Physical evidence: tables. One row, one column per migration's marker.
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
-- Q3b. Physical evidence: columns added by ALTER TABLE migrations.
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
-- Q3c. Physical evidence: indexes. 0006 is the only migration that DROPS
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
-- Q4. DATA AT RISK. These three counts are exactly what 0003_wipe_flows.sql
-- deletes. It is pure DML (DELETE FROM), so unlike every other migration it
-- SUCCEEDS on a re-run instead of failing -- and takes these rows with it.
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM flows)         AS flows_at_risk,
  (SELECT count(*) FROM flow_versions) AS flow_versions_at_risk,
  (SELECT count(*) FROM flow_results)  AS flow_results_at_risk;
