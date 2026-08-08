-- ============================================================================
-- Close pipeline-field census — paste into the Neon SQL editor.
--
-- The flow builder's Pipeline picker filters opportunity records on
-- properties.data.pipeline_id (see the close entry in
-- src/connectors/catalog.ts). Close's Event Log payload shape is documented
-- nowhere reachable, so this census answers, from YOUR real synced events,
-- whether opportunity events actually carry that field.
--
-- Reading the result:
--   * Query 1: `with_pipeline_id` > 0  → the filter path is right; done.
--   * Query 1: 0 rows at all           → no opportunity events synced yet
--     (create/edit one opportunity in Close, wait a sync, re-run).
--   * Query 1: rows but with_pipeline_id = 0 → send query 2's output — the
--     filter path needs adjusting to whatever key the census shows.
-- ============================================================================

-- 1. Do opportunity events carry pipeline/status in data?
SELECT properties->>'object_type'                                   AS object_type,
       count(*)                                                     AS rows,
       count(*) FILTER (WHERE properties->'data' ? 'pipeline_id')   AS with_pipeline_id,
       count(*) FILTER (WHERE properties->'data' ? 'status_id')     AS with_status_id,
       count(*) FILTER (WHERE properties->'data' ? 'status_label')  AS with_status_label
FROM events
WHERE source = 'close' AND deleted_at IS NULL
  AND properties->>'object_type' = 'opportunity'
GROUP BY 1;

-- 2. Full key census of opportunity events' data payloads.
SELECT jsonb_object_keys(properties->'data') AS data_key, count(*) AS occurrences
FROM events
WHERE source = 'close' AND deleted_at IS NULL
  AND properties->>'object_type' = 'opportunity'
GROUP BY 1 ORDER BY 2 DESC;

-- 3. Sample values — eyeball that pipeline_id is an id and labels look sane.
SELECT properties->'data'->>'pipeline_id'  AS pipeline_id,
       properties->'data'->>'status_label' AS status_label,
       count(*)                            AS rows
FROM events
WHERE source = 'close' AND deleted_at IS NULL
  AND properties->>'object_type' = 'opportunity'
GROUP BY 1, 2 ORDER BY 3 DESC;
