-- Stream inventory — READ ONLY. Nothing here writes.
--
-- Answers "what is actually stored, per stream, and how old is it" before and
-- after a Full re-sync. Written for the Neon SQL Editor: paste, run, read.
--
-- Use it when a connector's window changes (Calendly's history window went from
-- 365 days to 30, leaving an older partial import stranded behind the new
-- floor) and you want to see the gap rather than infer it.

-- 1. Every stream of every connection: what it is, and what it holds.
--    `live_rows` counts only rows a flow can still see (deleted_at IS NULL), so
--    a retired import shows as 0 live even though the rows are still on disk.
SELECT
  c.source,
  c.name                                   AS connection,
  s.config_hash,
  s.config,
  s.status,
  s.last_polled_at,
  count(e.id) FILTER (WHERE e.deleted_at IS NULL)     AS live_rows,
  count(e.id) FILTER (WHERE e.deleted_at IS NOT NULL) AS retired_rows,
  min(e.occurred_at) FILTER (WHERE e.deleted_at IS NULL) AS oldest_live,
  max(e.occurred_at) FILTER (WHERE e.deleted_at IS NULL) AS newest_live,
  max(e.sync_generation)                              AS latest_generation
FROM source_streams s
JOIN connections c ON c.id = s.connection_id
LEFT JOIN events e
  ON e.connection_id = s.connection_id
 AND e.stream_hash   = s.config_hash
GROUP BY c.source, c.name, s.config_hash, s.config, s.status, s.last_polled_at
ORDER BY c.source, s.last_polled_at DESC NULLS LAST;

-- 2. Rows a poll wrote that carry NO stream identity (stream_hash IS NULL).
--    These are webhook-captured rows, which are append-only and must never be
--    retired by a stream sweep. If a POLL source shows rows here, they predate
--    stream tagging — see PRE_LAUNCH_CHECKLIST.md section 5.
SELECT c.source, c.name AS connection, count(*) AS untagged_live_rows
FROM events e
JOIN connections c ON c.id = e.connection_id
WHERE e.stream_hash IS NULL AND e.deleted_at IS NULL
GROUP BY c.source, c.name
ORDER BY untagged_live_rows DESC;

-- 3. Where a source's stored history actually starts, by month. A window that
--    was recently narrowed shows as a cluster of old months, then a gap, then
--    the current window.
SELECT
  c.source,
  date_trunc('month', e.occurred_at) AS month,
  count(*)                           AS rows
FROM events e
JOIN connections c ON c.id = e.connection_id
WHERE e.deleted_at IS NULL
GROUP BY c.source, month
ORDER BY c.source, month;
