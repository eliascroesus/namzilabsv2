/**
 * ONE-TIME baseline for production.
 *
 * Migrations 0000 and 0001 were applied to production by hand, so Drizzle's
 * migration history (drizzle.__drizzle_migrations) does not know about them.
 * This script safely reconciles that WITHOUT modifying any application data:
 *
 *   1. Verifies the tables/columns that 0000 and 0001 create already exist.
 *   2. Verifies migration 0002 is NOT already applied.
 *   3. If the migration-history table is missing/empty, creates it (exactly as
 *      Drizzle's neon-http migrator would) and records 0000 + 0001 using the
 *      exact hashes + timestamps from the repo's migration files/journal.
 *
 * It never runs 0002 — the workflow runs `pnpm db:migrate` afterwards, which
 * then applies ONLY 0002. Aborts safely (no writes) on any mismatch.
 *
 * Delete this file (and its workflow) after the one-time baseline succeeds.
 */
import { neon } from "@neondatabase/serverless";
import { readMigrationFiles } from "drizzle-orm/migrator";

const URL = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;

const EXPECTED_0000_TABLES = [
  "organizations",
  "users",
  "memberships",
  "connections",
  "webhook_endpoints",
  "raw_events",
  "events",
  "sync_state",
  "delivery_log",
  "dead_letter",
];
const EXPECTED_0001_TABLES = ["metrics"];
const V0002_TABLES = ["flows", "flow_versions", "flow_results"];
const V0002_COLUMNS: Array<[string, string]> = [
  ["connections", "sync_status"],
  ["connections", "sync_generation"],
  ["connections", "historical_synced_at"],
  ["events", "sync_generation"],
  ["events", "deleted_at"],
];

function redact(s: string): string {
  return URL ? s.split(URL).join("[REDACTED_DB_URL]") : s;
}
function ok(msg: string): void {
  console.log(`  ✓ ${msg}`);
}
function fail(msg: string): never {
  console.error(`\n❌ BASELINE ABORTED (no changes made): ${redact(msg)}`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (!URL) fail("DATABASE_MIGRATION_URL (or DATABASE_URL) is not set.");
  const sql = neon(URL);

  const tableExists = async (schema: string, name: string): Promise<boolean> => {
    const r = await sql`select 1 from information_schema.tables where table_schema=${schema} and table_name=${name} limit 1`;
    return r.length > 0;
  };
  const columnExists = async (table: string, col: string): Promise<boolean> => {
    const r =
      await sql`select 1 from information_schema.columns where table_schema='public' and table_name=${table} and column_name=${col} limit 1`;
    return r.length > 0;
  };

  console.log("── Pre-flight: verifying existing 0000/0001 schema ──");
  for (const t of [...EXPECTED_0000_TABLES, ...EXPECTED_0001_TABLES]) {
    if (!(await tableExists("public", t))) {
      fail(`Expected table "public.${t}" (from migration 0000/0001) is missing. The database does not match expectations.`);
    }
  }
  ok(`All ${EXPECTED_0000_TABLES.length + EXPECTED_0001_TABLES.length} tables from migrations 0000 and 0001 are present.`);

  console.log("── Pre-flight: ensuring migration 0002 is not already applied ──");
  for (const t of V0002_TABLES) {
    if (await tableExists("public", t)) {
      fail(`Table "public.${t}" (migration 0002) already exists — 0002 appears already applied. Aborting.`);
    }
  }
  for (const [tbl, col] of V0002_COLUMNS) {
    if (await columnExists(tbl, col)) {
      fail(`Column "${tbl}.${col}" (migration 0002) already exists — 0002 appears already applied. Aborting.`);
    }
  }
  ok("Migration 0002 objects are absent (as expected).");

  // Exact hashes + timestamps from the repo's migration files + journal.
  const metas = readMigrationFiles({ migrationsFolder: "drizzle" })
    .slice()
    .sort((a, b) => a.folderMillis - b.folderMillis);
  if (metas.length < 3) fail(`Expected at least 3 migration files in ./drizzle, found ${metas.length}.`);
  const [m0000, m0001] = metas;

  console.log("── Drizzle migration history ──");
  const historyExists = await tableExists("drizzle", "__drizzle_migrations");
  let count = 0;
  if (historyExists) {
    const r = await sql`select count(*)::int as c from drizzle.__drizzle_migrations`;
    count = Number(r[0].c);
  }

  if (historyExists && count >= 2) {
    ok(`Migration history already contains ${count} row(s); no baseline needed.`);
  } else if (historyExists && count === 1) {
    fail("Migration history has exactly 1 row (incomplete/unexpected state). Aborting for safety.");
  } else {
    // Match Drizzle's neon-http migrator table exactly, then baseline 0000 + 0001.
    await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
    await sql`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`;
    for (const m of [m0000, m0001]) {
      await sql`
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        SELECT ${m.hash}, ${m.folderMillis}
        WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = ${m.folderMillis})`;
    }
    const r = await sql`select count(*)::int as c from drizzle.__drizzle_migrations`;
    ok(`Baselined migrations 0000 and 0001 into Drizzle history (${Number(r[0].c)} row(s) recorded).`);
  }

  console.log("\n✅ Baseline step complete. `pnpm db:migrate` will now apply ONLY migration 0002.");
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
