# Where this project actually is

Plain English, for coming back to this cold. Written 2026-07-31. No commit hash
here on purpose — one written down is wrong by the next commit, and a stale hash
reads as more precise than the date it replaces.

Three other documents go deeper and this one does not repeat them:
`docs/DATA_MODEL.md` (what each connector guarantees and why),
`drizzle/HAND_APPLY.md` (how migrations get applied), `PRE_LAUNCH_CHECKLIST.md`
(the numbered pre-launch items). This file answers "what is switched on right
now, and what am I waiting for".

---

## The one-paragraph version

Everything through batch 8 is on `main` and live. Batch 9 (the custom webhook's
event time) is on `main` too but **inert behind a flag** — it observes and
records, and changes nothing, until `WEBHOOK_EVENT_TIME_LIVE=1`. Batch 5 (the
day-30/day-60 data purge) is **the only unmerged work**, held deliberately on a
branch.

Close's contract is now **verified against the live API**, and that run found
the connector had been sending a date filter Close silently discards — every
request unbounded for the life of the connector, hidden by the provider's own
30-day retention happening to match our intended depth. The legacy row
reconciliation, outstanding since deploy, turned out to be **already resolved by
the 29 July wipe** — so backfills and replays are unblocked. What is left is the
pool-driver rollout, a day of Close traffic to replace the guessed rate limits,
and two contract checks: **Calendly** (live, five load-bearing parameters, never
verified — the highest-value one) then **Instantly**. **Sendblue has been removed** from the
product entirely — connector, catalog entry, scripts and tests.

---

## Every flag and setting, and what flipping it does

### Rollout flags — these are the switches you have lost track of

| Setting | Current value | What it does when set |
|---|---|---|
| `WEBHOOK_EVENT_TIME_LIVE` | **unset (off)** | Off: the nightly scan works out which payload key holds each webhook connection's event time and records the answer, but events keep being dated exactly as before. On: new events use the resolved key, AND the first nightly run restamps every catch-hook connection's stored events. Both halves flip together on purpose — dating new events better while old ones keep the old answer puts two meanings inside one number. **Look before flipping:** paste `scripts/webhook-event-time.sql` into the Neon editor. |
| `DB_DRIVER` | **unset → `http`** | `pool` switches the WRITER to the WebSocket driver: real sessions, so `db.transaction()` and Postgres advisory locks start actually doing something. Until then the stream write-lock runs its body without a lock (harmless — the Inngest concurrency key is still the first-line serializer). Rollout order matters; see checklist item 4. |
| `DB_DRIVER_READ` | **unset → falls back to `DB_DRIVER`** | Set to `pool` FIRST and soak the read-only surfaces before moving the writer. |
| `STORAGE_PRUNE_LIVE` | **unset (inspect)** | Off: the nightly `prune-storage` job reports what it WOULD delete (`[storage-prune-inspect]` log line) and deletes nothing. `1`: the deletes run. Covers `delivery_log`, `test_runs`, the two `usage_ledger` tiers, and `raw_events` — the last ONLY for connections disabled 30+ days; an active connection's raws are never pruned (they feed the pending event-time restamp and Reprocess). Procedure: checklist item 7b. |
| `DB_POOL_MAX` | **unset → 7** | Sockets per container when the pool driver is active. 7 is a FLOOR derived from the code (FIVE concurrent reads in `scanInvariants`, plus a transaction that can park on a lock for 15s, plus a spare) — a smaller pool deadlocks rather than degrades, so a lower value is clamped up. `tests/pool-tuning.test.ts` now measures the fan-out from the source, so the floor cannot silently drift again. Raise it only if the fan-out grows; the lever for staying under Neon's ceiling is container count. Arithmetic in checklist item 4. |

### Provider keys — only needed to run the verification scripts

| Setting | Needed for |
|---|---|
| `CLOSE_API_KEY` | `scripts/verify-close-pagination.ts` (checklist item 1). Store as a repo secret; run via Actions → *Verify providers (read-only)*. |
| `INSTANTLY_API_KEY` | `scripts/verify-instantly.ts` (item 2). A **v2** key — a 401 is the signature of a v1-era one. |
| `INSTANTLY_SKIP_TARGET` / `INSTANTLY_CAMPAIGN` | Records the Instantly skip detector compares (default 60), and a campaign to pin instead of the first. |
| `CALENDLY_API_TOKEN` | `scripts/verify-calendly.ts` (item 1b). A Calendly **Personal Access Token**: Integrations & apps → API & webhooks → Personal Access Tokens. |
| `CLOSE_VERIFY_PAGES` | Walk depth for the Close script. Default 40 pages. |
| `CALENDLY_TOKEN_WAIT` | Seconds CL11 ages a Calendly page_token before retrying it. Default 60; **use `600`** to match base cadence, which is the gap the connector actually reuses a token across. In CI this is the *Calendly CL11* dropdown on the Verify providers Action (60 / 600 / 3600), not a secret. |
| `JOB_TIMEOUT_MINUTES` / `JOB_STARTED_AT` / `VERIFY_RESERVE_SECONDS` | Set by the Verify providers workflow, not by a human. They let `verify-calendly.ts` refuse a CL11 wait that would not finish before the runner's job ceiling, instead of sleeping for an hour and being killed with no report at all. Absent on a laptop = no ceiling = no refusal. |
| `CALENDLY_SKIP_FROM` | How far back Calendly's skip detector reaches. Default `2015-01-01` — the check FAILS rather than passing if the span holds too few events to paginate. |

### Everything else in `.env.example`

`DATABASE_URL`, `DATABASE_MIGRATION_URL`, `ENCRYPTION_KEY`, the Inngest keys, the
WorkOS keys, the Google OAuth keys, `APP_BASE_URL`. All required for the app to
run; none of them are decisions.

### Scheduled work (no switch — these just run)

| Job | When |
|---|---|
| `reconcile-*` — the sync sweep | every 10 min |
| `materialize-stale` — recompute backstop | every 10 min |
| `backfill-dispatch` — historical import lane | every 5 min |
| `prune-storage` — retention + the invariant scan + the webhook event-time scan | 03:17 daily |

Cadence per connection adapts between 10 min and 60 min (`cadence.ts`); a
connection with a healthy webhook widens to the 60-minute backstop.

---

## What is live on `main`

- **Sync core** — one writer (`upsertEvents`), generation model, soft deletes,
  per-stream cursors, per-connection lease, provider budget ledger with a
  breaker.
- **Six connectors** — Calendly, Close, Instantly, Google Sheets,
  Google Calendar, Whop, plus the custom webhook. **Close's incremental window is
  verified against the live API**: it bounds on `date_updated` (the field the
  endpoint filters and sorts on) and dates rows by `date_created` (when the thing
  happened). Those are different fields on purpose — Close consolidates edits
  into one event that keeps its creation date and takes a new update date.
- **Sheets date column** — a sheet dates its rows from a column in the sheet,
  detected automatically by default, and says which column it used. Choosing a
  different one restamps the rows already stored.
- **Backfill lane** — checkpointed historical import, runs automatically for a
  genuinely new non-mirror stream.
- **Retention (half)** — `delivery_log` and `test_runs` pruned at 30 days,
  nightly, 5,000 rows per table per run.
- **Two ways to remove an integration** — *Disconnect* (power icon) stops syncing,
  keeps everything and can be reversed from the Integrations page. *Delete
  permanently* (trash icon) removes the connection and every row belonging to it
  across ten tables, and asks you to type the connection's name first. The typed
  name is enforced by the delete itself, not just the browser.
- **Health checks** — nightly invariant scan (streams that stopped being polled,
  connections failing on a streak, wedged backfills, unresolved dead letters,
  empty mirrors) and a per-sweep mirror row-count check.
- **The connector contract lane** (`tests/connector-contract.test.ts`) — every
  windowed connector is run against a declaration of what it filters on, what it
  advances its cursor on, and whether it depends on the provider's ordering.
  Each declaration is asserted in both directions, so a stale one fails rather
  than rots. It is the CI half of the gate in `docs/CONNECTOR_SPEC_PROPOSAL.md`;
  it proves the code agrees with what we believe, and only the live lane tests
  the belief.
- **Instantly campaign scoping** — `/campaigns/analytics` ignores `campaign_id`
  (verified live: 49 rows filtered, the same 49 unfiltered). The connector now
  selects the row whose own id matches the requested campaign and stores nothing
  if none does, rather than taking `rows[0]` and stamping the requested id over
  it — which on a 52-campaign workspace showed the first campaign's numbers under
  whichever campaign the user picked.
- **Parse-drift observation** — every provider timestamp is checked against both
  date parsers and disagreements log as `[parse-drift]`. Nothing changes as a
  result; it exists to find out whether a provider has ever sent one of the
  shapes the two parsers disagree about.

### Live but inert

- **Webhook event time.** The scan runs nightly and records what each catch-hook
  connection *would* date its events from. The picker on the connection page
  works and stores the answer. None of it affects a single stored timestamp
  until `WEBHOOK_EVENT_TIME_LIVE=1`.

---

## What is held, and why

### `batch5/retention-purge` — the only unmerged branch

Two commits ahead of `main`. **The day-30 and day-60 purge: the only code in
this project that deletes customer data.** Held at your instruction until you
say otherwise.

Three things to know before it moves:

1. It carries **migration 0016** (`connection_archive`). Its snapshot chain
   forks from 0015 and main is now at 0020, so at merge time the migration must
   be **regenerated**, not renumbered — rebase, delete the migration and
   snapshot, re-run `pnpm db:generate`. Renaming the file leaves a journal whose
   entry claims a predecessor that is not 0020, and the next `db:generate` on
   main would try to re-add three columns. Full explanation under 0018 in
   `drizzle/HAND_APPLY.md`.
2. **It is coupled to webhook restamping.** Today nothing prunes `raw_events`
   for an ACTIVE connection, and webhook restamping re-derives event times from
   those payloads. Batch 5 only deletes for connections disabled 30+ days, so
   the coupling holds — but if that policy ever widens to active connections,
   webhook restamping dies with it. Written up in `docs/DATA_MODEL.md`.
3. It has a dry-run script: `scripts/purge-retired-data.ts`.

### Not built, stated rather than hidden

- **Nothing writes a *durable count* of parse-drift.** The log line is the
  signal. A quiet period means no value parsed in it disagreed — it does not
  cover a provider that went quiet, and it cannot be totalled, because these run
  in ephemeral invocations with no shared process. Deliberate: a counter needs a
  table, and a table needs a migration, for a signal that may never fire.
- **Google push notifications (Phase 4b).** `sync_state.channelId` /
  `channelResourceId` / `channelExpiry` exist and nothing reads or writes them.
  Also needs domain verification in Google Cloud, which is a human step.
- **The compiled query engine flag.** Checklist item 8 describes it, and it
  exists in the code (`src/lib/flow/compile/flags.ts`, `ENGINE_COMPILE_TEST`
  for the Test surface then `ENGINE_COMPILE` for materialization) — off by
  default, on this list because the default is the point, not because the
  flag is missing.
- **Client-side error tracking (Sentry et al.) — deferred, on purpose.** At
  invite-only scale the real failure classes are covered without it: Vercel
  function logs (server/route errors), Inngest run history (background
  failures), the DLQ page (payload failures, now visible with a Replay
  button), and the nightly invariant scan (silent ABSENCE of work — the class
  Sentry never sees), which now emails its findings (src/lib/alerts.ts).
  Sentry's unique value is client-side JS capture and cross-request tracing,
  against a real config + bundle cost. Revisit triggers, either one: (a) a
  customer reports a client-side bug Vercel logs cannot reconstruct, or (b)
  tenant count makes log-reading reactive instead of proactive.

---

## What is blocked, and on what

| Blocked | Waiting on |
|---|---|
| **Declaring Close's real rate limit (5b)** | A day of production traffic now that Close is connected (checklist item 7). It falls through to `DEFAULT_RPM = 60` → 42/min (31 background), a guess no provider published. Close returns real `ratelimit` headers on every response and the connector already parses them, so the evidence accumulates on its own — it just has to accumulate. |
| **Calendly's contract check** | The `CALENDLY_API_TOKEN` secret (checklist item 1b). Calendly is the most parameter-dependent connector — its outward scan rests on `sort`, `min_start_time`, `max_start_time`, `status` and `page_token` all working — and the only one never verified live. `scripts/verify-calendly.ts` controls every one of them. **A PASS is not the answer: an ignored parameter is an INFO line, because a provider that accepts and discards one returns 200 and a plausible page.** |
| **Instantly's contract check** | A live key (checklist item 2). Now carries a second question: its `raw_emails` walk sends NO date parameter and stops when a page falls below its floor, so it silently imports **nothing at all** on a log that is not newest-first. `tests/connector-contract.test.ts` pins that dependence; only a live run can say whether the assumption holds. |
| **`DB_DRIVER=pool`** | A read-path soak with `DB_DRIVER_READ=pool` first (checklist item 4 / LAUNCH_DAY D4 → F3). Until then advisory locks and `db.transaction` are inert, which is why one test stands in for lock contention rather than producing it. |
| **The "cursor stopped advancing" invariant** | A column. `sync_state.cursor` holds only the current value and is rewritten every poll, so standing still is unobservable from stored state, and inferring it from `occurred_at` would flag every quiet account. Needs a migration; the CI stranding contract catches the same class meanwhile. Written up in `docs/DATA_MODEL.md`. |

**Sendblue is REMOVED** — the connector, its catalog entry, its verify and
rekey scripts and its tests are deleted. Its contract check (item 3) and its
date-parameter probe no longer exist as work.

### Answered, so nobody re-opens them

- **Close's window bound** — verified live before merge. The bound is on
  `date_updated`; `date_created__gte` was accepted and discarded for the life of
  the connector, confirmed by a control request returning an identical id set.
- **Close checks C4 / C5** — C4 now measures the field Close actually sorts on
  and passes; C5 is informational, because it tests the parameter the connector
  no longer sends.
- **Phase 9 (per-object Close scoping)** — **NO**, on measurements, not deferred.
  Six walks and six cursors to save 70% of volume that costs 6× more per sweep in
  steady state. Numbers above `canonicalType` in `src/connectors/close.ts` and in
  checklist 9c.
- **Legacy row reconciliation (checklist 5).** DONE BY WIPE — the 29 July wipe
  removed every matching row, confirmed by query: zero rows have
  `sync_generation >= 1 AND stream_hash IS NULL` on a stream-scoped source. The
  backfills and replays it gated are unblocked. Re-run the query if the database
  is ever restored from a branch older than 29 July.
- **The Event Log's ordering.** An early script run reported oldest-first; that
  was a bug in the script (one unparseable value made every comparison against
  NaN false), not a fact about Close. It is latest-first **by `date_updated`** —
  and the axis was the half that stayed wrong for months afterwards, because
  every check asked about `date_created`. The connector still assumes no ordering
  anywhere that data depends on it.

---

## How migrations work here

**By hand, in the Neon SQL Editor.** Drizzle's tracker has never matched reality
and is not to be read or repaired. `drizzle/HAND_APPLY.md` has a pasteable block
and a verify query for every migration.

The migrator path (`pnpm db:migrate`, `src/db/migrate.ts`, the *DB Migrate
(production)* workflow) has been **removed entirely** — it maintained a way to
run the tracker this section says never to trust. The workflow's one real
protection, the 0003-disarm assertion, now lives in
`tests/db-migrate-guard.test.ts`, which also pins that the migrator stays gone.

Applied through **0029**; **0030 (`user_profiles`) is missing in production** —
confirmed by the *Schema drift check* Action run on 3 September 2026 at 00:02
UTC (run 33697711483: https://github.com/eliascroesus/namzilabsv2/actions/runs/33697711483),
which checked 23 tables and 228 columns and reported that one gap. The profile
feature that deployed on 31 August is failing in production until the 0030
block in `drizzle/HAND_APPLY.md` is pasted into the Neon SQL Editor and the
Action is re-run to confirm. The rule, every time: paste the block, confirm it
landed (Actions → *Schema drift check*, or paste `scripts/schema-audit.sql`),
**then** deploy the code. Declaring a column in
`schema.ts` is enough to break a deploy on its own — drizzle expands `select()`
to an explicit column list — so a migration commit stays off the deploy branch
until the SQL is applied.

---

## The read-only scripts, for when something looks wrong

| Script | Answers |
|---|---|
| `scripts/schema-audit.sql` | Does the live database match what the code expects? |
| `scripts/stream-inventory.sql` | What is stored per stream, and how old is it? |
| `scripts/webhook-event-time.sql` | What would each webhook connection date its events from? |
| `scripts/observed-limits.sql` | What rate limits have providers actually reported? |
| `scripts/migration-state-diagnostic.sql` | What does the migration tracker think? |

## Log lines worth grepping

`[parse-drift]`, `[mirror-drift]`, `[invariant-scan]`, `[instantly-probe]` — one
grep for `-drift\|-scan\|-probe` covers every "look at this" signal.

---

## Verification bar

`pnpm typecheck && pnpm test && pnpm build && pnpm check:orphans`, all green,
before anything ships. Currently **2,434 tests / 178 files**. Behavioural changes
are sabotage-verified: break the thing, confirm its own test fails and no other.
`check:orphans` fails the build on an exported function no production code
calls — a feature only its own tests call is not shipped.

---

## Update — 3 September 2026

This file (and the rest of the root docs) had drifted to a 14 August snapshot.
What changed since, in the same plain-English register as the rest of this
file:

**The Inngest CEL incident.** Three function configs used JavaScript's `??`
where Inngest evaluates the expression as CEL — a language with no `??`.
Inngest rejects a whole app sync on one function that fails to compile, and
the rejection is total, not partial: only 4 of the app's 12 functions were
registered, for an unknown period measured in weeks. Dead the whole time:
`sync-connection` (so "Sync now" and a new connection's initial history both
did nothing — the ten-minute sweep still picked new connections up
incrementally, which is why data flowed at all), `run-backfill` (no
historical import ever ran), `run-flow-test` (only the editor's fast inline
Test path survived), `reprocess-connection`, and `prune-storage` — which
also took `scanInvariants` down with it, since the invariant scan runs
*inside* `prune-storage`, so the watchdog went dark along with everything it
watches. Fixed 31 August 2026 (`24f2fa1`). **Tiles kept recomputing the
entire time regardless** — `reconcile-one-connection` was one of the four
functions that stayed registered, and it runs `expireAgedResults` and
`materializeStaleAll` inline on every ten-minute sweep, independent of the
functions that had gone dark.

A second door to the same outage closed the same day (`f3e1d8f`): Inngest
also refuses a whole app sync when any function's global `concurrency`
exceeds the account's plan ceiling, and `reconcile-one-connection` (declared
10) and `run-flow-test` (declared 6) both exceeded the plan's ceiling of 5.
Fixed by adding one named constant, `PLAN_MAX_CONCURRENCY = 5` in
`src/inngest/client.ts`. `tests/inngest-expressions.test.ts` now guards both
classes of failure from recurring: the CEL grammar (rejects `??`, `?.`,
`===`, arrows and more, reading every live function's expressions rather
than pinning a literal) and the concurrency ceiling (every global cap stays
at or under `PLAN_MAX_CONCURRENCY`, and never alone — a per-tenant cap must
exist beside it). `tests/inngest-config.test.ts` is the separate, narrower
test that pins each function's exact configuration values — the same kind of
literal-pinning test that faithfully protected the original `?? 0` bug for
months, kept for the functions it does catch regressions in.

**The two ten-and-five-minute crons are one ten-minute cron now.** Neon bills
by the hour its endpoint is awake, autosuspending after 5 idle minutes — and a
5-minute `backfill-dispatch` cron running forever meant the database never got
5 idle minutes to suspend in. Folded into `materialize-stale`'s existing
10-minute tick on 31 August (`77cc82f`); same queries, same events, same
budgets, only the clock changed. The backfill worker (`run-backfill`) now
drains up to 12 slices (about 45 seconds of wall clock) per invocation instead
of one slice per five-minute wake — the loop moved inside the function so a
hundred-slice import no longer takes eight-plus hours of scheduling gaps.
`reconcile-one-connection` also still runs one backfill slice inline per
connection per sweep, unchanged.

**`flow/data.changed` has no emitters left.** Staleness is written directly —
in the same function that ingested the data — by `process-inbound-event`,
`reconcile-one-connection`, replay and reprocess. The event and its handler
stay registered (belt, not a replacement for the braces), but nothing sends
it anymore; this was true before today's fixes too and is restated here only
because `docs/HOW_THE_BACKEND_WORKS.md` used to describe an event hop that
does not exist.

**The compiled engine flags exist** — corrected above, under "Not built,
stated rather than hidden." `ENGINE_COMPILE_TEST` and `ENGINE_COMPILE`
(`src/lib/flow/compile/flags.ts`) are real in the code, both off by default.

**Test suite:** 178 files / 2,434 tests, green — corrected above, under
"Verification bar."

**A sixth connector: Whop** (`src/connectors/whop.ts`). API key + company id;
polls payments (by `updated_after`) and memberships (by `created_after`);
Standard Webhooks signing (`webhook-signature`, `v1`, over `id.ts.body`, a
five-minute replay window); first sync reaches back 90 days. Seven sources
total counting the custom webhook — corrected above, under "What is live on
`main`."

**`scripts/purge-retired-data.ts`** exists only on the unmerged
`batch5/retention-purge` branch — see "What is held, and why" above. That
branch is now 355 commits behind `main` and carries migration 0016, which
must be regenerated (not renumbered) at merge time per the explanation under
0018 in `drizzle/HAND_APPLY.md`.

**Migrations now go through `0030`** — `drizzle/HAND_APPLY.md` has a
pasteable block and a verify query for every one of them. Whether 0021–0030
have actually been pasted into the production database is now known: the
*Schema drift check* Action ran on 3 September 2026 at 00:02 UTC (run
33697711483: https://github.com/eliascroesus/namzilabsv2/actions/runs/33697711483),
checked 23 tables and 228 columns, and reported exactly one gap — the
`user_profiles` table (migration 0030) is **missing in production**. So
0021–0029 are applied and 0030 is not; the profile feature that deployed on 31
August is failing in production until the 0030 block in
`drizzle/HAND_APPLY.md` is pasted into the Neon SQL Editor and the Action is
re-run. (The scheduled run on 2 September at 11:20 UTC had already failed for
the same reason.) Nothing about 0030 has been pasted yet — do not treat this
entry as a fix, only as the diagnosis.
