-- ============================================================================
-- What the PROVIDERS say their rate limits are. READ ONLY — no writes, no DDL.
-- Paste into the Neon SQL Editor.
--
-- Why this exists: of the polling connectors, Close alone declares no limit and
-- is governed by a DEFAULT_RPM of 60 that no provider ever published. Close reports its real limit on EVERY response, in
-- an RFC `ratelimit` header; that number used to be parsed and dropped on the
-- floor. It is now kept in `usage_ledger.observed_limit`.
--
-- Run this after roughly a day of production traffic. Anything that appears
-- here is a figure the provider stated about itself, which is a better basis
-- for a catalog budget than anything that can be found by reading docs.
--
-- An EMPTY RESULT is a finding, not a failure: it means no provider we polled
-- sent a rate-limit header in the retained window. Check `samples` before
-- trusting a row — one observation is an anecdote.
-- ============================================================================

SELECT
  provider,
  operation,
  min(observed_limit)                              AS lowest_seen,
  max(observed_limit)                              AS highest_seen,
  mode() WITHIN GROUP (ORDER BY observed_limit)    AS most_common,
  count(*)                                         AS samples,
  count(DISTINCT connection_id)                    AS connections,
  min(window_start)                                AS first_seen,
  max(window_start)                                AS last_seen
FROM usage_ledger
WHERE observed_limit IS NOT NULL
GROUP BY provider, operation
ORDER BY provider, operation;

-- ---------------------------------------------------------------------------
-- Optional: how close we actually came to it. A provider limit means little
-- without knowing whether we ever approach it — if peak usage is 4/min against
-- a stated 120, the declared budget is not what needs attention.
--
-- `calls` counts one minute-window per row, which is the same unit the budget
-- is expressed in, so these are directly comparable.
-- ---------------------------------------------------------------------------
SELECT
  provider,
  operation,
  max(calls)                                  AS peak_calls_per_minute,
  round(avg(calls), 2)                        AS mean_calls_per_minute,
  sum(throttled)                              AS times_we_denied_ourselves,
  sum(errors)                                 AS provider_errors,
  max(observed_limit)                         AS provider_stated_limit
FROM usage_ledger
GROUP BY provider, operation
ORDER BY peak_calls_per_minute DESC;
