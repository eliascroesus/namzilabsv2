# Migrations, applied by hand

Every migration in this project is applied by pasting SQL into the Neon SQL
Editor. Drizzle's migration tracker therefore records what drizzle *believes* it
applied, which has never matched reality here — do not read it, and do not try
to repair it.

That is not a complaint about the process; it works. What it needs is a step
that confirms the paste landed, because the failure is silent. **Migration 0012
was skipped and nobody knew for weeks.** It adds two columns to `sync_state`,
`withConnectionSyncLock` reads them on every sync entry point, so the sweep, the
Test button and manual re-sync were all throwing in production while the test
suite stayed green — the tests build their own database from these files and
never look at the real one.

## The procedure, every time

1. **Paste the block for the migration below.** They are written with
   `IF NOT EXISTS` so pasting one twice is safe and does nothing the second
   time. That matters because the honest answer to "did that run?" is often
   "I'm not sure".

2. **Confirm it landed.** Either:
   - Run the **Schema drift check** Action (Actions → *Schema drift check* →
     Run workflow). It compares every table and column the deployed code
     references against the live database and fails loudly on a gap; or
   - Paste `scripts/schema-audit.sql` (query 1) into the Neon editor. A clean
     result is a screen of `ok`.

   Do this straight after pasting, not later. It takes seconds and it is the
   only thing standing between a skipped migration and another silent outage.

3. **Deploy the code that needs it, after — never before.** Code referencing a
   column that does not exist yet is exactly the 0012 failure, just in the other
   order.

   Note what "referencing" covers, because it is wider than it sounds:
   **declaring a column in `src/db/schema.ts` is enough, with nothing reading
   it.** `db.select().from(table)` does not emit `SELECT *` — drizzle expands it
   to an explicit column list built from the schema, so every existing full-row
   select on that table starts naming the new column the moment it is declared.
   Demonstrated for 0018 by building a PGlite database at production's schema and
   running the real query shape: it throws `column "date_field" does not exist`.

   This does not change the rule or the order, and a migration commit still
   carries its `schema.ts` declaration — it has to, because
   `scripts/schema-audit.sql` and the drift check both derive "what production
   should have" from `schema.ts`, so splitting them would make step 2 report a
   clean screen of `ok` whether or not the paste landed. That is the 0012 silent
   skip, rebuilt. It only means step 3 is load-bearing for EVERY migration
   commit, not just ones whose code reads the new columns.

---

## 0013 — `usage_ledger.observed_limit`

Keeps the rate limit a provider states about ITSELF, from its own response
headers. Close sends an RFC `ratelimit` header on every response; the number was
being parsed and discarded. Four of the seven connectors currently run on a
`DEFAULT_RPM` of 60 that no provider ever published, and this is the evidence
needed to replace those guesses with observations.

Additive and nullable. Nothing reads it yet, so applying it late costs nothing
and applying it early is harmless.

```sql
ALTER TABLE "usage_ledger" ADD COLUMN IF NOT EXISTS "observed_limit" integer;
```

Verify:

```sql
SELECT count(*) AS should_be_1
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'usage_ledger'
  AND column_name = 'observed_limit';
```

After about a day of traffic, `scripts/observed-limits.sql` reports what the
providers actually said.

---

## 0014 — `connections.disabled_at`, plus two indexes retention needs

Three additive changes; none rewrites existing data.

`connections.disabled_at` is what makes disconnect reversible. Disconnecting
used to hard-delete the row, and because every connector namespaces its
`eventId` with the connection UUID, re-adding the account imported a SECOND
complete copy of the dataset rather than restoring the first. Keeping the row
keeps the UUID, so reconnecting is free.

The two indexes are for the retention pass that follows. Every existing index on
`events` involving `deleted_at` is `WHERE deleted_at IS NULL` — which is exactly
the set a purge does NOT want — so finding tombstones older than a cutoff had no
supporting index at all and meant a sequential scan of the largest table here.

```sql
ALTER TABLE "connections" ADD COLUMN IF NOT EXISTS "disabled_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "events_deleted_idx"
  ON "events" USING btree ("deleted_at")
  WHERE deleted_at is not null;

CREATE INDEX IF NOT EXISTS "raw_events_conn_received_idx"
  ON "raw_events" USING btree ("connection_id", "received_at");
```

Both `CREATE INDEX` statements take a write lock on their table for the duration.
On a large `events` table use `CREATE INDEX CONCURRENTLY` instead — it cannot run
inside a transaction block, so run it on its own, and re-check with the verify
query below because a concurrent build can fail and leave an INVALID index
behind:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "events_deleted_idx"
  ON "events" USING btree ("deleted_at")
  WHERE deleted_at is not null;
```

Verify:

```sql
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='connections' AND column_name='disabled_at')  AS disabled_at_col,
  (SELECT count(*) FROM pg_indexes
    WHERE schemaname='public' AND indexname='events_deleted_idx')                            AS events_idx,
  (SELECT count(*) FROM pg_indexes
    WHERE schemaname='public' AND indexname='raw_events_conn_received_idx')                  AS raw_events_idx,
  (SELECT count(*) FROM pg_index WHERE NOT indisvalid
     AND indexrelid::regclass::text IN ('events_deleted_idx','raw_events_conn_received_idx')) AS invalid_should_be_0;
```

All three counts should be 1, and the last 0.

---

## 0015 — `source_streams.window_floor`

How far back a single stream is supposed to reach, when that is further than
the connector's default. Additive and nullable; NULL means "the default", which
is what every stream says until something deliberately deepens it.

It exists because one value has to drive both the request bound and the window
the connector DECLARES. Split them and a deepened import is soft-deleted by the
very next completed sweep: Calendly declares `{now-30d, now+90d}` and the runner
prunes outside it, so 90 days of fetched history would be tombstoned by its own
declaration.

```sql
ALTER TABLE "source_streams" ADD COLUMN IF NOT EXISTS "window_floor" timestamp with time zone;
```

Verify:

```sql
SELECT count(*) AS should_be_1
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'source_streams'
  AND column_name = 'window_floor';
```

> **Numbering note.** The unmerged `batch5/retention-purge` branch also carries a
> migration numbered 0015 (`connection_archive`), created before this one. When
> that branch is rebased onto main its migration must be regenerated as 0016 —
> two different 0015s in one journal is a state drizzle cannot resolve. The SQL
> itself is unaffected; only the file name and journal entry change.

---

## 0017 — `backfill_jobs` (batch 6 — apply BEFORE the lane's code lands)

**This is the first commit of the backfill batch and nothing reads the table
yet. That is deliberate.** 0013, 0014 and 0015 all shipped to main alongside
code that read them, which is the 0012 failure repeated — so this migration goes
in on its own, ahead of its readers, and the code that depends on it does not
land until this is applied.

Numbered 0017, not 0016: the unmerged `batch5/retention-purge` branch holds 0016
(`connection_archive`). Applying 0017 before 0016 exists is fine — they are
independent, both purely additive, and neither references the other.

One new table, nothing altered.

Why a table rather than columns on `source_streams`: a stream can be deepened
more than once (30 days, then 90, then a year), and each attempt has its own
target, outcome and reason for stopping. Columns would overwrite the record of
the previous attempt, which is exactly the missing bookkeeping that makes an
interrupted import unresumable.

```sql
CREATE TABLE IF NOT EXISTS "backfill_jobs" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"           text NOT NULL,
  "connection_id"    uuid NOT NULL,
  "stream_id"        uuid NOT NULL,
  "stream_hash"      text NOT NULL,
  "status"           text DEFAULT 'queued' NOT NULL,
  "target_floor"     timestamp with time zone NOT NULL,
  "reached_floor"    timestamp with time zone,
  "checkpoint"       text,
  "rows_imported"    integer DEFAULT 0 NOT NULL,
  "row_ceiling"      integer NOT NULL,
  "detail"           text,
  "attempts"         integer DEFAULT 0 NOT NULL,
  "last_progress_at" timestamp with time zone,
  "started_at"       timestamp with time zone,
  "finished_at"      timestamp with time zone,
  "created_at"       timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"       timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "backfill_jobs_stream_target_uq"
  ON "backfill_jobs" USING btree ("stream_id", "target_floor");

CREATE INDEX IF NOT EXISTS "backfill_jobs_status_progress_idx"
  ON "backfill_jobs" USING btree ("status", "last_progress_at");

CREATE INDEX IF NOT EXISTS "backfill_jobs_org_idx"
  ON "backfill_jobs" USING btree ("org_id");
```

The unique index is load-bearing, not tidiness: it is how "never re-import"
(6.1) is enforced. Asking for a depth this stream already has finds the existing
job rather than starting a second one, so a second flow on a backfilled stream
costs zero provider calls and only a DEEPER floor is new work.

Verify:

```sql
SELECT
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name='backfill_jobs')                AS table_present,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='backfill_jobs')                AS columns_should_be_18,
  (SELECT count(*) FROM pg_indexes
    WHERE schemaname='public' AND indexname='backfill_jobs_stream_target_uq')  AS unique_idx;
```

Expect 1, 18, 1.

---

## 0018 — `source_streams.date_field`, `restamp_requested_at`, `date_field_state` (batch 7 — apply BEFORE the connector change lands)

Which column of a spreadsheet holds a row's event time, whether a restamp of
existing rows is owed, and what the last read actually did with that column.

All three additive and nullable, and nothing reads them: this follows the same
shape as 0017 (`fb60f52`, "the backfill lane's schema, alone and ahead of its
readers"). Applying it changes no behaviour — every existing row reads NULL.

Step 3 above applies with its usual force, and concretely here: the declaration
alone makes `activeStreams` (the sweep's work list), `primeStream` (the Test
button, twice) and the backfill lane's stream load all NAME these columns. Paste
this before `batch7/sheet-date-column` reaches main and there is nothing to think
about; deploy first and those three throw together.

**Why it exists.** The Sheets poll stamps `occurred_at` with `new Date()` — the
import moment — and `preserveOccurredAt` then freezes it there. Every time-based
metric over a sheet has been measuring when the data was imported. The sheet's
real date was in a column the whole time, and `src/lib/normalize-dates.ts` was
already parsing exactly those shapes into `properties` and never into
`occurred_at`.

**Why per stream.** `occurred_at` is a fact about a ROW, and a stream's rows are
shared by every flow reading it. Per-flow config would let two flows disagree
about when one row happened, with the last sweep to read a graph silently
restamping the other's numbers; putting the column in the config HASH instead
would fork the stream and re-import its history. Two tabs of one workbook are
two streams and get independent columns, which is correct.

**Why `restamp_requested_at` is a timestamp and not a flag.** A restamp that
never fires is otherwise indistinguishable from one that already completed. The
known way for it to never fire is the `modifiedTime` skip — a settled sheet is
not re-read at all.

**What the restamp does, corrected.** Rows with no date in the chosen column are
stamped from `events.received_at`, not left to `preserveOccurredAt`. Preserve
keeps whatever is STORED, which after any earlier restamp is the PREVIOUS
column's date rather than first-seen — and clearing the picker back to "first
seen" would otherwise change nothing at all, making it a one-way door.
`received_at` survives every upsert and full re-sync untouched, so it is the
first-seen that can actually be recovered. See the comment on `restamp_requested_at`
in `src/db/schema.ts`.

```sql
ALTER TABLE "source_streams" ADD COLUMN IF NOT EXISTS "date_field" text;
ALTER TABLE "source_streams" ADD COLUMN IF NOT EXISTS "restamp_requested_at" timestamp with time zone;
ALTER TABLE "source_streams" ADD COLUMN IF NOT EXISTS "date_field_state" jsonb;
```

Verify:

```sql
SELECT count(*) AS should_be_3
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'source_streams'
  AND column_name IN ('date_field', 'restamp_requested_at', 'date_field_state');
```

No backfill and no default. Every existing stream reads NULL, which means
"first-seen" — exactly what those rows already are. Nothing is rewritten by
applying this.

> **Numbering note.** 0016 remains reserved by the unmerged
> `batch5/retention-purge` branch (`connection_archive`). This is 0018 rather
> than 0016 so the two cannot collide in one journal.
>
> **And renumbering that branch is not enough.** Drizzle's snapshots are a
> CHAIN: each `drizzle/meta/NNNN_snapshot.json` records `prevId` and the full
> schema as of that point. `batch5`'s snapshot forks from 0015 — it was written
> before 0017 and 0018 existed — so its picture of `source_streams` has neither
> `backfill_jobs` nor `date_field`. Renaming the file to 0019 would leave a
> journal whose 0019 claims a predecessor that is not 0018, and the next
> `db:generate` on main would then diff against a schema missing three columns
> and try to add them a second time. At merge time, regenerate: rebase the
> branch, delete its migration and snapshot, and re-run `pnpm db:generate` so
> the SQL is emitted against the real head. The SQL itself will come out the
> same — `connection_archive` is a new table that touches nothing else — but
> the chain will be intact, which is the part the tooling actually reads.
> Main's own 0017 has the same shape and is already correct only because it was
> generated after 0015 was merged.

---

## 0019 — `source_streams.date_field_locked` (batch 8 — apply BEFORE the auto-detect code lands)

**One boolean, and a backfill that is not optional.** Nothing reads the column
yet; the detector, the runner change and the picker's "Detect automatically"
land after this SQL is applied. Same ordering rule as 0017 and 0018, and the
same reason: `db.select().from(sourceStreams)` expands to an explicit column
list from `schema.ts`, so declaring the column makes `activeStreams`,
`primeStream` and the backfill lane's stream load NAME it. Deployed before the
SQL is applied, all of them throw together.

**Why a column and not a sentinel.** `date_field` is nullable and NULL means "no
column", but there are two ways to be there and they need opposite treatment: a
stream nobody has touched should be dated from whatever column can be detected,
and a stream whose owner deliberately chose "use import time" must be left
alone. Encoding the second as an empty string works and reads as a bug to
whoever finds it next; one boolean says what it means.

**The detection itself is stored nowhere.** It is recomputed from the header row
and the values on every read, so `date_field` keeps exactly one meaning — the
user's answer — and the sweep never writes to a column the picker owns. What a
read actually used goes in `date_field_state`, which already means "what
happened", and whose shape gains `source` and `candidates` — jsonb, so no DDL.

```sql
ALTER TABLE "source_streams" ADD COLUMN IF NOT EXISTS "date_field_locked" boolean DEFAULT false NOT NULL;
UPDATE "source_streams" SET "date_field_locked" = true WHERE "date_field" IS NOT NULL;
```

**Run both.** The default of `false` is right for a stream nobody has answered
for, and wrong for one where somebody already picked a column — without the
UPDATE, every existing explicit choice becomes re-decidable by the detector on
the next sweep, and a stream whose owner picked "Submitted at" over an equally
date-like "Created" would silently flip. The UPDATE is idempotent and safe to
re-run.

Verify:

```sql
SELECT count(*) AS should_be_1
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'source_streams'
  AND column_name = 'date_field_locked';

-- and that the backfill ran: every stream with a column is locked.
SELECT count(*) AS should_be_0
FROM source_streams
WHERE date_field IS NOT NULL AND date_field_locked = false;
```

> **Numbering note.** 0016 is still reserved by the unmerged
> `batch5/retention-purge` branch, and the snapshot-chain warning under 0018
> applies to this migration too — batch5 now forks three migrations behind main,
> not two.

---

## 0020 — four indexes the hot paths were missing, two dead ones dropped

Pure DDL, no table or column changes, so ordering against code deploys is
relaxed for once: the code runs correctly without these indexes, just slower.
Apply it before `STORAGE_PRUNE_LIVE` is ever flipped, though — two of the four
exist so the first live prune finishes (checklist 7b).

What each one is for:

- `connections_due_sweep_idx` — the sweep's work-list query
  (`dueConnectionsForSweep`) runs every 10 minutes against the whole table and
  only had the three-value `status` index to lean on: a full scan of active
  connections per tick. Partial on `status = 'active'` because that is the only
  status the sweep dispatches.
- `dead_letter_raw_event_idx` — raw_events retention runs a
  `NOT EXISTS (… WHERE dead_letter.raw_event_id = raw_events.id …)` per
  candidate row; without this, each candidate scans the whole dead_letter
  table from inside the prune of the largest table.
- `delivery_log_created_idx` — retention filters `created_at < now() - 30d`
  and the existing indexes lead on `connection_id` / `status`; sequential scan
  otherwise.
- `flow_results_status_idx` — the 10-minute recompute asks `status = 'stale'`
  fleet-wide, and the dashboard counts non-fresh tiles per org.

The two drops are write-cost with zero read value, both on high-write tables:
`raw_events_conn_idx` is a strict prefix of `raw_events_conn_received_idx`
(a btree on `(a, b)` answers every `a`-only query), and `usage_ledger_org_idx`
has no query site anywhere in the code — nothing has ever read the busiest
table by org alone.

Deliberately NOT added: `raw_events(received_at)` alone. The audit flagged it,
but the retention predicate has since changed (D1): it now leads with an
`EXISTS` against disabled connections, so the planner drives from the few
disabled connection rows into `raw_events_conn_received_idx`. A bare
`received_at` index would be one more thing to maintain on the highest-write
table, serving no surviving query shape.

```sql
DROP INDEX IF EXISTS "raw_events_conn_idx";
DROP INDEX IF EXISTS "usage_ledger_org_idx";

CREATE INDEX IF NOT EXISTS "connections_due_sweep_idx"
  ON "connections" USING btree ("next_sweep_at")
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS "dead_letter_raw_event_idx"
  ON "dead_letter" USING btree ("raw_event_id");

CREATE INDEX IF NOT EXISTS "delivery_log_created_idx"
  ON "delivery_log" USING btree ("created_at");

CREATE INDEX IF NOT EXISTS "flow_results_status_idx"
  ON "flow_results" USING btree ("status");
```

Plain `CREATE INDEX` takes a write lock on its table for the build. Fine at
today's sizes; on a table that has since grown large (`delivery_log` is the
likely one), use `CREATE INDEX CONCURRENTLY` instead — run it as its own
statement outside any transaction, and re-check with the verify query because
a concurrent build can fail and leave an INVALID index behind (same caveat as
0014).

Verify:

```sql
SELECT
  (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname IN
    ('connections_due_sweep_idx','dead_letter_raw_event_idx',
     'delivery_log_created_idx','flow_results_status_idx'))          AS created_should_be_4,
  (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname IN
    ('raw_events_conn_idx','usage_ledger_org_idx'))                  AS dropped_should_be_0,
  (SELECT count(*) FROM pg_index WHERE NOT indisvalid AND
    indexrelid::regclass::text IN
    ('connections_due_sweep_idx','dead_letter_raw_event_idx',
     'delivery_log_created_idx','flow_results_status_idx'))          AS invalid_should_be_0;
```

`scripts/schema-audit.sql` query 2 knows about all six changes — a clean run
after this paste shows 34 `ok` rows and no `MISSING INDEX`.

> **Numbering note.** 0016 remains reserved by the unmerged
> `batch5/retention-purge` branch; the snapshot-chain warning under 0018
> still applies at merge time.

---

## 0021 — stream_fields: collapse null-hash duplicates, rebuild the unique index NULLS NOT DISTINCT

**Why.** `stream_hash` is NULL for connection-scoped sources (Close, Sendblue,
webhook), and Postgres unique indexes default to treating NULLs as distinct —
so `recordFields`' upsert never conflicted for those scopes and every poll
page inserted a fresh row per field path. Unbounded duplicate rows on the
busiest write path, an inflated field list in the pickers, and a dedupe
warning computed off one fragment of the counts.

**Order inside the block matters and is already correct:** the merge runs
before the index swap, because the new index cannot build over the duplicates
it exists to prevent. The merge folds duplicates exactly the way the writer
folds batches — `seen_count` sums, `approx_cardinality` takes the max,
`first_seen` the min, `last_seen` the max, `inferred_type` keeps the first
non-`'null'`, and the surviving row is the earliest-inserted one (whose
insert-only `sample` is the one the writer would have kept).

Paste the whole block; it is idempotent in effect (a second run finds no
duplicates and rebuilds the same index):

```sql
WITH dupes AS (
  SELECT
    connection_id,
    field_path,
    min(first_seen) AS first_seen,
    max(last_seen) AS last_seen,
    sum(seen_count)::int AS seen_count,
    max(approx_cardinality) AS approx_cardinality,
    (array_agg(inferred_type ORDER BY (inferred_type = 'null'), first_seen, id))[1] AS inferred_type,
    (array_agg(id ORDER BY first_seen, id))[1] AS keep_id
  FROM "stream_fields"
  WHERE stream_hash IS NULL
  GROUP BY connection_id, field_path
  HAVING count(*) > 1
)
UPDATE "stream_fields" sf
SET
  seen_count = d.seen_count,
  approx_cardinality = d.approx_cardinality,
  first_seen = d.first_seen,
  last_seen = d.last_seen,
  inferred_type = d.inferred_type
FROM dupes d
WHERE sf.id = d.keep_id;

WITH dupes AS (
  SELECT
    connection_id,
    field_path,
    (array_agg(id ORDER BY first_seen, id))[1] AS keep_id
  FROM "stream_fields"
  WHERE stream_hash IS NULL
  GROUP BY connection_id, field_path
  HAVING count(*) > 1
)
DELETE FROM "stream_fields" sf
USING dupes d
WHERE sf.stream_hash IS NULL
  AND sf.connection_id = d.connection_id
  AND sf.field_path = d.field_path
  AND sf.id <> d.keep_id;

DROP INDEX IF EXISTS "stream_fields_key_uq";

CREATE UNIQUE INDEX IF NOT EXISTS "stream_fields_key_uq"
  ON "stream_fields" USING btree ("connection_id","stream_hash","field_path")
  NULLS NOT DISTINCT;
```

Verify (expect `0` and `1`):

```sql
SELECT
  (SELECT count(*) FROM (
     SELECT 1 FROM stream_fields WHERE stream_hash IS NULL
     GROUP BY connection_id, field_path HAVING count(*) > 1
   ) g)                                                            AS dup_groups_should_be_0,
  (SELECT count(*) FROM pg_indexes
    WHERE schemaname='public' AND indexname='stream_fields_key_uq'
      AND indexdef LIKE '%NULLS NOT DISTINCT%')                    AS nnd_index_should_be_1;
```

> **Why `schema.ts` cannot say this.** drizzle-orm 0.45 only exposes
> `nullsNotDistinct()` on `unique()` table constraints, and drizzle-kit's
> snapshot has no field for it on indexes — so the `uniqueIndex` declaration
> keeps its name and columns, this file carries the null semantics, and no
> later `db:generate` can emit a spurious diff (the tool cannot represent
> what it would be "correcting"). The comment on the declaration in
> `src/db/schema.ts` records the same thing.

---

## 0022 — drop the three identity-mirror tables nothing ever read

WorkOS is the source of truth for organizations, users and memberships; the
`orgId` on every domain table is the WorkOS organization id, derived only from
the authenticated session. A reference census found `users` and `memberships`
were never read OR written by any application code, and `organizations` had
exactly one write (a best-effort insert at org creation) and zero reads. A
mirror with no reader can only drift into a lie, and every table is one more
surface the drift check and retention register must carry — so all three go.

The only code change alongside this is the removal of that one write
(`src/app/actions.ts`); nothing else referenced these tables.

Safe to apply before or after deploying the code: the old code's mirror write
is wrapped in a try/catch that swallows failure (it was best-effort by
design), so old-code-against-new-schema degrades to exactly the no-op it
already was in environments without a database.

```sql
DROP TABLE IF EXISTS "memberships" CASCADE;
DROP TABLE IF EXISTS "users" CASCADE;
DROP TABLE IF EXISTS "organizations" CASCADE;
```

Verify (expect 0):

```sql
SELECT count(*) AS should_be_0
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('organizations', 'users', 'memberships');
```

`scripts/schema-audit.sql` was regenerated: 15 tables, and
`memberships_org_user_uq` is gone from the expected-index list.

## 0023 — `events_conn_type_live_idx` (the Record type picker's index)

**Pure DDL, ordering relaxed** (0020's precedent): the code is correct
without it, just slower. Apply before real traffic grows the events table.

One index, nothing altered. The flow editor's Record type dropdown now asks a
fresh per-connection question on every Configure-panel open — "which distinct
event types does THIS connection hold, live rows only" — instead of riding a
stale org-wide snapshot taken at page render. `events_org_type_idx` leads
with `org_id` and is not partial on `deleted_at`, so it cannot serve that
shape alone; without this index every panel open aggregates the connection's
whole live history.

```sql
CREATE INDEX IF NOT EXISTS "events_conn_type_live_idx"
  ON "events" USING btree ("connection_id", "event_type")
  WHERE deleted_at is null;
```

On a large events table, prefer the non-blocking variant (own statement, and
re-check validity after — same caveat as 0014/0020):

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "events_conn_type_live_idx"
  ON "events" USING btree ("connection_id", "event_type")
  WHERE deleted_at is null;
```

Verify (expect 1, 0):

```sql
SELECT
  (SELECT count(*) FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'events_conn_type_live_idx')                    AS created_should_be_1,
  (SELECT count(*) FROM pg_index
    WHERE NOT indisvalid
      AND indexrelid::regclass::text = 'events_conn_type_live_idx')   AS invalid_should_be_0;
```

Numbering note: 0016 remains reserved by the unmerged `batch5/retention-purge`
branch (see the notes under 0015/0017); the snapshot-chain warning there still
applies at merge time.

---

## 0024 — `workspace_ranks` + `rank_assignments` (ranks — apply BEFORE the permissions code lands)

Two new tables, nothing altered. Same ordering rule as 0017/0018/0019 and the
same reason: declaring a table in `schema.ts` is enough for the drift check to
demand it, and the settings page, `effectiveAccess` and the assignment actions
all read these the moment they deploy.

**The model.** A rank is a named bundle of permissions + visible metric keys
(`flow:<flowId>` / `metric:<metricId>`) that an admin assigns to members.
`inherits` holds OTHER rank ids whose EFFECTIVE sets union in at read time —
live inheritance, resolved per access check by `resolveRank`
(src/lib/permissions.ts), never copied: edit the parent and every inheritor
follows. Resolution is cycle-safe and skips deleted parents, so the id lists
carry no foreign keys.

**Why applying this changes no behaviour.** Access rules make the empty state a
no-op: admins are never restricted, and a member with NO assignment row keeps
FULL access — restrictions begin only when a rank is assigned. Empty tables
mean nobody has an assignment, so every existing workspace works exactly as
before with zero setup.

The composite primary key on `rank_assignments` is the rule "one rank per
member", enforced in the database: an assignment is an upsert, never a second
row, so "your rank" always has exactly one answer.

```sql
CREATE TABLE IF NOT EXISTS "workspace_ranks" (
  "id"              text PRIMARY KEY NOT NULL,
  "org_id"          text NOT NULL,
  "name"            text NOT NULL,
  "all_permissions" boolean DEFAULT false NOT NULL,
  "permissions"     jsonb DEFAULT '[]'::jsonb NOT NULL,
  "all_metrics"     boolean DEFAULT false NOT NULL,
  "metric_keys"     jsonb DEFAULT '[]'::jsonb NOT NULL,
  "inherits"        jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at"      timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "rank_assignments" (
  "org_id"      text NOT NULL,
  "user_id"     text NOT NULL,
  "rank_id"     text NOT NULL,
  "assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "rank_assignments_pk" PRIMARY KEY ("org_id","user_id")
);

CREATE INDEX IF NOT EXISTS "workspace_ranks_org_idx"
  ON "workspace_ranks" USING btree ("org_id");

CREATE UNIQUE INDEX IF NOT EXISTS "workspace_ranks_org_name_uq"
  ON "workspace_ranks" USING btree ("org_id","name");

CREATE INDEX IF NOT EXISTS "rank_assignments_org_rank_idx"
  ON "rank_assignments" USING btree ("org_id","rank_id");
```

Verify:

```sql
SELECT
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema='public'
      AND table_name IN ('workspace_ranks','rank_assignments'))        AS tables_should_be_2,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='workspace_ranks')      AS columns_should_be_9,
  (SELECT count(*) FROM pg_indexes
    WHERE schemaname='public' AND indexname IN
      ('workspace_ranks_org_idx','workspace_ranks_org_name_uq',
       'rank_assignments_org_rank_idx','rank_assignments_pk'))         AS indexes_should_be_4;
```

Expect 2, 9, 4 (the primary key counts as an index).

`scripts/schema-audit.sql` was regenerated alongside this: 17 tables, 185
columns — a clean run after the paste is still a screen of `ok`.

> **Numbering note.** 0016 is still reserved by the unmerged
> `batch5/retention-purge` branch, and the snapshot-chain warning under 0018
> applies here too at merge time.
