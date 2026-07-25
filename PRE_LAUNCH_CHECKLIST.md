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

**Do not run step 0b until step 0a is deployed.**

### Step 0a — correct the journal timestamp, commit, deploy

In `drizzle/meta/_journal.json`, entry `idx: 3` (`0003_wipe_flows`):

```
"when": 1785600000000   ->   "when": 1784400000000
```

`1784400000000` sits strictly between `0002` (1784305785818) and `0004`
(1784588933782), which is where `0003` actually belongs chronologically. Commit
and **deploy** this before touching the database. Until it is deployed, an
accidental `db:migrate` still just fails safely at `0000`.

### Step 0b — baseline the tracker (Neon SQL Editor)

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
  ('2d903d9ed440ad3ce76489a101073f6df3034132ac3d201a415eee67a8e99ba2', 1784400000000::bigint), -- 0003_wipe_flows  <-- CORRECTED, must match _journal.json
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

### Step 0c — run the migrator

```bash
DATABASE_URL="postgresql://…" pnpm db:migrate
```

**PASS:** exits 0 printing `Migrations applied.`, and the tracker now holds 12
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

### Optional hardening (beyond the fix above — your call)

Steps 0a–0c stop `0003` from ever firing *in this database*. The file itself
stays armed for any future fresh database, new branch or reset tracker. To
disarm it everywhere, replace the three `DELETE` statements in
`drizzle/0003_wipe_flows.sql` with a no-op (`DELETE FROM "flows" WHERE false;`)
plus a comment explaining why. This is safe because drizzle never reads the
stored hash back, so an edited file is never detected as drift.

**Tradeoff:** the file then no longer records what was actually executed on
2026-07-19. If you take this option, the hash in step 0b's `0003` row will no
longer match the file — harmless functionally, but
`scripts/migration-state-diagnostic.sql` will label that row
`UNKNOWN (file edited after apply…)` unless its `CASE` is updated to the new
hash.

---

## 1. Close — Event Log pagination contract

**Why:** the Close connector's burst-safe pagination is built on the documented
API shape (`data[]` + `cursor_next` via `_cursor`, newest-first, `_limit` cap
50, `date_created__gte`), pinned in tests but never confirmed against the live
API — the docs site is bot-walled from the build environment.

**Key:** Close → Settings → Developer → API Keys → any key of the workspace you
connect (read access is enough; the script only performs GETs).

**Run:**

```bash
CLOSE_API_KEY=api_xxx pnpm tsx scripts/verify-close-pagination.ts
```

**PASS:** every line prints `[PASS]` and the script ends with
`All checks passed — the pinned contract holds.` (exit code 0). If the event
log is empty it will say so — create a lead or send an SMS in Close, then
re-run so the cursor-walk checks actually execute.

**FAIL:** the script names the failed check (C1–C5). Do NOT ship the Close
connector as-is: the pagination assumptions in `src/connectors/close.ts` and
`tests/close-poll.test.ts` must be updated to whatever the live API actually
does (the failing check tells you which assumption broke), then re-run until
green.

---

## 2. Instantly — v2 emails list contract (and key era)

**Why:** the Instantly poll mirrors the same window-walk pattern over
`GET /api/v2/emails` (`items[]` + `next_starting_after`, newest-first), also
pinned from documented shape only. The same run confirms your stored API key is
v2-era (v1 keys stopped working Jan 19, 2026).

**Key:** Instantly → Settings → Integrations → API → create/copy a **v2** API
key.

**Run:**

```bash
INSTANTLY_API_KEY=xxx pnpm tsx scripts/verify-instantly-pagination.ts
```

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

```bash
curl -sS -w "\nHTTP %{http_code}\n" \
  -H "sb-api-key-id: YOUR_KEY_ID" \
  -H "sb-api-secret-key: YOUR_SECRET" \
  "https://api.sendblue.co/api/v2/messages?limit=1&offset=0"

curl -sS -w "\nHTTP %{http_code}\n" \
  -H "sb-api-key-id: YOUR_KEY_ID" \
  -H "sb-api-secret-key: YOUR_SECRET" \
  "https://api.sendblue.co/api/account/webhooks"
```

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

```bash
DATABASE_URL="postgresql://…" DB_DRIVER=pool pnpm tsx scripts/verify-pool-driver.ts
```

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

**Ordering (load-bearing):** run this AFTER the production deploy and BEFORE
any fleet backfill or `reprocessConnection` replay (the A.1/A.2 registry
backfills and the engine track's replays). Those operations would otherwise
re-process ghost rows as if they were real data.

**Keys:** production `DATABASE_URL` (the same one the app uses).

**Run — inspect first, it writes nothing:**

```bash
DATABASE_URL="postgresql://…" pnpm tsx scripts/reconcile-legacy-rows.ts
```

Review the per-connection breakdown it prints. Then apply:

```bash
DATABASE_URL="postgresql://…" pnpm tsx scripts/reconcile-legacy-rows.ts --apply
```

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
