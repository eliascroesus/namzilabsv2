# Pre-launch checklist — one-time human steps

Every human verification/rollout step from the backend hardening effort, in the
order to run them, collected here so nothing is asked mid-build. Each item says
exactly what to run, where the key comes from, what PASS looks like, and what to
do on FAIL. **This file is the single accumulator — new human steps get added
here as they arise.**

**This is the single LIVE document for the backend hardening effort.** The
build is complete (phases P0–P5 merged, 430 tests green); everything still
outstanding is a human action and it is listed here. The plan file is now a
historical record.

Run these against production (or a production-like account) shortly before
launch, top to bottom. **Item 0 comes first and blocks everything else** — the
migration runner cannot currently apply anything. Items 1, 2 and 3 are
independent; item 4 is a sequence with a soak period in the middle — start it
early enough to finish the soak.

---

## 0. Repair the drizzle migration tracker (BLOCKS EVERYTHING — do this first)

**Why:** migrations `0000`–`0004` were applied by hand in the Neon SQL Editor,
so `drizzle.__drizzle_migrations` is **empty** — the schema and the tracker
disagree. `pnpm db:migrate` currently fails on its first statement and can
apply nothing. Worse, one migration in the set deletes data, and its journal
timestamp is wrong in a way that makes the obvious repair destructive.

### Verified live state (2026-07-25, read-only diagnostic)

Run `scripts/migration-state-diagnostic.sql` in the Neon SQL Editor to
reproduce. What it found:

| | |
|---|---|
| `drizzle` schema | exists |
| `drizzle.__drizzle_migrations` | exists, **0 rows** |
| Physically applied | `0000`, `0001`, `0002`, `0004` (+ `0003` is DML, see below) |
| Genuinely pending | `0005`, `0006`, `0007`, `0008`, `0009`, `0010`, `0011` |
| Live data present | 1 flow, 2 flow_versions, 1 flow_result |

The empty-tracker-with-existing-table combination means the runner was invoked
at least once: it creates the schema and table first, then dies before its
bookkeeping inserts (they are deferred to the very end of the run).

### What `pnpm db:migrate` does today

Empty tracker → every migration is eligible → it starts at `0000`, hits
`CREATE TABLE "connections"` on a table that already exists, and exits 1 with
`42P07 duplicate_table`. **Nothing is applied and nothing is lost** — the
failure happens at position 1, before `0003` at position 4 is ever reached.
That accidental protection is the only thing standing between the current state
and data loss, and it disappears the moment the tracker gets rows.

### The hazard: `0003_wipe_flows`

`drizzle/0003_wipe_flows.sql` is the only migration made of DML rather than DDL:

```sql
DELETE FROM "flow_results";
DELETE FROM "flow_versions";
DELETE FROM "flows";
```

Every other migration **fails loudly** on a re-run (`already exists`). This one
**succeeds** — and takes every flow, published version and dashboard tile with
it. Its journal `when` is `1785600000000` (2026-08-01T16:00:00Z), a hand-typed,
future-dated, round number that is **higher than every entry after it**,
including `0011`. Under drizzle's high-water-mark rule it therefore re-fires in
every tracker state except one where the stored mark already equals or exceeds
it.

### ⚠ ORDERING IS LOAD-BEARING — journal first, tracker second

Doing these two steps in the wrong order destroys the flow data, **with exit
code 0 and no error message**. Verified by simulation against the real journal:

| Order | High-water mark | Result |
|---|---|---|
| Journal patched + deployed, tracker still empty | (empty) | Dies at `0000`. **Safe** — this is the safe interleave. |
| **Tracker baselined with the corrected stamp while the deployed journal still says `1785600000000`** | 1784588933782 | `0003` becomes eligible → **runs → all flows deleted → exit 0.** |
| Tracker baselined using the *unpatched* `1785600000000` | 1785600000000 | Nothing ever runs again. `0005`–`0011` stranded permanently, `db:migrate` reports success. |

**Do not run step 0c until step 0a is pushed, and take the 0b snapshot first.**

### Step 0a — repo-side fixes ✅ DONE (commit `9bef3bb`..`HEAD`)

No database writes. Three changes, all shipped and verified (typecheck clean,
430/430 tests, build green):

1. **`drizzle/meta/_journal.json`**, entry `idx: 3`:
   `"when": 1785600000000` → `"when": 1784400000000` (2026-07-18T18:40:00Z),
   strictly between `0002` (1784305785818) and `0004` (1784588933782), where
   `0003` actually belongs chronologically.

2. **`drizzle/0003_wipe_flows.sql` disarmed.** The three `DELETE` statements are
   replaced by `SELECT 1;` — a statement that cannot fail on any schema in any
   state. The originals are preserved verbatim in the file's header comment
   along with their original stated purpose and the reason for disabling, so the
   history of what ran on 2026-07-19 is not lost. Safe to edit an applied
   migration because drizzle writes each file's sha256 into the tracker but
   **never reads it back** — there is no drift detection to violate.
   New hash: `f152771ebbfaa216bef6a5930d857e78303e904aa45c5c47a44c252d5bd70667`.

   *Why the file and not just the timestamp:* the corrected stamp protects **this**
   database. A restored Neon branch carries real data but can carry a reset or
   empty tracker — exactly the state in which an armed `0003` deletes live flows.
   With backup branches now routine, the file itself has to be inert everywhere.

3. **`.github/workflows/db-migrate.yml` guarded** — see step 0d for why this was
   necessary.

`scripts/migration-state-diagnostic.sql` was updated to map both hashes: the new
one reports `0003_wipe_flows (DISARMED — no-op)`, the old one reports
`*** ARMED PRE-2026-07-25 VERSION ***` so a restored branch is identifiable at a
glance.

### Step 0b — SNAPSHOT (do this immediately before 0c)

Create a Neon branch backup **after** 0a is pushed and **before** the first
tracker write in 0c. Nothing before this point touches the database, so there is
nothing to protect until now; and taking it immediately before 0c means the
restore point is minutes old rather than days.

Neon Console → your project → **Branches** → **Create branch** from `production`
at **current time**. Name it something like `pre-migration-baseline-2026-07-26`.

**PASS:** the branch appears and reports the same row counts (1 flow,
2 flow_versions, 1 flow_result). Keep it until step 0d has succeeded and the app
has been exercised.

### Step 0c — baseline the tracker (Neon SQL Editor)

Records `0000`–`0004` as already applied **without re-running any of their
SQL**. Idempotent: re-running inserts nothing, because each row is guarded by a
`NOT EXISTS` on its hash (the table has no unique constraint, so `ON CONFLICT`
is not available). Touches only `drizzle.__drizzle_migrations` — it does not
read or write `flows`, `flow_versions`, `flow_results` or any application table.

```sql
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT v.hash, v.created_at
FROM (VALUES
  ('d7e87874bd0924b9a56d461ae1ab5a3f0b5b91f07964c03f5ecf5bee85be8dc0', 1784203484509::bigint), -- 0000_salty_karen_page
  ('0e58a801112632a53bcffabc9a8e3bed0973868a0a13036b0741b5f91762be96', 1784250722039::bigint), -- 0001_quick_big_bertha
  ('ecef4f9c267c0bc312f95e22204d079d775a8c5d6c874e39935e6442afac8f53', 1784305785818::bigint), -- 0002_easy_joshua_kane
  ('f152771ebbfaa216bef6a5930d857e78303e904aa45c5c47a44c252d5bd70667', 1784400000000::bigint), -- 0003_wipe_flows (disarmed) <-- CORRECTED, must match _journal.json
  ('39f21e599d00d29399c8f630c413afc682369b93757396314aee31010ca72f83', 1784588933782::bigint)  -- 0004_source_streams
) AS v(hash, created_at)
WHERE NOT EXISTS (
  SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.hash = v.hash
);
```

Never `DELETE` a tracker row and never leave `created_at` NULL. A `DELETE`
lowers the mark and re-arms `0003`; a NULL wins drizzle's
`ORDER BY created_at DESC` (Postgres implies NULLS FIRST) and `Number(null)` is
`0` in JavaScript, which makes all twelve migrations eligible again.

**PASS:** the insert reports `INSERT 0 5` the first time and `INSERT 0 0` on any
re-run, and this returns 5 rows with the flow counts unchanged at 1 / 2 / 1:

```sql
SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;
SELECT (SELECT count(*) FROM flows)         AS flows,
       (SELECT count(*) FROM flow_versions) AS flow_versions,
       (SELECT count(*) FROM flow_results)  AS flow_results;
```

### Step 0d — run the migrator — ⏸ HOLD UNTIL LAUNCH DAY (walkthrough step 2.3)

**Decision: do NOT apply 0005–0011 early.** Run it on launch day, immediately
before the merge, via the **DB Migrate (production)** Action.

**⚠ The Action does not check out the right branch by default.**
`actions/checkout@v4` is used with no `ref:`, so on `workflow_dispatch` it checks
out whatever branch is selected in the "Run workflow" dropdown — which
**defaults to the repository default branch, `main`**. `main` still carries the
pre-repair journal with `0003`'s armed stamp `1785600000000`. Dispatching from
`main` **after** step 0c would make `0003` the single eligible migration: it
would delete every flow, flow_version and flow_result, and exit 0.

A guard now blocks this at the source. The workflow fails before installing
anything if the checked-out ref still contains `1785600000000` in
`_journal.json`, or a live `DELETE FROM` in `0003_wipe_flows.sql`. Verified
against both refs: it **blocks** `main` and **passes** on the repaired branch.
Selecting the right branch is still correct practice — the guard is the net, not
the plan.

**Run:** Actions → *DB Migrate (production)* → *Run workflow* → **select the
repaired branch** (or dispatch after it is merged to `main`).

**Why hold rather than run now** (in order of weight):

1. **The runner is not transactional and its bookkeeping is deferred.**
   `neon-http` auto-commits each statement and drizzle writes *all* tracker rows
   only after the last migration succeeds. A failure partway through leaves
   earlier migrations committed with **zero** rows recorded — the same
   hand-repair situation this item exists to fix. That is worth doing with a
   fresh snapshot and someone watching, not on an ordinary afternoon.
2. **Nothing is unblocked by running early.** The new code is not deployed, so
   the schema would simply sit ahead of it with no benefit.
3. **`0006` costs a little and gains nothing during the wait** — detail below.

**Schema-ahead-of-code was checked and is otherwise safe.** `0005` drops
`webhook_endpoints`; that table is referenced nowhere in `main`'s application
code (only in migration SQL, snapshots and `docs/BUILD_PLAN.md`), so dropping it
cannot break production. `0007`/`0008`/`0010` add unused tables;
`0008`/`0009`/`0010`/`0011` add columns old code ignores. `0010`'s
`ADD COLUMN identifiers jsonb NOT NULL DEFAULT '{}'` is metadata-only on
PG 11+ — no table rewrite.

**The `0006` index question, answered.** It drops
`events_occurred_idx (occurred_at)`, `events_conn_idx (connection_id)` and
`events_conn_stream_idx (connection_id, stream_hash)`, replacing them with three
partial indexes carrying `WHERE deleted_at IS NULL`. A partial index is only
usable when the planner can prove the query implies its predicate — so the
answer depends entirely on whether production's queries filter `deleted_at`.
Both call sites on `main` were checked:

- **Flow engine (`src/lib/flow/engine.ts`, `appConds`) — gets FASTER.** It already
  emits `org_id = $1 AND deleted_at IS NULL` plus optional
  `connection_id`/`source`/`event_type`/`stream_hash`, ordered by
  `occurred_at DESC`. That is an exact match for
  `events_conn_stream_live_idx (connection_id, stream_hash, occurred_at DESC, id DESC)`,
  which also satisfies the sort. This is the hot path and it improves.
- **Classic metrics (`src/lib/metrics/compute.ts`) — slightly slower.** All six
  `events` queries there filter `org_id` + an `occurred_at` range and carry **no
  `deleted_at` predicate at all** (this is the gap the predicate audit found and
  fixed on the branch, so the fix is not in production yet). They cannot use the
  new partial indexes and they lose `events_occurred_idx`.

  They do **not** fall back to a sequential scan: `events_org_type_idx
  (org_id, event_type)` survives `0006`, and `org_id` is its leading column, so
  `WHERE org_id = $1` still drives an index scan with the date range applied as a
  filter. The index they lose was a global `occurred_at` btree — the wrong access
  path for a multi-tenant query in the first place.

  Net: a real but small regression, confined to classic dashboard metrics, on a
  pre-launch table. It disappears the moment the branch deploys, since the
  `deleted_at IS NULL` predicate lands with it.

`DROP INDEX` and `CREATE INDEX` here are non-concurrent, so they take brief
table locks. Negligible at current size; if `events` has grown past ~10⁷ rows by
launch, see the note in *Pending* about running index migrations with
`CREATE INDEX CONCURRENTLY` instead.

**PASS:** the run exits 0 printing `Migrations applied.` and the tracker holds 12
rows. Re-running `scripts/migration-state-diagnostic.sql` should show every
`m00xx_*` marker `true`, `m0005_webhook_endpoints_dropped` `true`, all three
`m0006_old_*_still_present` **false**, and the flow counts still 1 / 2 / 1.

**FAIL — do NOT retry blindly.** `neon-http` has no transactions and defers all
bookkeeping to the end of the run, so a mid-run failure leaves earlier
migrations committed with **zero** tracker rows written; a blind retry replays
them and fails on the first one that already landed. Instead: re-run the
diagnostic, see what physically landed, extend the step-0b baseline with those
migrations' hashes and journal stamps, and run `db:migrate` again.

### Proof of what step 0c applies (dry analysis)

After 0a + 0b the stored high-water mark is `1784588933782` (`0004`). drizzle
applies every journal entry whose `when` is **strictly greater**:

| Migration | `when` | > 1784588933782? | Applies |
|---|---|---|---|
| 0000 | 1784203484509 | no | skip |
| 0001 | 1784250722039 | no | skip |
| 0002 | 1784305785818 | no | skip |
| **0003** | **1784400000000** (corrected) | **no** | **SKIP — the wipe can never fire** |
| 0004 | 1784588933782 | no (equal; test is strict `<`) | skip |
| 0005 | 1784826554754 | yes | **apply** |
| 0006 | 1784974748647 | yes | **apply** |
| 0007 | 1784978435029 | yes | **apply** |
| 0008 | 1784989934295 | yes | **apply** |
| 0009 | 1784992767604 | yes | **apply** |
| 0010 | 1784994470354 | yes | **apply** |
| 0011 | 1785004537576 | yes | **apply** |

Exactly the seven genuinely-pending migrations, and `0003` is not among them.
Every one of the seven was checked against the live schema and its
preconditions hold: `0005` finds `webhook_endpoints` present; `0006` finds all
three old indexes present and the `deleted_at` / `stream_hash` columns it needs;
`0007`/`0008`/`0010` create tables that do not exist; `0008`/`0009`/`0010`/`0011`
add columns that do not exist.

### The future-dated timestamp and the Aug 1 ceiling

**Nothing has been silently skipped so far** — with an empty tracker the runner
never got past `0000`, so no migration was ever quietly passed over.

**But the trap was armed.** Had the tracker been baselined using the journal's
values as-is, `0003`'s row would carry `created_at = 1785600000000`, making that
the high-water mark. `drizzle-kit generate` stamps `when: Date.now()`, so
**every migration generated before 2026-08-01T16:00:00Z would have sorted below
the mark and been skipped in silence** — `0005`–`0011` plus any new `0012`,
`0013`… authored in that window. `pnpm db:migrate` would print
`Migrations applied.`, exit 0, and apply nothing; CI and the deploy would be
green; the failures would surface later as unrelated-looking
`column … does not exist` errors at runtime.

**The fix removes the ceiling permanently, not just until Aug 1.** With `0003`
rewritten to `1784400000000`, the highest stamp in the journal becomes `0011`'s
`1785004537576` (2026-07-25T18:35:37Z) — already in the past. Every migration
generated from now on carries a larger `Date.now()` and is always eligible.

### Order of operations, at a glance

| | Step | Who | Touches the DB? |
|---|---|---|---|
| ✅ | **0a** journal stamp + disarm `0003` + workflow guard | done, pushed | no |
| ⬜ | **0b** Neon branch snapshot | you | no (creates a copy) |
| ⬜ | **0c** baseline INSERT (5 rows) | you, SQL Editor | yes — tracker only |
| ⏸ | **0d** apply `0005`–`0011` | Action, launch day | yes — schema |

The gap between 0a and 0c is safe in both directions: with the journal patched
and the tracker still empty, an accidental `db:migrate` dies at `0000` exactly as
it does today.

---

## 1. Close — Event Log pagination contract

**Why:** the Close connector's burst-safe pagination is built on the documented
API shape (`data[]` + `cursor_next` via `_cursor`, `_limit` cap 50,
`date_created__gte`), pinned in tests but never confirmed against the live API —
the docs site is bot-walled from the build environment.

**Already run twice, and the first run's headline finding was wrong.** It
reported the Event Log as **oldest-first**; it is newest-first, as the docs say
and as the re-run confirms. The check compared `Date.parse(a) >= Date.parse(b)`
and one event's `date_created` did not parse, so every comparison against NaN
came back false and a correctly ordered log read as unordered. The script now
prints raw evidence — the actual timestamps, the breaking pairs — instead of a
verdict, which is the change that made the difference visible.

The first run's other finding was real: the `_limit` cap probe asked for 100, got
HTTP 400 instead of a clamp, and aborted the script before C4 (cursor integrity)
and C5 (the 30-day first-sync bound) ever ran. Fixed — no single check can abort
the run. **C4 and C5 have still never passed against the live API**; that is what
this item is now for.

The connector was rewritten to assume no ordering while the wrong finding stood,
and it was NOT reverted. Direction-free progress and previews are correct
whichever way a provider sorts, the provider is free to change it, and the
rewrite carried two unrelated defects out with it.

**Key:** Close → Settings → Developer → API Keys → any key of the workspace you
connect (read access is enough; the script only performs GETs).

**Run — no terminal needed.** Store the key as the repo secret `CLOSE_API_KEY`
(Settings → Secrets and variables → Actions), then: Actions → **Verify providers
(read-only)** → Run workflow → provider **close** (or **all**).

<details><summary>Local equivalent</summary>

```bash
CLOSE_API_KEY=api_xxx pnpm tsx scripts/verify-close-pagination.ts
```

</details>

**PASS:** every line prints `[PASS]` and the script ends with
`All checks passed — the pinned contract holds.` (exit code 0). If the event
log is empty it will say so — create a lead or send an SMS in Close, then
re-run so the cursor-walk checks actually execute.

**FAIL:** the script names the failed check (C1–C5). Do NOT ship the Close
connector as-is: the pagination assumptions in `src/connectors/close.ts` and
`tests/close-poll.test.ts` must be updated to whatever the live API actually
does (the failing check tells you which assumption broke), then re-run until
green.

**Also read the `[INFO]` findings**, which cannot fail the run and are worth
acting on:

- **C2 observed ordering.** Nothing depends on a direction any more, but a change
  here is worth knowing.
- **C6 `date_created__lte`.** If Close accepts an upper bound, a first sync can
  walk the window in exclusive recent-first SEGMENTS with no re-reads, which is
  strictly better than the two-rung ladder in `close.ts` (`FIRST_RUNG_DAYS`).
- **C7 `_order_by`.** If it works, `testFetchLatest` becomes one request instead
  of a bounded search.

---

## 2. Instantly — v2 emails list contract (and key era)

**Why:** the Instantly poll mirrors the same window-walk pattern over
`GET /api/v2/emails` (`items[]` + `next_starting_after`, newest-first), also
pinned from documented shape only. The same run confirms your stored API key is
v2-era (v1 keys stopped working Jan 19, 2026).

**Key:** Instantly → Settings → Integrations → API → create/copy a **v2** API
key.

**Run — no terminal needed.** Store the key as the repo secret
`INSTANTLY_API_KEY`, then: Actions → **Verify providers (read-only)** → Run
workflow → provider **instantly** (or **all**).

<details><summary>Local equivalent</summary>

```bash
INSTANTLY_API_KEY=xxx pnpm tsx scripts/verify-instantly-pagination.ts
```

</details>

**PASS:** every line prints `[PASS]`, ending with
`All checks passed — the pinned contract holds.` (exit 0).

**FAIL:**
- `HTTP 401` → the key is invalid or v1-era: create a v2 key and reconnect the
  Instantly connection in the app (its connection page will also show the
  reconnect prompt after the first sweep).
- Any I1–I4 check fails → update `src/connectors/instantly.ts` +
  `tests/instantly-sendblue-poll.test.ts` to the live behavior before shipping
  the Instantly poll.

---

## 3. Sendblue — base URL + messages list + webhook management

**Why:** the Sendblue poll and webhook self-healing are built on
`https://api.sendblue.co` with `GET /api/v2/messages` and
`GET|POST /api/account/webhooks`, none of which could be confirmed from the
build environment (docs bot-walled, no pre-existing send path in the repo to
compare against). One authenticated call settles the host and both endpoints.

**Keys:** Sendblue dashboard → API settings → API Key ID + API Secret (the same
pair entered when connecting Sendblue in the app).

**Run:**

Store both credentials as the repo secrets `SENDBLUE_API_KEY_ID` and
`SENDBLUE_API_SECRET`, then: Actions → **Verify providers (read-only)** → Run
workflow → provider **sendblue** (or **all**).

`scripts/verify-sendblue.ts` checks S1-S5 (host answers, messages list,
`message_handle` present, limit/offset honored, webhook list readable) and — the
part that used to need a human guess — **automatically retries the alternate
host** (`api.sendblue.com`) when the primary does not answer, then tells you
which one worked so `API_BASE` can be corrected in one move.

<details><summary>Local equivalent</summary>

```bash
SENDBLUE_API_KEY_ID=xxx SENDBLUE_API_SECRET=yyy pnpm tsx scripts/verify-sendblue.ts
```

</details>

**PASS:** both return `HTTP 200` with JSON — the first containing a message
list (message objects with `message_handle`), the second a webhook list (may be
empty `[]`/`{"webhooks":[]}` — empty is fine; the sweep will register ours).

**FAIL:**
- DNS error / connection refused / redirect to a marketing page → the host is
  wrong: try `api.sendblue.com` with the same calls; whichever answers 200,
  set it as `API_BASE` in `src/connectors/sendblue.ts` (single constant at the
  top) and re-run tests.
- `HTTP 401/403` with correct keys → the auth header names differ from
  `sb-api-key-id`/`sb-api-secret-key`; check the dashboard's API examples and
  update `authHeaders()` in `src/connectors/sendblue.ts`.
- `404` on one endpoint only → that endpoint's path changed; update the path in
  `src/connectors/sendblue.ts` (poll and/or `verifyWebhookSubscription`).

---

## 4. Database driver rollout (B.3) — sequence with soak

**Why:** moving from Neon's stateless HTTP driver to the WebSocket Pool driver
unlocks real transactions and advisory locks (required by C.1 mutual exclusion
and the atomic sync swap). The rollout is deliberately staged: reads soak first,
the writer moves only after a clean soak.

**Keys/env:** these are Vercel (or hosting) environment variables on the
production deployment. `DATABASE_URL` is unchanged throughout.

**Step 4a — flip reads.** Set on production:

```bash
DB_DRIVER_READ=pool
```

Redeploy. The dashboard and flows-list pages now read via the pool driver;
everything else (all writes, all sync) stays on HTTP.

**Step 4b — soak (recommended: ≥1 week of normal traffic).** PASS looks like:
no new error spikes in logs mentioning WebSocket/connection/pool, dashboards
load normally, p95 latency of dashboard loads unchanged or better. FAIL (errors
or latency regressions attributable to the pool driver): unset `DB_DRIVER_READ`
(instant rollback to HTTP), capture the errors, investigate before retrying.

**Step 4c — move the writer.** After a clean soak, set:

```bash
DB_DRIVER=pool
```

(`DB_DRIVER_READ` may be removed — it falls back to `DB_DRIVER`.) Redeploy.

**Step 4d — verify pool capabilities (activates C.1).** Run against production
`DATABASE_URL` from a trusted machine:

No terminal needed: Actions → **Verify pool driver** → Run workflow. It uses the
existing `DATABASE_MIGRATION_URL` secret and sets `DB_DRIVER=pool` itself.

<details><summary>Local equivalent</summary>

```bash
DATABASE_URL="postgresql://…" DB_DRIVER=pool pnpm tsx scripts/verify-pool-driver.ts
```

</details>

**PASS:** the script prints `[PASS]` for transaction commit/rollback and
advisory-lock acquire/contend/release, ending with `Pool driver verified`.
**FAIL:** the writer flip is NOT safe — revert `DB_DRIVER` to `http` and
investigate (most likely the URL points at a connection pooler that breaks
session semantics; use the direct Neon host for the pool driver).

**Step 4e — after PASS:** the per-stream advisory-lock critical sections (C.1)
are active wherever the code gates on the pool driver. Keep `DB_DRIVER=pool`
set from here on.

---

## 5. One-time legacy-row reconciliation (AFTER deploy, BEFORE any backfill/replay)

**Why:** rows written before the unified writer can sit on stream-scoped
connections (Sheets, Calendar, Calendly) with no stream identity
(`sync_generation >= 1 AND stream_hash IS NULL`). Every sweep today is
stream-scoped, so nothing can ever retire them — they're ghosts of resources
that may be long gone, still counted by reads that aren't stream-filtered
(a Get-data step with no resource chosen, classic metrics). This retires
exactly those.

**⚠ Instantly's existing rows are now in scope for this step.** Instantly became
stream-scoped when it gained `flowFields` (campaign + stream type). That flips
`isStreamScoped("instantly")` to true, so its pre-existing events — written by
the old workspace-wide poll, carrying `sync_generation >= 1` and no
`stream_hash` — match this reconciliation's target shape exactly and WILL be
retired by the apply run.

That is the correct outcome: those rows are a partial, unfinishable dump from a
sync that could never complete, and nothing can ever refresh or retire them
otherwise. It is called out here so it is a decision rather than a surprise.
Expect the inspect run to report a non-zero count against the Instantly
connection. Rows are soft-deleted, so a mistaken run is reversible by clearing
`deleted_at`.

**Ordering (load-bearing):** run this AFTER the production deploy and BEFORE
any fleet backfill or `reprocessConnection` replay (the A.1/A.2 registry
backfills and the engine track's replays). Those operations would otherwise
re-process ghost rows as if they were real data.

**Keys:** production `DATABASE_URL` (the same one the app uses).

**Run — no terminal needed.** Actions → **Legacy row reconciliation** → Run
workflow → mode **inspect** (the default; writes nothing). Review the
per-connection breakdown in the run summary, then run it again with mode
**apply**.

<details><summary>Local equivalent</summary>

```bash
DATABASE_URL="postgresql://…" pnpm tsx scripts/reconcile-legacy-rows.ts
DATABASE_URL="postgresql://…" pnpm tsx scripts/reconcile-legacy-rows.ts --apply
```

</details>

**PASS:** the apply run ends with `PASS — every legacy ghost row is retired.
Backfills and replays are now unblocked.` A brand-new install prints
`Nothing to do` — that is also a pass.

**ALSO GATED ON THIS STEP — the compiled-engine flag.** Pre-unification rows can
hold un-normalized date-shaped strings (`"7/21/2026 14:23:45"`). The JS engine
normalizes those when it reads them; the compiled path compares what is stored.
So on legacy rows even `equals` and `contains` — not just date operators —
disagree between the two engines. This is proven, not theoretical: see the
`legacy (pre-normalization) rows diverge until the reprocess replay` case in
`tests/engine-parity.test.ts`, which also proves that rewriting the row through
the writer restores parity.

**Rule:** do not enable the pushdown flag for an org until (a) this
reconciliation has run AND (b) a `reprocessConnection` replay has re-normalized
that org's connections. Both are production data operations and both live in
this step's ordering.

**FAIL:** if it exits with `WARNING — rows remain`, simply re-run `--apply`:
the script is idempotent and batched, so re-running (or resuming an
interrupted run) is always safe and never double-deletes. If counts look
wildly larger than expected, stop and inspect: rows are only soft-deleted, so
nothing is lost, and `deleted_at` can be cleared for a mistaken batch.

---

## 6. Post-deploy sanity pass (after 1–5)

- Open **Integrations** in the app: no connection should show a red error strip.
  An Instantly connection showing the "reconnect with a v2 key" message means a
  v1-era key is stored — reconnect it (item 2's key).
- For a Sendblue connection: after one sweep (≤10 min), its connection page
  should show no `Webhook subscription check failed` error, and the Sendblue
  dashboard should list our webhook URL (the sweep self-registers it if
  missing).

---

## 7. Provider budget sanity (after the first day of production traffic)

**Why:** the token buckets spend a configurable SHARE (70%) of each provider's
published limit. If a share is set too low for a busy tenant, sweeps defer
often (visible as "paused, retrying" on connections); too high risks provider
throttling. One look at the ledger after real traffic confirms the setting.

**Run** (against production `DATABASE_URL`, read-only):

```sql
SELECT provider, operation,
       sum(calls) AS calls, sum(throttled) AS throttled, sum(errors) AS errors
FROM usage_ledger
WHERE window_start > now() - interval '24 hours'
GROUP BY 1, 2 ORDER BY throttled DESC, calls DESC;
```

**PASS:** `throttled` is 0 or a negligible fraction of `calls` for every row.

**FAIL (throttled is significant):** the budget share is too tight for that
provider — raise `BUDGET_SHARE` in `src/lib/provider-gateway/budget.ts`, or
declare a higher per-operation limit in the connector catalog if the provider
actually allows more. Deferred work is never lost, so this is a tuning issue,
not an incident.

---

## 8. Enable the compiled engine per flow (optional, after item 5)

**Why:** the compiled path (filter pushdown into SQL) is built, proven
parity-identical, and OFF by default. It is opt-in per flow via
`EngineCtx.compile`. Nothing breaks if it is never enabled — it is a
performance improvement, not a correctness fix.

**Precondition (hard):** item 5 has run AND a `reprocessConnection` replay has
re-normalized the org's connections. Legacy pre-normalization rows store
un-normalized date-shaped strings; the JS engine normalizes those on read while
the compiled path compares stored values, so even `equals`/`contains` diverge
until the replay. Both the divergence and its repair are proven in
`tests/engine-parity.test.ts`.

**PASS:** dashboard numbers are unchanged after enabling (they must be —
folded filters still run in JS, so the pushdown can only reduce rows loaded).
The Get-data and filter steps in the editor will show LOWER row counts, which
is expected and honest: fewer rows were fetched.

**FAIL / rollback:** turn the flag off. There is no migration and no data
change to undo.

**Observability:** each materialized tile stores its provenance
(`flow_results.provenance`) — the exact SQL, its bound parameters, which
filters were folded, rows loaded, truncation state, and the as-of timestamp.
Query it to see what produced any number.

---

## 9. DEFERRED — with the triggers that un-defer them

These are not "someday". Each has a condition that makes it required, written
down so it cannot be quietly forgotten.

### 9a. E.8 backfill lane — REQUIRED BEFORE either of these happens

**Trigger (whichever comes first):**
1. **Any Records-class stream ships to a real account** — Instantly's
   `raw_emails` stream type, or per-object scoping for the Close event log.
2. **Any account with large history onboards** — more than roughly a month of
   data behind the first sweep of a record-mirroring source.

**Why it is not needed yet:** every stream that ships today is either bounded
(Sheets = one tab; Calendly, Calendar, Sendblue, Instantly raw-emails = a dated
window) or tiny (Instantly analytics = one row per day). Nothing currently has
a large first import to checkpoint.

**Why the trigger is real:** the migration runner's failure mode applies to
imports too — work committed with no bookkeeping, and no way to resume except
starting over. A Records-class stream over real history is exactly where that
bites, and it bites a customer rather than an operator.

**What it is:** a checkpointed, resumable, low-priority Inngest lane with its
own budget share (≤50%), `backfill_status`/`backfill_progress` on
`source_streams`, and a Test that reports "importing, N% done" through the
existing F.8 `sourceNote` seam rather than erroring.

### 9b. Compiled-engine flag — post-launch, per flow, default OFF

**Trigger:** deliberate opt-in per flow, after checklist item 5 AND a
`reprocessConnection` replay for that org.

**Status:** built and parity-proven; `EngineCtx.compile` has no caller, so the
path is unreachable in production. That is the intended default. Wiring it
means adding per-flow storage for the flag and a UI to set it — post-launch
work, gated on the parity suite staying green.

### 9c. Close per-object scoping — deferred, no trigger

Close polls its whole workspace event log with only a date bound and no
server-side `object_type` filter, so it fetches every type and maps five. It
works today and is cursor-friendly; this is optimization, not correctness. If
it is ever scoped per flow, 9a's trigger 1 applies.

---

## Pending — will be added here when built

- **Index rollout at scale**: if `events` has grown large (>10⁷ rows) before
  launch, apply new index migrations manually with `CREATE INDEX CONCURRENTLY`
  instead of the transactional migration runner. Not needed at current size.
- **Full CTE-per-node compilation** (consciously descoped, not forgotten): a
  flow whose filters cannot be folded loads up to 500,000 rows into the JS
  engine. Crossing that ceiling is reported as a visible `truncated` state, and
  `flow_results.provenance.reads[].rowsLoaded` shows the real distribution.
  Revisit compiling aggregates/dedupe/group-by as CTEs if observed row counts
  approach the ceiling for real flows.
