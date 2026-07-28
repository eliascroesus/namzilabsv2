-- ============================================================================
-- READ-ONLY schema audit for namzilabsv2 / Neon.
-- Paste the FIRST query into the Neon SQL Editor and run it. No writes, no DDL.
--
-- GENERATED FROM src/db/schema.ts — do not hand-edit. Regenerate with:
--     pnpm tsx scripts/check-schema-drift.ts --emit-sql
--
-- Reports every table and column the deployed code references as present or
-- missing. Problems sort to the top; 'ok' rows follow, so a clean run is a
-- screen of 'ok' and nothing else.
--
-- It does NOT consult drizzle's migration tracker, on purpose. Every migration
-- here was applied by hand, so the tracker records what drizzle believes rather
-- than what exists. Only the catalog knows.
--
-- A 'MISSING COLUMN' row means code in production is throwing every time it
-- touches that column. That is how migration 0012 (sync_state.sync_lock_until,
-- sync_state.sync_lock_token) went unnoticed: it broke every sync entry point
-- while the test suite stayed green, because the tests build a fresh database
-- from the migration files and never look at this one.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- QUERY 1 — tables and columns (17 tables, 161 columns).
-- This is the one to run. Self-contained; nothing above is needed.
-- ---------------------------------------------------------------------------
WITH expected (tbl, col) AS (
  VALUES
    ('connections', 'id'),
    ('connections', 'org_id'),
    ('connections', 'source'),
    ('connections', 'name'),
    ('connections', 'status'),
    ('connections', 'auth_type'),
    ('connections', 'credentials_encrypted'),
    ('connections', 'signing_secret_encrypted'),
    ('connections', 'config'),
    ('connections', 'last_error'),
    ('connections', 'last_event_at'),
    ('connections', 'sync_status'),
    ('connections', 'sync_generation'),
    ('connections', 'historical_synced_at'),
    ('connections', 'paused_until'),
    ('connections', 'paused_reason'),
    ('connections', 'consecutive_failures'),
    ('connections', 'next_sweep_at'),
    ('connections', 'consecutive_no_op_sweeps'),
    ('connections', 'webhook_healthy_at'),
    ('connections', 'disabled_at'),
    ('connections', 'created_at'),
    ('connections', 'updated_at'),
    ('dead_letter', 'id'),
    ('dead_letter', 'org_id'),
    ('dead_letter', 'connection_id'),
    ('dead_letter', 'raw_event_id'),
    ('dead_letter', 'error'),
    ('dead_letter', 'attempts'),
    ('dead_letter', 'created_at'),
    ('dead_letter', 'resolved_at'),
    ('delivery_log', 'id'),
    ('delivery_log', 'org_id'),
    ('delivery_log', 'connection_id'),
    ('delivery_log', 'raw_event_id'),
    ('delivery_log', 'status'),
    ('delivery_log', 'attempt'),
    ('delivery_log', 'error'),
    ('delivery_log', 'created_at'),
    ('events', 'id'),
    ('events', 'event_id'),
    ('events', 'org_id'),
    ('events', 'connection_id'),
    ('events', 'source'),
    ('events', 'event_type'),
    ('events', 'subject'),
    ('events', 'occurred_at'),
    ('events', 'received_at'),
    ('events', 'value'),
    ('events', 'currency'),
    ('events', 'properties'),
    ('events', 'raw_event_id'),
    ('events', 'identifiers'),
    ('events', 'sync_generation'),
    ('events', 'deleted_at'),
    ('events', 'stream_hash'),
    ('flow_results', 'id'),
    ('flow_results', 'org_id'),
    ('flow_results', 'flow_id'),
    ('flow_results', 'version'),
    ('flow_results', 'output_node_id'),
    ('flow_results', 'tile'),
    ('flow_results', 'status'),
    ('flow_results', 'error'),
    ('flow_results', 'provenance'),
    ('flow_results', 'computed_at'),
    ('flow_results', 'created_at'),
    ('flow_versions', 'id'),
    ('flow_versions', 'flow_id'),
    ('flow_versions', 'org_id'),
    ('flow_versions', 'version'),
    ('flow_versions', 'graph'),
    ('flow_versions', 'published_at'),
    ('flows', 'id'),
    ('flows', 'org_id'),
    ('flows', 'name'),
    ('flows', 'description'),
    ('flows', 'draft_graph'),
    ('flows', 'status'),
    ('flows', 'published_version'),
    ('flows', 'created_at'),
    ('flows', 'updated_at'),
    ('memberships', 'id'),
    ('memberships', 'org_id'),
    ('memberships', 'user_id'),
    ('memberships', 'role'),
    ('memberships', 'created_at'),
    ('metrics', 'id'),
    ('metrics', 'org_id'),
    ('metrics', 'name'),
    ('metrics', 'kind'),
    ('metrics', 'display'),
    ('metrics', 'unit'),
    ('metrics', 'target'),
    ('metrics', 'definition'),
    ('metrics', 'created_at'),
    ('organizations', 'id'),
    ('organizations', 'name'),
    ('organizations', 'created_at'),
    ('raw_events', 'id'),
    ('raw_events', 'org_id'),
    ('raw_events', 'connection_id'),
    ('raw_events', 'source'),
    ('raw_events', 'headers'),
    ('raw_events', 'payload'),
    ('raw_events', 'signature_valid'),
    ('raw_events', 'received_at'),
    ('source_streams', 'id'),
    ('source_streams', 'org_id'),
    ('source_streams', 'connection_id'),
    ('source_streams', 'config_hash'),
    ('source_streams', 'config'),
    ('source_streams', 'cursor'),
    ('source_streams', 'window_floor'),
    ('source_streams', 'status'),
    ('source_streams', 'last_polled_at'),
    ('source_streams', 'last_error'),
    ('source_streams', 'created_at'),
    ('source_streams', 'updated_at'),
    ('stream_fields', 'id'),
    ('stream_fields', 'org_id'),
    ('stream_fields', 'connection_id'),
    ('stream_fields', 'stream_hash'),
    ('stream_fields', 'field_path'),
    ('stream_fields', 'inferred_type'),
    ('stream_fields', 'approx_cardinality'),
    ('stream_fields', 'seen_count'),
    ('stream_fields', 'sample'),
    ('stream_fields', 'first_seen'),
    ('stream_fields', 'last_seen'),
    ('sync_state', 'connection_id'),
    ('sync_state', 'cursor'),
    ('sync_state', 'channel_id'),
    ('sync_state', 'channel_resource_id'),
    ('sync_state', 'channel_expiry'),
    ('sync_state', 'last_polled_at'),
    ('sync_state', 'last_event_at'),
    ('sync_state', 'sync_lock_until'),
    ('sync_state', 'sync_lock_token'),
    ('sync_state', 'updated_at'),
    ('test_runs', 'id'),
    ('test_runs', 'org_id'),
    ('test_runs', 'status'),
    ('test_runs', 'result'),
    ('test_runs', 'error'),
    ('test_runs', 'created_at'),
    ('test_runs', 'updated_at'),
    ('usage_ledger', 'id'),
    ('usage_ledger', 'org_id'),
    ('usage_ledger', 'connection_id'),
    ('usage_ledger', 'provider'),
    ('usage_ledger', 'operation'),
    ('usage_ledger', 'window_start'),
    ('usage_ledger', 'calls'),
    ('usage_ledger', 'throttled'),
    ('usage_ledger', 'errors'),
    ('usage_ledger', 'observed_limit'),
    ('usage_ledger', 'updated_at'),
    ('users', 'id'),
    ('users', 'email'),
    ('users', 'created_at')
),
checked AS (
  SELECT
    e.tbl,
    e.col,
    CASE
      WHEN t.table_name IS NULL THEN 'MISSING TABLE'
      WHEN c.column_name IS NULL THEN 'MISSING COLUMN'
      ELSE 'ok'
    END AS status
  FROM expected e
  LEFT JOIN information_schema.tables t
    ON t.table_schema = 'public' AND t.table_name = e.tbl
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public' AND c.table_name = e.tbl AND c.column_name = e.col
)
SELECT tbl AS "table", col AS "column", status
FROM checked
ORDER BY
  CASE status WHEN 'MISSING TABLE' THEN 0 WHEN 'MISSING COLUMN' THEN 1 ELSE 2 END,
  tbl,
  col;

-- ---------------------------------------------------------------------------
-- QUERY 2 (optional) — indexes (29 expected).
-- A missing index never breaks a query, it only makes it slow, so this is
-- separate and can be ignored while chasing a real outage.
-- ---------------------------------------------------------------------------
WITH expected (tbl, idx) AS (
  VALUES
    ('connections', 'connections_org_idx'),
    ('connections', 'connections_status_idx'),
    ('dead_letter', 'dead_letter_conn_idx'),
    ('delivery_log', 'delivery_log_conn_idx'),
    ('delivery_log', 'delivery_log_status_idx'),
    ('events', 'events_event_id_uq'),
    ('events', 'events_org_type_idx'),
    ('events', 'events_conn_stream_live_idx'),
    ('events', 'events_org_live_occurred_idx'),
    ('events', 'events_conn_gen_live_idx'),
    ('events', 'events_deleted_idx'),
    ('flow_results', 'flow_results_flow_output_uq'),
    ('flow_results', 'flow_results_org_idx'),
    ('flow_versions', 'flow_versions_flow_version_uq'),
    ('flow_versions', 'flow_versions_org_idx'),
    ('flows', 'flows_org_idx'),
    ('memberships', 'memberships_org_user_uq'),
    ('metrics', 'metrics_org_idx'),
    ('raw_events', 'raw_events_conn_idx'),
    ('raw_events', 'raw_events_conn_received_idx'),
    ('source_streams', 'source_streams_conn_cfg_uq'),
    ('source_streams', 'source_streams_org_idx'),
    ('stream_fields', 'stream_fields_key_uq'),
    ('stream_fields', 'stream_fields_org_idx'),
    ('test_runs', 'test_runs_org_idx'),
    ('test_runs', 'test_runs_created_idx'),
    ('usage_ledger', 'usage_ledger_bucket_uq'),
    ('usage_ledger', 'usage_ledger_org_idx'),
    ('usage_ledger', 'usage_ledger_window_idx')
)
SELECT
  e.tbl AS "table",
  e.idx AS "index",
  CASE WHEN i.indexname IS NULL THEN 'MISSING INDEX' ELSE 'ok' END AS status
FROM expected e
LEFT JOIN pg_indexes i ON i.schemaname = 'public' AND i.indexname = e.idx
ORDER BY (i.indexname IS NULL) DESC, e.tbl, e.idx;
