import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * `pnpm db:migrate` runs the REAL drizzle migrator — against a database whose
 * migration tracker "has never matched reality" (drizzle/HAND_APPLY.md), so an
 * unguarded run would replay migrations the database already has. The
 * sanctioned path is hand-pasting HAND_APPLY.md's blocks; the one legitimate
 * migrator caller is the manual-only db-migrate workflow.
 *
 * Source-measured, like tests/pool-tuning.test.ts: the property under test is
 * "the guard stands between the entrypoint and the migrator", which no
 * runtime harness can observe without actually connecting somewhere.
 */
describe("the db:migrate footgun is gated", () => {
  it("src/db/migrate.ts refuses before it migrates, pointing at HAND_APPLY.md", () => {
    const src = readFileSync("src/db/migrate.ts", "utf8");
    const guardAt = src.indexOf("DB_MIGRATE_I_UNDERSTAND");
    const migrateAt = src.indexOf("await migrate(");
    expect(guardAt).toBeGreaterThan(-1);
    expect(migrateAt).toBeGreaterThan(-1);
    // The refusal must run BEFORE the migrator can.
    expect(guardAt).toBeLessThan(migrateAt);
    expect(src).toContain("HAND_APPLY.md");
    expect(src).toContain("process.exit(1)");
  });

  it("the manual db-migrate workflow is the one caller that sets the flag", () => {
    const yml = readFileSync(".github/workflows/db-migrate.yml", "utf8");
    expect(yml).toContain('DB_MIGRATE_I_UNDERSTAND: "1"');
  });
});
