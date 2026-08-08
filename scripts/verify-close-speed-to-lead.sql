-- ============================================================================
-- Speed-to-lead readiness census — paste into the Neon SQL editor.
--
-- The "Speed to lead (Close)" template joins a lead's creation to its first
-- outbound call using the Event Log envelope's lead reference
-- (properties.lead_id) and filters calls to data.direction = 'outbound'.
-- Close documents both fields, but documentation is not your account: this
-- census answers, from YOUR synced events, whether the template's defaults
-- are right — and computes the ground-truth number the dashboard tile must
-- match.
--
-- Run all five queries and read them like this:
--   1: lead_id coverage — with_envelope_lead_id should be ~100% on BOTH
--      lead_created and call rows. If it's 0, send the output; the
--      template's matching field needs adjusting.
--   2: direction values — expect 'outbound'/'inbound'. If empty on all
--      rows, see query 4 (admin key) before concluding anything.
--   3: answered/completed counts — all zero means calls happen outside
--      Close's own dialer, so "Call connected" metrics can't be seen
--      (dials still can).
--   4: MUST be > 0. Zero means your Close API key is NOT admin-scoped:
--      Close silently strips event details older than one hour for
--      non-admin keys. Fix: create the key under an admin user, reconnect.
--   5: the ground truth — after building the template, the dashboard tile
--      must agree with this median (same window). If they differ, that is
--      a bug to report, not a rounding story.
-- ============================================================================

-- 1. Does the envelope carry lead_id on both sides of the join?
SELECT event_type,
       count(*)                                                   AS rows,
       count(*) FILTER (WHERE properties ? 'lead_id')             AS with_envelope_lead_id,
       count(*) FILTER (WHERE properties->'data' ? 'lead_id')     AS with_data_lead_id
FROM events
WHERE source = 'close' AND deleted_at IS NULL
  AND event_type IN ('lead_created', 'call_logged', 'call_connected', 'call_completed')
GROUP BY 1 ORDER BY 2 DESC;

-- 2. Direction census on dialed calls.
SELECT properties->'data'->>'direction' AS direction, count(*) AS rows
FROM events
WHERE source = 'close' AND deleted_at IS NULL AND event_type = 'call_logged'
GROUP BY 1 ORDER BY 2 DESC;

-- 3. VoIP visibility: do connect/complete events exist at all?
SELECT event_type, count(*) AS rows
FROM events
WHERE source = 'close' AND deleted_at IS NULL
  AND event_type IN ('call_connected', 'call_completed')
GROUP BY 1;

-- 4. Admin-key check — MUST be > 0.
SELECT count(*) AS older_than_1h_should_be_gt_0
FROM events
WHERE source = 'close' AND deleted_at IS NULL
  AND occurred_at < now() - interval '1 hour';

-- 5. Ground truth: per-lead minutes from lead_created to first outbound
--    call_logged, then the average and median across leads.
WITH leads AS (
  SELECT properties->>'lead_id' AS lead_id, min(occurred_at) AS lead_at
  FROM events
  WHERE source = 'close' AND deleted_at IS NULL AND event_type = 'lead_created'
    AND properties ? 'lead_id'
  GROUP BY 1
),
first_call AS (
  SELECT l.lead_id, l.lead_at, min(e.occurred_at) AS call_at
  FROM leads l
  JOIN events e
    ON e.properties->>'lead_id' = l.lead_id
   AND e.source = 'close' AND e.deleted_at IS NULL
   AND e.event_type = 'call_logged'
   AND e.properties->'data'->>'direction' = 'outbound'
   AND e.occurred_at >= l.lead_at
  GROUP BY 1, 2
)
SELECT count(*)                                                            AS leads_called,
       round(avg(extract(epoch FROM call_at - lead_at) / 60)::numeric, 1)  AS avg_minutes,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM call_at - lead_at) / 60))::numeric, 1)
                                                                           AS median_minutes
FROM first_call;
