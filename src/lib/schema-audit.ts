import { is, sql, type SQL } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * Does the database the code is TALKING TO have the tables and columns the code
 * REFERENCES?
 *
 * Nothing else in this repository asks that question. The test suite builds a
 * fresh Postgres and applies every migration in order on each run, so it proves
 * the code matches the MIGRATIONS. Production is a database that migrations have
 * been applied to BY HAND, which is a different object, and the two can disagree
 * without anything failing on the way.
 *
 * They did. Migration 0012 adds `sync_state.sync_lock_until` and
 * `sync_state.sync_lock_token`; it was never applied. `withConnectionSyncLock`
 * runs on every sync entry point — the sweep, the Test button, a manual
 * re-sync — so all three threw, in production, against a green test suite, and
 * were found by accident when an unrelated script tripped over the column.
 *
 * The comparison is deliberately made against the LIVE database rather than
 * against the migration files or drizzle's tracker. The tracker records what
 * drizzle believes it applied; it has never been the authority here, because
 * every migration in this project was applied by hand. Only the catalog knows
 * what is really there.
 */

/** A column the deployed code expects to exist. */
export type ExpectedColumn = { name: string; sqlType: string; notNull: boolean };
/** A table the deployed code expects to exist, with its columns and indexes. */
export type ExpectedTable = { name: string; columns: ExpectedColumn[]; indexes: string[] };

/**
 * The schema as the CODE understands it, read out of the drizzle table
 * definitions rather than parsed from the migration files.
 *
 * This is the right source precisely because it is what the query builder will
 * emit at runtime: if `schema.ts` names a column, some code path can ask the
 * database for it. A migration file only records an intention to create one.
 */
export function expectedSchema(): ExpectedTable[] {
  const tables: ExpectedTable[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value as never);
    tables.push({
      name: config.name,
      columns: config.columns.map((c) => ({ name: c.name, sqlType: c.getSQLType(), notNull: c.notNull })),
      indexes: config.indexes.map((i) => i.config.name).filter((n): n is string => typeof n === "string"),
    });
  }
  return tables.sort((a, b) => a.name.localeCompare(b.name));
}

export type DriftReport = {
  /** Code references a table the database does not have. Everything touching it throws. */
  missingTables: string[];
  /** Code references a column the database does not have. This is the 0012 case. */
  missingColumns: Array<{ table: string; column: string; sqlType: string }>;
  /** Present, but the wrong type — reads may coerce or fail depending on the value. */
  typeDrift: Array<{ table: string; column: string; expected: string; actual: string }>;
  /** Present, but nullable where the code assumes NOT NULL (or the reverse). */
  nullabilityDrift: Array<{ table: string; column: string; expected: string; actual: string }>;
  /** Queries still return correct answers, just slowly. Never fatal. */
  missingIndexes: Array<{ table: string; index: string }>;
  /** In the database, unknown to the code. Harmless to us; reported so it is not a surprise. */
  unexpectedColumns: Array<{ table: string; column: string }>;
};

async function rowsOf(db: DB, query: SQL): Promise<Array<Record<string, unknown>>> {
  const res = await db.execute(query);
  return (res as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? (res as unknown as Array<Record<string, unknown>>);
}

/**
 * Compare the live database against `expected`. Read-only: three SELECTs over
 * the catalog, no DDL, no writes, safe to point at production.
 */
export async function compareSchema(db: DB, expected: ExpectedTable[] = expectedSchema()): Promise<DriftReport> {
  const liveTables = new Set(
    (await rowsOf(db, sql`select table_name from information_schema.tables where table_schema = 'public'`)).map((r) =>
      String(r.table_name),
    ),
  );
  const liveColumns = new Map<string, { type: string; nullable: boolean }>();
  for (const r of await rowsOf(
    db,
    sql`select table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public'`,
  )) {
    liveColumns.set(`${String(r.table_name)}.${String(r.column_name)}`, {
      type: String(r.data_type),
      nullable: String(r.is_nullable).toUpperCase() === "YES",
    });
  }
  const liveIndexes = new Set(
    (await rowsOf(db, sql`select indexname from pg_indexes where schemaname = 'public'`)).map((r) => String(r.indexname)),
  );

  const report: DriftReport = {
    missingTables: [],
    missingColumns: [],
    typeDrift: [],
    nullabilityDrift: [],
    missingIndexes: [],
    unexpectedColumns: [],
  };

  const expectedKeys = new Set<string>();
  for (const table of expected) {
    if (!liveTables.has(table.name)) {
      // Every column of a missing table is missing too; reporting the table
      // alone keeps the output readable instead of burying it in 22 lines.
      report.missingTables.push(table.name);
      continue;
    }
    for (const column of table.columns) {
      const key = `${table.name}.${column.name}`;
      expectedKeys.add(key);
      const live = liveColumns.get(key);
      if (!live) {
        report.missingColumns.push({ table: table.name, column: column.name, sqlType: column.sqlType });
        continue;
      }
      // Only seven SQL types occur in this schema (boolean, integer, jsonb,
      // numeric, text, timestamp with time zone, uuid) and every one is spelled
      // identically by information_schema, so this comparison is exact rather
      // than a best guess. A new type that does not round-trip will show up here
      // as a false positive rather than staying silent, which is the right way
      // for the check itself to fail.
      if (live.type !== column.sqlType) {
        report.typeDrift.push({ table: table.name, column: column.name, expected: column.sqlType, actual: live.type });
      }
      if (live.nullable === column.notNull) {
        report.nullabilityDrift.push({
          table: table.name,
          column: column.name,
          expected: column.notNull ? "NOT NULL" : "NULL",
          actual: live.nullable ? "NULL" : "NOT NULL",
        });
      }
    }
    for (const index of table.indexes) {
      if (!liveIndexes.has(index)) report.missingIndexes.push({ table: table.name, index });
    }
  }

  for (const key of liveColumns.keys()) {
    const [table] = key.split(".");
    if (!liveTables.has(table)) continue;
    if (!expected.some((t) => t.name === table)) continue; // a table we do not own
    if (!expectedKeys.has(key)) report.unexpectedColumns.push({ table, column: key.slice(table.length + 1) });
  }

  return report;
}

/**
 * Does this report describe something that BREAKS the deployed code?
 *
 * Only a missing table or column does. Those are the ones where a query the
 * code will actually run refers to something the database cannot resolve, which
 * is an error at execution rather than a degradation. Type and nullability
 * drift are reported because they cause wrong answers rather than loud ones,
 * but they are too easy to trip on a legitimate hand-edit to gate a deploy on;
 * a missing index costs speed and nothing else.
 */
export function driftBlocks(report: DriftReport): boolean {
  return report.missingTables.length > 0 || report.missingColumns.length > 0;
}

const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * The same check as one self-contained read-only statement, for pasting into a
 * SQL console when there is no way to run this repository's code against the
 * database.
 *
 * Generated from `expectedSchema()` rather than written by hand, so it cannot
 * quietly describe an older schema than the code does. `tests/schema-audit`
 * fails if the committed file stops matching.
 */
export function auditSql(expected: ExpectedTable[] = expectedSchema()): string {
  const pairs: string[] = [];
  for (const table of expected) {
    if (!SAFE_IDENTIFIER.test(table.name)) throw new Error(`unsafe table name for SQL generation: ${table.name}`);
    for (const column of table.columns) {
      if (!SAFE_IDENTIFIER.test(column.name)) throw new Error(`unsafe column name for SQL generation: ${column.name}`);
      pairs.push(`    ('${table.name}', '${column.name}')`);
    }
  }
  return `WITH expected (tbl, col) AS (
  VALUES
${pairs.join(",\n")}
),
checked AS (
  SELECT
    e.tbl,
    e.col,
    CASE
      WHEN t.table_name IS NULL THEN 'MISSING TABLE'
      WHEN c.column_name IS NULL THEN 'MISSING COLUMN'
      ELSE 'ok'
    END AS status
  FROM expected e
  LEFT JOIN information_schema.tables t
    ON t.table_schema = 'public' AND t.table_name = e.tbl
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public' AND c.table_name = e.tbl AND c.column_name = e.col
)
SELECT tbl AS "table", col AS "column", status
FROM checked
ORDER BY
  CASE status WHEN 'MISSING TABLE' THEN 0 WHEN 'MISSING COLUMN' THEN 1 ELSE 2 END,
  tbl,
  col;`;
}

/** The index half, as a second standalone statement. Slow, never broken. */
export function indexAuditSql(expected: ExpectedTable[] = expectedSchema()): string {
  const pairs: string[] = [];
  for (const table of expected) {
    for (const index of table.indexes) {
      if (!SAFE_IDENTIFIER.test(index)) throw new Error(`unsafe index name for SQL generation: ${index}`);
      pairs.push(`    ('${table.name}', '${index}')`);
    }
  }
  return `WITH expected (tbl, idx) AS (
  VALUES
${pairs.join(",\n")}
)
SELECT
  e.tbl AS "table",
  e.idx AS "index",
  CASE WHEN i.indexname IS NULL THEN 'MISSING INDEX' ELSE 'ok' END AS status
FROM expected e
LEFT JOIN pg_indexes i ON i.schemaname = 'public' AND i.indexname = e.idx
ORDER BY (i.indexname IS NULL) DESC, e.tbl, e.idx;`;
}

/**
 * The whole pasteable file: header, the tables-and-columns query, then the
 * index query.
 *
 * Assembled here rather than in the script so a test can assert the committed
 * `scripts/schema-audit.sql` still matches the schema. A drift checker that has
 * itself drifted is worse than none — it would report a clean bill of health
 * against an schema nobody runs any more.
 */
export function auditSqlFile(expected: ExpectedTable[] = expectedSchema()): string {
  const columns = expected.reduce((n, t) => n + t.columns.length, 0);
  const indexes = expected.reduce((n, t) => n + t.indexes.length, 0);
  return `-- ============================================================================
-- READ-ONLY schema audit for namzilabsv2 / Neon.
-- Paste the FIRST query into the Neon SQL Editor and run it. No writes, no DDL.
--
-- GENERATED FROM src/db/schema.ts — do not hand-edit. Regenerate with:
--     pnpm tsx scripts/check-schema-drift.ts --emit-sql
--
-- Reports every table and column the deployed code references as present or
-- missing. Problems sort to the top; 'ok' rows follow, so a clean run is a
-- screen of 'ok' and nothing else.
--
-- It does NOT consult drizzle's migration tracker, on purpose. Every migration
-- here was applied by hand, so the tracker records what drizzle believes rather
-- than what exists. Only the catalog knows.
--
-- A 'MISSING COLUMN' row means code in production is throwing every time it
-- touches that column. That is how migration 0012 (sync_state.sync_lock_until,
-- sync_state.sync_lock_token) went unnoticed: it broke every sync entry point
-- while the test suite stayed green, because the tests build a fresh database
-- from the migration files and never look at this one.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- QUERY 1 — tables and columns (${expected.length} tables, ${columns} columns).
-- This is the one to run. Self-contained; nothing above is needed.
-- ---------------------------------------------------------------------------
${auditSql(expected)}

-- ---------------------------------------------------------------------------
-- QUERY 2 (optional) — indexes (${indexes} expected).
-- A missing index never breaks a query, it only makes it slow, so this is
-- separate and can be ignored while chasing a real outage.
-- ---------------------------------------------------------------------------
${indexAuditSql(expected)}
`;
}
