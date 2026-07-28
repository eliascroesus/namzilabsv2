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
