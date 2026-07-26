/**
 * READ-ONLY database inspector. Runs a single SELECT-style statement passed as
 * argv[2] and prints the rows as JSON.
 *
 * Deliberately refuses anything that is not a read: this exists to diagnose
 * migration state on a production database, where an accidental DDL/DML would
 * be unrecoverable.
 *
 *   DATABASE_URL="postgresql://…" pnpm tsx scripts/db-inspect.ts "select 1"
 */
import { neon } from "@neondatabase/serverless";

const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|comment|copy|vacuum|reindex|refresh|call|do|merge)\b/i;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Set DATABASE_URL");
    process.exit(2);
  }
  const statement = process.argv[2];
  if (!statement) {
    console.error("Pass one SQL statement as the first argument.");
    process.exit(2);
  }
  if (FORBIDDEN.test(statement)) {
    console.error("REFUSED: statement contains a write/DDL keyword. This tool is read-only.");
    process.exit(2);
  }
  const sql = neon(url);
  const rows = await sql.query(statement);
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((e) => {
  console.error(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

export {};
