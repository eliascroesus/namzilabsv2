# Launch day — one-sitting run sheet

> **STATUS (updated after the Instantly/hardening phase).**
> **Phases A–C are DONE.** The tracker was repaired, migrations `0005`–`0011`
> applied (verified: 12 tracker rows, high-water mark `1785004537576`, flow
> counts unchanged at 1 / 2 / 1), and the branch merged.
>
> **Everything since has been code-only — no new migration.** The schema is
> still at `0011`; `drizzle/` holds 12 files and the journal 12 entries. So
> **there is no database sequence left to run.** Deploy is just merge → Vercel
> build, which has already happened for every increment.
>
> **What remains: Phase D onward.** Start at **D1**.

The complete sequence, in exact execution order, for doing the whole launch in
one go. Every step says what to click, what to paste, what PASS looks like in
plain language, and what to do on FAIL.

`PRE_LAUNCH_CHECKLIST.md` remains the reference document — it explains *why*
each step exists. This file is the running order.

**Nothing here needs a terminal.** Every step is a browser action: Neon Console,
Neon SQL Editor, a GitHub Actions button, a Vercel setting, the app itself, or a
GitHub merge.

## 🛑 Hard stops

Six steps end with **🛑 REPORT TO CLAUDE**. At those points, paste the result
into the conversation and wait before continuing. They are the places where the
next action depends on what the last one actually returned, and where guessing
wrong is expensive or irreversible.

| | Step | Why it stops here |
|---|---|---|
| 🛑 | **A2** provider verification | A failure changes what ships |
| 🛑 | **B2** tracker baseline | The exact row set decides what B3 applies — this is the critical one |
| 🛑 | **B3** apply migrations | Non-transactional; a partial failure needs diagnosis, never a blind retry |
| 🛑 | **B4** schema verification | Last chance to confirm before code goes out |
| 🛑 | **D1** reconciliation *inspect* | Review the blast radius before writing |
| 🛑 | **F2** pool driver verification | Gates the writer flip a week later |

## The one ordering rule that matters

> **Migrations go in BEFORE the code that needs them.**
> Step **B3** (apply `0005`–`0011`) runs **before** step **C1** (merge/deploy).

All seven pending migrations are additive from the old code's point of view, so
a schema that is briefly ahead of the deployed code is safe. The reverse is not:
new code against an old schema throws `column does not exist` on live traffic.

> **B2–B4 SUPERSEDED (2026-08-07).** The schema was applied **by hand** through
> migration 0020 per `drizzle/HAND_APPLY.md` and verified by a green *Schema
> drift check* run. The migrator path (`pnpm db:migrate`, the *DB Migrate
> (production)* Action) has been **removed from the repo** — B3's mechanism no
> longer exists, and the tracker B2 baselines is now a historical artifact
> nothing reads. The 0003 protections live in `tests/db-migrate-guard.test.ts`
> (CI, every push). B2–B4 are kept below as the record of the launch plan that
> events overtook; the live procedure for any FUTURE migration is:
> HAND_APPLY.md block → Neon SQL Editor → *Schema drift check* green → deploy.

---

# Phase A — Pre-flight

*No database, no deploy. Fully reversible. Do this first because a provider
failure changes what you ship.*

## A1. Confirm the repository secrets exist ✅ DONE / optional

GitHub → repo → **Settings → Secrets and variables → Actions**. You should have:

| Secret | Used by | Needed for |
|---|---|---|
| `DATABASE_MIGRATION_URL` | B3, D1/D2, F2 | the direct (non-pooled) Neon URL |
| `CLOSE_API_KEY` | A2 | Close → Settings → Developer → API Keys |
| `INSTANTLY_API_KEY` | A2 | Instantly → Settings → Integrations → API (**v2** key) |
| `SENDBLUE_API_KEY_ID` | A2 | Sendblue dashboard → API settings |
| `SENDBLUE_API_SECRET` | A2 | same place |

**PASS:** all five are listed. **FAIL:** add whichever are missing. A missing
provider key is not a blocker — A2 skips that provider with a clear message —
but `DATABASE_MIGRATION_URL` is required and everything from B3 on depends on it.

## A2. Verify the provider contracts 🛑 — OPTIONAL, run in-app instead

> You chose to test connections in the app after launch rather than wiring
> provider secrets into CI. The **Verify providers** Action stays available if
> you'd rather confirm a contract without touching the app; it skips cleanly
> for any secret that isn't set.

**Do:** Actions → **Verify providers (read-only)** → *Run workflow* → providers
= **all** → Run.

Read-only: GETs against Close, Instantly and Sendblue. No database, no writes,
no deploy. Safe to re-run.

**PASS:** the run summary shows a table with ✅ PASS for every provider whose
secret is set. Anything skipped says exactly which secret was missing.

**FAIL:** the summary names the provider and the failing check.
- Close C1–C5 → the Event Log pagination shape differs; `src/connectors/close.ts`
  needs updating before that connector ships.
- Instantly 401 → the stored key is invalid or v1-era (v1 stopped working
  Jan 19 2026). Create a v2 key, update the secret, re-run.
- Sendblue S1 → the host is wrong; the script says which host *did* answer, and
  `API_BASE` in `src/connectors/sendblue.ts` gets that value.
- Sendblue 401/403 → the auth header names differ from
  `sb-api-key-id`/`sb-api-secret-key`.

A provider failing here does **not** block launch — it blocks *that connector*.
The rest of the sequence continues unchanged.

> 🛑 **REPORT TO CLAUDE** — paste the summary table. A failure may mean shipping
> with that connector disabled, which is a decision, not a fix.

---

# Phase B — Database repair ✅ COMPLETE

*Kept for the record. All four steps ran and verified; nothing here to repeat.*

## B1. Snapshot the database

**Do:** Neon Console → your project → **Branches** → **Create branch**.
Source `production`, **At current time**. Name it
`pre-migration-baseline-<today>`.

This is the restore point for everything that follows. Nothing before this step
has touched the database.

**PASS:** the branch appears in the list. Open its SQL Editor and confirm it
reports the same counts as production:

```sql
SELECT (SELECT count(*) FROM flows)         AS flows,
       (SELECT count(*) FROM flow_versions) AS flow_versions,
       (SELECT count(*) FROM flow_results)  AS flow_results;
```

Expect **1 / 2 / 1**.

**FAIL:** if the branch will not create, stop. Do not proceed to B2 without a
snapshot.

Keep this branch until Phase D is complete and the app has been exercised.

## B2. Baseline the migration tracker — ✅ SUPERSEDED, see the banner above 🛑

**Do:** Neon **SQL Editor**, against **production** (not the branch). Paste and
run:

```sql
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT v.hash, v.created_at
FROM (VALUES
  ('d7e87874bd0924b9a56d461ae1ab5a3f0b5b91f07964c03f5ecf5bee85be8dc0', 1784203484509::bigint), -- 0000_salty_karen_page
  ('0e58a801112632a53bcffabc9a8e3bed0973868a0a13036b0741b5f91762be96', 1784250722039::bigint), -- 0001_quick_big_bertha
  ('ecef4f9c267c0bc312f95e22204d079d775a8c5d6c874e39935e6442afac8f53', 1784305785818::bigint), -- 0002_easy_joshua_kane
  ('f152771ebbfaa216bef6a5930d857e78303e904aa45c5c47a44c252d5bd70667', 1784400000000::bigint), -- 0003_wipe_flows (DISARMED)
  ('39f21e599d00d29399c8f630c413afc682369b93757396314aee31010ca72f83', 1784588933782::bigint)  -- 0004_source_streams
) AS v(hash, created_at)
WHERE NOT EXISTS (
  SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.hash = v.hash
);
```

This records what is already physically in the database, **without re-running
any of its SQL**. It touches only `drizzle.__drizzle_migrations` — no
application table is read or written. It is idempotent: running it twice inserts
nothing the second time.

Then run the verification:

```sql
SELECT id, hash, created_at,
       to_timestamp(created_at/1000.0) AT TIME ZONE 'UTC' AS created_at_utc
FROM drizzle.__drizzle_migrations ORDER BY created_at;

SELECT (SELECT count(*) FROM flows)         AS flows,
       (SELECT count(*) FROM flow_versions) AS flow_versions,
       (SELECT count(*) FROM flow_results)  AS flow_results;
```

**PASS:** `INSERT 0 5`; five rows back, the largest `created_at` being
`1784588933782`; and the counts still **1 / 2 / 1**.

**FAIL:**
- `INSERT 0 0` on the first run → rows already existed. Do not assume that is
  fine; report the `SELECT` output.
- Any other row count, or flow counts that changed → **stop immediately** and
  report. Do not run B3.

> 🛑 **REPORT TO CLAUDE** — paste both query results. B3 applies migrations based
> on exactly these rows; if the high-water mark is not `1784588933782`, B3 will
> do the wrong thing.

## B3. Apply migrations 0005–0011 — ✅ SUPERSEDED (applied by hand; the Action no longer exists) 🛑

**Do (historical):** Actions → **DB Migrate (production)** → *Run workflow* → **select the
feature branch** (`claude/namzila-codebase-analysis-5te76k`), not `main` → Run.

**Selecting the branch matters.** `main` still has the pre-repair journal in
which `0003_wipe_flows` is armed; running from `main` after B2 would make it the
one eligible migration and it would delete every flow. The workflow guard blocks
that — it fails before installing anything — but select the right branch.

This applies exactly seven migrations: `0005`, `0006`, `0007`, `0008`, `0009`,
`0010`, `0011`. `0003` is **not** among them.

**PASS:** the run is green and the log ends with `Migrations applied.`

**FAIL — do NOT re-run the workflow.** The migration runner is not transactional
and writes all its bookkeeping only at the end, so a failure partway through
leaves earlier migrations committed with **zero** rows recorded. A blind retry
replays them and fails on the first one that already landed.

Instead: go to B4, run the diagnostic, and report what it says. The recovery is
to extend the B2 baseline with whatever actually landed, then run again.

If the guard step fails with *"journal still carries the armed 0003 stamp"*, you
selected `main`. Re-run with the feature branch.

> 🛑 **REPORT TO CLAUDE** — say whether it went green, and paste the last ~20
> lines of the log either way.

## B4. Verify the schema — live verification is now the *Schema drift check* Action (green ✅); the diagnostic below remains for forensics 🛑

**Do:** Neon SQL Editor → paste the whole of
[`scripts/migration-state-diagnostic.sql`](scripts/migration-state-diagnostic.sql)
and run it.

**PASS, all of these together:**

| Check | Expected |
|---|---|
| `rows_in_tracker` | **12** |
| every `m00xx_*` table/column marker | `true` |
| `m0005_webhook_endpoints_dropped` | `true` |
| all three `m0006_old_*_still_present` | **`false`** |
| `flows / flow_versions / flow_results` | **1 / 2 / 1** |
| the `0003` row's `migration` label | `0003_wipe_flows (DISARMED — no-op)` |

**FAIL:** any marker still `false`, or flow counts that changed. Stop and report.
The B1 snapshot is the way back.

> 🛑 **REPORT TO CLAUDE** — paste all six result sets. This is the last checkpoint
> before code goes to production.

---

# Phase C — Deploy ✅ COMPLETE (and repeats automatically on every push to main)

## C1. Merge

**Do:** merge the feature branch into `main` (PR or direct, your preference).

After this, `main` carries the repaired journal and the disarmed `0003`, so
future migration runs can be dispatched from `main` normally.

**PASS:** the merge completes and Vercel starts a deployment.

## C2. Confirm the deployment

**Do:** Vercel → the project → **Deployments**. Wait for the build from `main`.

**PASS:** build succeeds, deployment is Ready, the app loads.

**FAIL:** read the build log. A build failure here is a code problem, not a
database one — the schema is already correct and safe to leave as-is while you
fix forward.

---

# Phase D — Post-deploy ← **START HERE**

## D1. Legacy row reconciliation — inspect 🛑

**Do:** Actions → **Legacy row reconciliation** → *Run workflow* → mode
**inspect** (the default) → Run.

**Inspect writes nothing.** It reports the pre-unified-writer "ghost" rows —
rows on stream-scoped connections with a sync generation but no stream identity,
which no sweep can reach because every sweep is now stream-scoped.

**PASS:** green, with a per-connection breakdown in the run summary.
`Nothing to do` is also a pass — it means there are no ghost rows, which is
normal for a young database.

**FAIL:** *"Could not run"* means `DATABASE_MIGRATION_URL` is missing or
unreachable.

> 🛑 **REPORT TO CLAUDE** — paste the breakdown. Counts far larger than expected
> mean something else is going on and apply should wait.

## D2. Legacy row reconciliation — apply

*Skip entirely if D1 said `Nothing to do`.*

**Do:** the same workflow → mode **apply** → Run.

**PASS:** `PASS — every legacy ghost row is retired. Backfills and replays are
now unblocked.`

**FAIL:** *"Rows remain"* → just run it again with **apply**. The script is
idempotent and batched, so re-running or resuming is always safe and never
double-deletes. Rows are soft-deleted only, so nothing is lost.

## D3. Post-deploy sanity pass

**Do:** in the app, in a browser:

1. Open **Integrations**. No connection should show a red error strip.
2. An Instantly connection showing *"reconnect with a v2 key"* means a v1-era
   key is stored — reconnect it with the key from A2.
3. For Sendblue: wait for one sweep (≤10 min), then open its connection page —
   no `Webhook subscription check failed`, and the Sendblue dashboard should now
   list your webhook URL (the sweep registers it automatically if missing).
4. Open a dashboard. Tiles should show a **"Data as of …"** timestamp.
5. **Instantly only —** open any flow with an Instantly *Get data* step and
   pick a **Campaign** and **What to pull** (daily performance is the usual
   choice). Instantly is campaign-scoped now, so a pre-existing step has no
   resource selected; testing it says exactly that rather than showing a zero.
   Then hit **Test** — it reads campaign analytics, so it returns in seconds
   even on a 37.9K-email workspace.

**PASS:** all four. **FAIL:** note which connection and what the strip says —
these are per-connector issues, not launch blockers.

## D4. Start the pool-driver read soak

**Do:** Vercel → project → **Settings → Environment Variables** → add to
**Production**:

```
DB_DRIVER_READ = pool
```

Redeploy (Deployments → ⋯ → Redeploy on the latest production build).

This moves **only** the dashboard and flows-list read paths onto the WebSocket
pool driver. Every write and all sync stay on HTTP. It starts the ~1 week soak
that gates the writer flip in Phase F.

**PASS:** the app loads normally, dashboards render, no new errors.

**FAIL / rollback:** delete the `DB_DRIVER_READ` variable and redeploy. That is
an instant, complete rollback to the HTTP driver.

---

# Phase E — Day 2

## E1. Provider budget sanity

*After roughly a full day of real traffic.*

**Do:** Neon SQL Editor:

```sql
SELECT provider, operation,
       sum(calls) AS calls, sum(throttled) AS throttled, sum(errors) AS errors
FROM usage_ledger
WHERE window_start > now() - interval '24 hours'
GROUP BY 1, 2 ORDER BY throttled DESC, calls DESC;
```

**PASS:** `throttled` is 0, or negligible next to `calls`, on every row.

**FAIL:** significant `throttled` means the budget share is too tight for that
provider. Raise `BUDGET_SHARE` in `src/lib/provider-gateway/budget.ts`, or
declare a higher per-operation limit in the connector catalog if the provider
allows more. Deferred work is never dropped, so this is tuning, not an incident.

---

# Phase F — ~1 week after launch ⏸ DEFERRED

*The one step deliberately held back. Do not do this on launch day.*

## F1. Assess the soak

Review a week of production logs since D4.

**PASS:** no error spikes mentioning WebSocket / connection / pool; dashboards
load normally; p95 dashboard latency unchanged or better.

**FAIL:** delete `DB_DRIVER_READ`, redeploy, and stop here. Capture the errors
before retrying.

## F2. Verify the pool driver 🛑

**Do:** Actions → **Verify pool driver** → *Run workflow* → Run.

It proves the two things the HTTP driver cannot do and that per-stream mutual
exclusion depends on: real interactive transactions (commit *and* rollback), and
session advisory locks that genuinely contend across connections.

**PASS:** green, ending with `Pool driver verified`.

**FAIL:** **do not flip the writer.** The usual cause is that the URL points at
a connection pooler that breaks session semantics — advisory locks silently fail
to contend through PgBouncer-style pooling. The `DATABASE_MIGRATION_URL` secret
must be the **direct** Neon host (no `-pooler` in the hostname).

> 🛑 **REPORT TO CLAUDE** — this gates the flip.

*Note: the checklist numbers this 4d, after the 4c flip. Running it first is
strictly better — the Action sets `DB_DRIVER=pool` for itself, so it proves the
capability without changing production, and a failure costs you nothing instead
of requiring a revert.*

## F3. Flip the writer

**Do:** Vercel → Environment Variables → Production:

```
DB_DRIVER = pool
```

`DB_DRIVER_READ` can be removed — it falls back to `DB_DRIVER`. Redeploy.

**PASS:** the app works normally; sync runs complete; no pool-related errors.
The per-stream advisory-lock critical sections (C.1) are now active.

**FAIL / rollback:** set `DB_DRIVER` back to `http` and redeploy.

**F4.** Keep `DB_DRIVER=pool` from here on.

---

# Optional, whenever

**Compiled engine per flow** (checklist item 8). Off by default; purely a
performance improvement, not a correctness fix. Its hard precondition is D2
**plus** a `reprocessConnection` replay for that org — the *Reprocess* button on
each connection page. Legacy pre-normalization rows store un-normalized
date-shaped strings, and until they are rewritten the JS and compiled engines
disagree on even `equals`/`contains`.

---

# If something goes wrong

**Before C1 (merge):** nothing is deployed. Restore the B1 snapshot branch in
the Neon Console and you are exactly back to the start.

**After C1:** the database and the code have moved together. Roll back the Vercel
deployment to the previous build; the schema is additive, so old code runs
against the new schema fine — that is the same safe direction as the B3→C1
window.

**Any migration failure:** migrations are pasted by hand from
`drizzle/HAND_APPLY.md` (the drizzle migrator has been removed from the repo).
The blocks are idempotent, so re-pasting is safe — but confirm what actually
landed first: run the *Schema drift check* Action or the diagnostic, then
report.
