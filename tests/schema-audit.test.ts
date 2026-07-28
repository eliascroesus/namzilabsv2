import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { auditSqlFile, compareSchema, driftBlocks, expectedSchema } from "@/lib/schema-audit";
import type { DB } from "@/db/types";

/**
 * The gap these tests exist for: every OTHER test in this suite builds a fresh
 * database from the migration files, so the whole suite proves code matches
 * MIGRATIONS and can say nothing about the hand-edited database in production.
 *
 * So these tests take the one database they can build and then damage it, to
 * check the comparison notices. The damage in the first case is exactly the
 * damage production had.
 */

let db: DB;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

describe("schema drift — against a database, not against the migration files", () => {
  it("finds nothing wrong with a database that has every migration applied", async () => {
    const report = await compareSchema(db);
    expect(report.missingTables).toEqual([]);
    expect(report.missingColumns).toEqual([]);
    expect(report.typeDrift).toEqual([]);
    expect(report.nullabilityDrift).toEqual([]);
    expect(report.missingIndexes).toEqual([]);
    expect(driftBlocks(report)).toBe(false);
  });

  /**
   * THE case. Migration 0012 adds these two columns and was never applied to
   * production, so `withConnectionSyncLock` — the sweep, the Test button, a
   * manual re-sync — threw on every call while this suite stayed green.
   */
  it("catches the 0012 columns being absent, which is what actually happened", async () => {
    await db.execute(sql`alter table sync_state drop column sync_lock_until, drop column sync_lock_token`);

    const report = await compareSchema(db);
    expect(report.missingColumns).toEqual([
      { table: "sync_state", column: "sync_lock_until", sqlType: "timestamp with time zone" },
      { table: "sync_state", column: "sync_lock_token", sqlType: "text" },
    ]);
    expect(driftBlocks(report)).toBe(true); // loud, not a warning
  });

  it("reports a missing table once, not once per column it would have had", async () => {
    await db.execute(sql`drop table flow_results`);

    const report = await compareSchema(db);
    expect(report.missingTables).toEqual(["flow_results"]);
    expect(report.missingColumns.filter((c) => c.table === "flow_results")).toEqual([]);
    expect(driftBlocks(report)).toBe(true);
  });

  it("notices a column that exists but is nullable where the code says NOT NULL", async () => {
    await db.execute(sql`alter table connections alter column org_id drop not null`);

    const report = await compareSchema(db);
    expect(report.nullabilityDrift).toEqual([
      { table: "connections", column: "org_id", expected: "NOT NULL", actual: "NULL" },
    ]);
    // Reported, but it does not stop a deploy: the query still runs, it just may
    // hand back a null the code never expected.
    expect(driftBlocks(report)).toBe(false);
  });

  /**
   * A missing index is the opposite kind of problem — every answer stays
   * correct and the query is slower. Blocking on it would train people to
   * ignore the check that also reports real outages.
   */
  it("warns about a missing index without calling it a failure", async () => {
    await db.execute(sql`drop index events_org_live_occurred_idx`);

    const report = await compareSchema(db);
    expect(report.missingIndexes).toEqual([{ table: "events", index: "events_org_live_occurred_idx" }]);
    expect(driftBlocks(report)).toBe(false);
  });

  it("does not mistake a hand-added column for something broken", async () => {
    await db.execute(sql`alter table connections add column scratch_note text`);

    const report = await compareSchema(db);
    expect(report.unexpectedColumns).toEqual([{ table: "connections", column: "scratch_note" }]);
    expect(driftBlocks(report)).toBe(false);
  });
});

/**
 * A drift checker that has itself drifted is worse than none: it would report a
 * clean bill of health against a schema nobody runs any more.
 */
describe("the pasteable SQL cannot go stale", () => {
  it("matches what the current schema would generate", () => {
    expect(readFileSync("scripts/schema-audit.sql", "utf8")).toBe(auditSqlFile());
  });

  it("covers every table and column the code declares", () => {
    const expected = expectedSchema();
    const file = readFileSync("scripts/schema-audit.sql", "utf8");
    for (const table of expected) {
      for (const column of table.columns) {
        expect(file, `${table.name}.${column.name} is missing from the audit SQL`).toContain(
          `('${table.name}', '${column.name}')`,
        );
      }
    }
    expect(expected.reduce((n, t) => n + t.columns.length, 0)).toBeGreaterThan(100);
  });
});
