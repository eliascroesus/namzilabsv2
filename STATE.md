# Where this project actually is

Plain English, for coming back to this cold. Written 2026-07-31 against
`main @ 12a40a1`.

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
branch. Two provider contracts have never been verified against a live API, and
one rate-limit decision is waiting on the first of them.

---

## Every flag and setting, and what flipping it does

### Rollout flags — these are the switches you have lost track of

| Setting | Current value | What it does when set |
|---|---|---|
| `WEBHOOK_EVENT_TIME_LIVE` | **unset (off)** | Off: the nightly scan works out which payload key holds each webhook connection's event time and records the answer, but events keep being dated exactly as before. On: new events use the resolved key, AND the first nightly run restamps every catch-hook connection's stored events. Both halves flip together on purpose — dating new events better while old ones keep the old answer puts two meanings inside one number. **Look before flipping:** paste `scripts/webhook-event-time.sql` into the Neon editor. |
| `DB_DRIVER` | **unset → `http`** | `pool` switches the WRITER to the WebSocket driver: real sessions, so `db.transaction()` and Postgres advisory locks start actually doing something. Until then the stream write-lock runs its body without a lock (harmless — the Inngest concurrency key is still the first-line serializer). Rollout order matters; see checklist item 4. |
| `DB_DRIVER_READ` | **unset → falls back to `DB_DRIVER`** | Set to `pool` FIRST and soak the read-only surfaces before moving the writer. |

### Provider keys — only needed to run the verification scripts

| Setting | Needed for |
|---|---|
| `CLOSE_API_KEY` | `scripts/verify-close-pagination.ts` (checklist item 1). Store as a repo secret; run via Actions → *Verify providers (read-only)*. |
| `INSTANTLY_API_KEY` | `scripts/verify-instantly.ts` (item 2). |
| `SENDBLUE_API_KEY_ID` / `SENDBLUE_API_SECRET` | `scripts/verify-sendblue.ts` (item 3). |
| `CLOSE_VERIFY_PAGES` | Walk depth for the Close script. Default 40 pages. |

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
- **Six connectors** — Calendly, Close, Instantly, Sendblue, Google Sheets,
  Google Calendar, plus the custom webhook.
- **Sheets date column** — a sheet dates its rows from a column in the sheet,
  detected automatically by default, and says which column it used. Choosing a
  different one restamps the rows already stored.
- **Backfill lane** — checkpointed historical import, runs automatically for a
  genuinely new non-mirror stream.
- **Retention (half)** — `delivery_log` and `test_runs` pruned at 30 days,
  nightly, 5,000 rows per table per run.
- **Disconnect is reversible** — disconnecting disables rather than deletes; the
  Integrations page offers Reconnect.
- **Health checks** — nightly invariant scan (streams that stopped being polled,
  connections failing on a streak, wedged backfills, unresolved dead letters,
  empty mirrors) and a per-sweep mirror row-count check.
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
   forks from 0015 and main is now at 0019, so at merge time the migration must
   be **regenerated**, not renumbered — rebase, delete the migration and
   snapshot, re-run `pnpm db:generate`. Renaming the file leaves a journal whose
   entry claims a predecessor that is not 0019, and the next `db:generate` on
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
- **The compiled query engine flag.** Checklist item 8 describes it; no flag
  exists in the code yet.

---

## What is blocked, and on what

| Blocked | Waiting on |
|---|---|
| **Declaring Close's and Sendblue's real rate limits** | A live run of `scripts/verify-close-pagination.ts`. Both currently fall through to `DEFAULT_RPM = 60`, taken at the 70% share → 42/min (31 for background work). That is a guess no provider published. Close returns real `ratelimit` headers on every response, so one live run replaces the guess with evidence. |
| **Close checks C4 and C5** | Same live run. C4 (cursor integrity) and C5 (the 30-day first-sync bound) **have still never passed against the live API** — an earlier run aborted before reaching them. Everything else in that script has passed. |
| **Phase 9 (per-object Close scoping)** | The same run, plus the backfill lane, because scoping Close per flow makes it a Records-class stream. |
| **Instantly and Sendblue contract checks** | Live keys (checklist items 2 and 3). |
| **`DB_DRIVER=pool`** | A read-path soak with `DB_DRIVER_READ=pool` first (checklist item 4). Until then advisory locks are inert, which is why one test stands in for lock contention rather than producing it. |

### One correction worth remembering

An earlier run of the Close script reported the Event Log as **oldest-first**.
That was a bug in the script, not a fact about Close — it compared parsed dates
and one event's timestamp did not parse, so every comparison against NaN came
back false. **Close is newest-first**, as its documentation says. The code was
rewritten to assume no ordering at all while the wrong answer stood, and that
was deliberately NOT reverted: a progress number that is right only because a
provider sorts a particular way is one nobody can check.

---

## How migrations work here

**By hand, in the Neon SQL Editor.** Drizzle's tracker has never matched reality
and is not to be read or repaired. `drizzle/HAND_APPLY.md` has a pasteable block
and a verify query for every migration.

Applied through **0019**. The rule, every time: paste the block, confirm it
landed (Actions → *Schema drift check*, or paste `scripts/schema-audit.sql`),
**then** deploy the code. Declaring a column in `schema.ts` is enough to break a
deploy on its own — drizzle expands `select()` to an explicit column list — so a
migration commit stays off the deploy branch until the SQL is applied.

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
before anything ships. Currently **814 tests / 66 files**. Behavioural changes
are sabotage-verified: break the thing, confirm its own test fails and no other.
`check:orphans` fails the build on an exported function no production code
calls — a feature only its own tests call is not shipped.
