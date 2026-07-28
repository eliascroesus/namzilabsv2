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
