# Pre-launch checklist — one-time human steps

Every human verification/rollout step from the backend hardening effort, in the
order to run them, collected here so nothing is asked mid-build. Each item says
exactly what to run, where the key comes from, what PASS looks like, and what to
do on FAIL. **This file is the single accumulator — new human steps get added
here as they arise.**

Run these against production (or a production-like account) shortly before
launch, top to bottom. Items 1, 2 and 3 are independent; item 4 is a sequence
with a soak period in the middle — start it early enough to finish the soak.

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

## Pending — will be added here when built

- **Index rollout at scale**: if `events` has grown large (>10⁷ rows) before
  launch, apply new index migrations manually with `CREATE INDEX CONCURRENTLY`
  instead of the transactional migration runner. Not needed at current size.
