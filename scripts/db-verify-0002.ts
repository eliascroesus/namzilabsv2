/**
 * ONE-TIME post-migration verification for migration 0002.
 * Confirms 3 migrations are recorded and every 0002 object exists.
 * Delete this file (and its workflow) after the one-time baseline succeeds.
 */
import { neon } from "@neondatabase/serverless";

const URL = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;

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
  console.error(`\n❌ VERIFY FAILED: ${redact(msg)}`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (!URL) fail("DATABASE_MIGRATION_URL (or DATABASE_URL) is not set.");
  const sql = neon(URL);

  console.log("── Verifying migration history ──");
  const mig = await sql`select count(*)::int as c from drizzle.__drizzle_migrations`;
  const count = Number(mig[0].c);
  if (count !== 3) fail(`Expected exactly 3 recorded migrations, found ${count}.`);
  ok("3 migrations are recorded (0000, 0001, 0002).");

  console.log("── Verifying new tables ──");
  for (const t of V0002_TABLES) {
    const r = await sql`select 1 from information_schema.tables where table_schema='public' and table_name=${t} limit 1`;
    if (r.length === 0) fail(`Table "public.${t}" is missing.`);
    ok(`Table "${t}" exists.`);
  }

  console.log("── Verifying new columns ──");
  for (const [tbl, col] of V0002_COLUMNS) {
    const r =
      await sql`select 1 from information_schema.columns where table_schema='public' and table_name=${tbl} and column_name=${col} limit 1`;
    if (r.length === 0) fail(`Column "${tbl}.${col}" is missing.`);
    ok(`Column "${tbl}.${col}" exists.`);
  }

  console.log("\n✅ VERIFY OK — migration 0002 is fully applied and recorded.");
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
