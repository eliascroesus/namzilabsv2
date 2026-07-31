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
