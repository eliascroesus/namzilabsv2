import { sql } from "drizzle-orm";
import type { DB } from "@/db/types";
import { RESULT_MAX_AGE_MS } from "@/lib/flow/materialize";

/**
 * WHEN THE SWEEP NEXT HAS SOMETHING TO DO — the earliest moment either
 * ten-minute cron would find work, as epoch milliseconds, or null when nothing
 * anywhere will ever be due without something happening first.
 *
 * ═══ WHY THIS EXISTS ═══
 *
 * `reconcile-connections` and `materialize-stale` both fire every ten minutes
 * and used to query the database every time, whether or not anything was due.
 * Neon bills every minute its compute is awake and only sleeps after five
 * quiet minutes, so those two alone held production awake more than half of
 * every day — with no users at all. That was most of the bill on 25 Sep 2026.
 * The crons now ask THIS first (through a cache, `gate.ts`) and skip the
 * database entirely when the answer is still in the future.
 *
 * ═══ IT MIRRORS THE CRONS' OWN QUERIES, CLAUSE FOR CLAUSE ═══
 *
 * A gate that said "not yet" while a cron WOULD have found work is the one
 * failure that costs accuracy, so each term below is the earliest time one of
 * the crons' real queries starts returning rows — and
 * `tests/sweep-gate.test.ts` checks the two against each other on a real
 * database:
 *
 *   `dueConnectionsForSweep` — an active connection is due once its pause has
 *     lifted AND its `next_sweep_at` has passed (null = due now).
 *   `runnableJobsByProvider` — a queued or running backfill job on a
 *     connection that is not disabled is runnable once the pause lifts.
 *   `expireAgedResults` — a fresh result expires at its own `nextChangeAt`
 *     (when it is a well-formed timestamp) or six hours after it was computed,
 *     whichever is first; an error result retries six hours after its last
 *     attempt.
 *   `materializeStaleAll` — any stale result is due now.
 *
 * ANYTHING ALREADY DUE IS REPORTED AS 0 — "due", on any clock. It used to be
 * clamped to the database's `now()`, which is always a little LATER than the
 * moment the gate read its own clock (the query runs after it), so overdue
 * work compared as "not yet" on every fresh read: the gate answered idle for
 * exactly the ticks that had work, and a steady stream of wakes could keep it
 * doing so. Returning 0 takes the two clocks out of the comparison.
 *
 * The answer is only ever EARLIER than the truth when rows change afterwards,
 * and every writer that can move work earlier clears the cached answer
 * (`wakeSweeper`), so the next cron recomputes it — which is what makes this
 * safe to cache at all.
 */
export async function nextWakeMs(db: DB): Promise<number | null> {
  // The same constant `expireAgedResults` ages against, so the two cannot
  // drift — read here rather than at import, so a test that stubs the
  // materializer without it can still load the crons.
  const maxAge = sql`(${RESULT_MAX_AGE_MS} * interval '1 millisecond')`;
  /*
   * `least` IGNORES NULLS in Postgres, and so would any clamp built from it:
   * `greatest(null, now())` is now(). The CASE keeps "nothing anywhere is due"
   * null rather than turning it into "due this instant" — which would make the
   * gate run every tick and save nothing.
   */
  const rows = await db.execute(sql`
    with w as (
      select least(
        (select min(greatest(coalesce(c.paused_until, '-infinity'::timestamptz), coalesce(c.next_sweep_at, '-infinity'::timestamptz)))
           from connections c
          where c.status = 'active'),
        (select min(coalesce(c.paused_until, '-infinity'::timestamptz))
           from backfill_jobs j
           join connections c on c.id = j.connection_id
          where j.status in ('queued', 'running') and c.status <> 'disabled'),
        (select min(case
             when r.status = 'stale' then '-infinity'::timestamptz
             when r.status = 'fresh' then least(
               case when (r.tile ->> 'nextChangeAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                    then (r.tile ->> 'nextChangeAt')::timestamptz
                    else 'infinity'::timestamptz end,
               r.computed_at + ${maxAge})
             when r.status = 'error' then coalesce(r.computed_at, r.created_at) + ${maxAge}
           end)
           from flow_results r)
      ) as at
    )
    select case when at is null then null
                when at <= now() then 0
                else extract(epoch from at) * 1000 end as next_wake_ms
      from w
  `);
  const list = (Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? []) as Array<{ next_wake_ms: unknown }>;
  const raw = list[0]?.next_wake_ms;
  if (raw == null) return null;
  const ms = Number(raw);
  // 'infinity' (a fresh row that can never expire on either clock) is "never",
  // which is also what `expireAgedResults` would say about it.
  return Number.isFinite(ms) ? ms : null;
}
