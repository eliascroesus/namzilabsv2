-- ============================================================================
-- FULL DATA RESET — paste into the Neon SQL editor.
--
-- Deletes EVERY ROW in EVERY app table, for ALL workspaces: connections,
-- flows, dashboards, synced events, raw payloads, sync bookmarks, rate-limit
-- ledger, import jobs — everything. The empty tables, their indexes and the
-- schema all stay exactly as they are (the drift check still passes, no
-- migrations need re-applying).
--
-- What it does NOT touch:
--   * Logins / accounts / workspaces — those live in WorkOS, not this
--     database. Everyone can still sign in; they just see a fresh app.
--   * The schema. This is a data wipe, not a rebuild.
--
-- THERE IS NO UNDO. Run this only to reset a pre-launch database.
--
-- Safe to run while the app is deployed: background jobs find empty tables
-- and do nothing. If a sync happened to be mid-flight, one or two stray rows
-- can land just after the wipe — running this again clears them.
--
-- Afterwards: reconnect sources in the UI. Webhooks re-register, history
-- re-imports, streams and cursors rebuild themselves. Old inbound webhook
-- URLs die with their connections (each URL contains the connection's id),
-- so anything you pointed at a Custom Webhook URL must be pointed at the
-- new one.
--
-- The table list is every pgTable in src/db/schema.ts. If a migration adds
-- a table, add it here too.
-- ============================================================================

TRUNCATE TABLE
  connections,
  raw_events,
  events,
  source_streams,
  sync_state,
  stream_fields,
  backfill_jobs,
  usage_ledger,
  delivery_log,
  dead_letter,
  metrics,
  flows,
  flow_versions,
  flow_results,
  test_runs
RESTART IDENTITY CASCADE;

-- ---------------------------------------------------------------------------
-- Verify: every row of this result must show 0.
-- ---------------------------------------------------------------------------
SELECT 'connections'    AS table_name, count(*) AS rows_left FROM connections
UNION ALL SELECT 'raw_events',     count(*) FROM raw_events
UNION ALL SELECT 'events',         count(*) FROM events
UNION ALL SELECT 'source_streams', count(*) FROM source_streams
UNION ALL SELECT 'sync_state',     count(*) FROM sync_state
UNION ALL SELECT 'stream_fields',  count(*) FROM stream_fields
UNION ALL SELECT 'backfill_jobs',  count(*) FROM backfill_jobs
UNION ALL SELECT 'usage_ledger',   count(*) FROM usage_ledger
UNION ALL SELECT 'delivery_log',   count(*) FROM delivery_log
UNION ALL SELECT 'dead_letter',    count(*) FROM dead_letter
UNION ALL SELECT 'metrics',        count(*) FROM metrics
UNION ALL SELECT 'flows',          count(*) FROM flows
UNION ALL SELECT 'flow_versions',  count(*) FROM flow_versions
UNION ALL SELECT 'flow_results',   count(*) FROM flow_results
UNION ALL SELECT 'test_runs',      count(*) FROM test_runs
ORDER BY table_name;
