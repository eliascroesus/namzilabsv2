-- Webhook event time — READ ONLY. Nothing here writes.
--
-- WHAT EACH CATCH-HOOK CONNECTION WOULD DATE ITS EVENTS FROM, before anything
-- acts on it. This is the gate: the nightly scan records a decision and changes
-- nothing until `WEBHOOK_EVENT_TIME_LIVE=1`, so this query is where you look
-- before flipping it.
--
-- Written for the Neon SQL Editor: paste, run, read. The values come from
-- `connections.config -> 'eventTime'`, written by the `detect-webhook-event-time`
-- step of the nightly `prune-storage` run — so run that at least once first, or
-- `would_use` is null everywhere because nothing has looked yet.
--
-- WHAT TO LOOK FOR, in order of how much it matters:
--
--  1. tier = 'mutation'. A record-CHANGE time, not an event time. It moves when
--     the record is edited, so an event from March re-dates itself to today.
--     Real, sometimes the only thing a payload carries, and never something to
--     accept without deciding to.
--  2. missing > 0. The key is absent from that many stored payloads, which would
--     fall back to delivery time in a restamp. A large number usually means the
--     provider CHANGED their webhook format: the key exists only in recent
--     payloads, and `oldest_with_key` says when it started.
--  3. candidates is not null. Several keys tied inside the winning tier, so
--     nothing was chosen. Pick one.
--  4. would_use is null with events present. Nothing in these payloads holds a
--     usable timestamp; delivery time is the honest answer and stays.

SELECT
  c.name                                                    AS connection,
  c.id                                                      AS connection_id,
  s ->> 'key'                                               AS would_use,
  s ->> 'tier'                                              AS tier,
  (s IS NOT NULL)                                           AS scanned,
  coalesce((cfg ->> 'locked')::boolean, false)              AS answered_by_a_human,
  cfg ->> 'key'                                             AS human_answer,
  (s -> 'coverage' ->> 'total')::int                        AS stored_payloads,
  (s -> 'coverage' ->> 'withKey')::int                      AS payloads_with_key,
  (s -> 'coverage' ->> 'total')::int
    - (s -> 'coverage' ->> 'withKey')::int                  AS missing,
  s -> 'coverage' ->> 'oldestWithKey'                       AS oldest_with_key,
  s ->> 'candidates'                                        AS candidates,
  (s ->> 'dated')::int                                      AS sampled_dated,
  (s ->> 'undated')::int                                    AS sampled_undated,
  s ->> 'at'                                                AS scanned_at
FROM connections c
CROSS JOIN LATERAL (SELECT c.config -> 'eventTime' AS cfg) a
CROSS JOIN LATERAL (SELECT a.cfg -> 'state' AS s) b
WHERE c.source = 'webhook'
  AND c.disabled_at IS NULL
ORDER BY missing DESC NULLS LAST, connection;

-- 2. The payload keys themselves, for a connection whose pick looks wrong.
--    Replace the id. Shows every top-level key and how often it appears, so a
--    format change is visible as a key that stops or starts partway through.
--
-- SELECT k AS payload_key,
--        count(*)                                   AS payloads,
--        min(r.received_at)                         AS first_seen,
--        max(r.received_at)                         AS last_seen
-- FROM raw_events r, LATERAL jsonb_object_keys(r.payload) k
-- WHERE r.connection_id = '00000000-0000-0000-0000-000000000000'
-- GROUP BY k
-- ORDER BY payloads DESC;

-- 3. What a restamp would actually change, for one connection — the before/after
--    without doing it. `occurred_at` as stored, against the key's own value.
--
-- SELECT e.occurred_at                              AS stored_now,
--        r.payload ->> 'created_at'                 AS key_value,
--        r.received_at                              AS delivered_at
-- FROM events e
-- JOIN raw_events r ON r.id = e.raw_event_id
-- WHERE e.connection_id = '00000000-0000-0000-0000-000000000000'
--   AND e.deleted_at IS NULL
-- ORDER BY r.received_at DESC
-- LIMIT 50;
