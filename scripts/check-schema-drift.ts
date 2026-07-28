/**
 * Does production actually have the tables and columns the deployed code
 * references? READ-ONLY — three SELECTs over the system catalog, nothing else.
 *
 *   DATABASE_URL="postgresql://…" pnpm tsx scripts/check-schema-drift.ts
 *   pnpm tsx scripts/check-schema-drift.ts --emit-sql   # regenerate the .sql
 *
 * Exit 0 = every expected table and column is present.
 * Exit 1 = something the code references is missing. Deployed code IS throwing.
 * Exit 2 = could not run (no DATABASE_URL, database unreachable).
 *
 * Deliberately says nothing about drizzle's migration tracker. Every migration
 * in this project was applied by hand, so the tracker records a belief rather
 * than a fact; the catalog is the only witness worth asking.
 */
import { writeFileSync } from "node:fs";
import { getDb } from "@/db/client";
import { auditSqlFile, compareSchema, driftBlocks, expectedSchema } from "@/lib/schema-audit";

const SQL_FILE = "scripts/schema-audit.sql";

function emit() {
  writeFileSync(SQL_FILE, auditSqlFile());
  const expected = expectedSchema();
  const columns = expected.reduce((n, t) => n + t.columns.length, 0);
  console.log(`Wrote ${SQL_FILE} — ${expected.length} tables, ${columns} columns.`);
}

async function check() {
  if (!process.env.DATABASE_URL) {
    console.error("Set DATABASE_URL to the database you want to audit.");
    process.exit(2);
  }
  const expected = expectedSchema();
  let report;
  try {
    report = await compareSchema(getDb(), expected);
  } catch (e) {
    console.error(`Could not read the database catalog: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }

  const columns = expected.reduce((n, t) => n + t.columns.length, 0);
  console.log(`Checked ${expected.length} tables and ${columns} columns declared in src/db/schema.ts.\n`);

  if (report.missingTables.length > 0) {
    console.log("MISSING TABLES — every query touching these fails:");
    for (const t of report.missingTables) console.log(`  ${t}`);
    console.log("");
  }
  if (report.missingColumns.length > 0) {
    console.log("MISSING COLUMNS — code referencing these is throwing right now:");
    for (const c of report.missingColumns) console.log(`  ${c.table}.${c.column}  (expected ${c.sqlType})`);
    console.log("");
  }
  if (report.typeDrift.length > 0) {
    console.log("TYPE DRIFT — reads may return something other than what the code expects:");
    for (const c of report.typeDrift) console.log(`  ${c.table}.${c.column}  expected ${c.expected}, found ${c.actual}`);
    console.log("");
  }
  if (report.nullabilityDrift.length > 0) {
    console.log("NULLABILITY DRIFT — a column the code treats as always-present may be null:");
    for (const c of report.nullabilityDrift) console.log(`  ${c.table}.${c.column}  expected ${c.expected}, found ${c.actual}`);
    console.log("");
  }
  if (report.missingIndexes.length > 0) {
    console.log("MISSING INDEXES — answers stay correct, queries get slower:");
    for (const i of report.missingIndexes) console.log(`  ${i.table}: ${i.index}`);
    console.log("");
  }
  if (report.unexpectedColumns.length > 0) {
    console.log("IN THE DATABASE, UNKNOWN TO THE CODE — harmless; listed so it is not a surprise:");
    for (const c of report.unexpectedColumns) console.log(`  ${c.table}.${c.column}`);
    console.log("");
  }

  if (driftBlocks(report)) {
    console.error("FAIL — the deployed code references schema this database does not have.");
    console.error("Apply the missing migration, then re-run this. Nothing here writes anything.");
    process.exit(1);
  }
  const warnings = report.typeDrift.length + report.nullabilityDrift.length + report.missingIndexes.length;
  console.log(
    warnings === 0
      ? "PASS — every table and column the code references exists, with the expected type and nullability."
      : `PASS — nothing is missing. ${warnings} warning(s) above: none of them break a query, but each is a real difference from what the code declares.`,
  );
}

async function main() {
  if (process.argv.includes("--emit-sql")) {
    emit();
    return;
  }
  await check();
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
