import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";

/**
 * THE MIGRATOR PATH IS GONE, AND MUST STAY GONE.
 *
 * Every migration in this project is applied BY HAND via the pasteable blocks
 * in drizzle/HAND_APPLY.md — drizzle's tracker "has never matched reality"
 * (HAND_APPLY.md's own words), so a migrator run would replay migrations the
 * database already has. The script, its gate, and the manual db-migrate
 * workflow were all removed rather than maintained as a path the docs said
 * never to use. This test pins the absence, so the footgun cannot quietly
 * come back in a refactor or a template.
 *
 * (tests/helpers/testdb.ts's PGlite migrator is unrelated and stays: it
 * builds throwaway test databases from the migration FILES, which is exactly
 * the hand-apply procedure, simulated.)
 */
describe("the drizzle-migrator footgun stays removed", () => {
  it("no db:migrate script, no migrator entrypoint, no workflow", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.["db:migrate"]).toBeUndefined();
    expect(existsSync("src/db/migrate.ts")).toBe(false);
    expect(existsSync(".github/workflows/db-migrate.yml")).toBe(false);
  });
});

/**
 * 0003 STAYS DISARMED — the two assertions the deleted workflow used to
 * carry, ported here so the protection outlives it.
 *
 * `0003_wipe_flows.sql` originally DELETEd every flow, flow_version and
 * flow_result; it was disarmed to `SELECT 1;` on 2026-07-25 and its journal
 * stamp corrected. Nothing else in the repo asserts either fact, and two
 * hardcoded references (LAUNCH_DAY.md's sha256 of the disarmed file,
 * scripts/migration-state-diagnostic.sql's hash map) silently depend on the
 * file never changing. The test-database replay cannot catch a re-arm — a
 * DELETE against an empty PGlite is a harmless no-op — so this is the one
 * place that would go loud.
 */
describe("0003_wipe_flows stays disarmed", () => {
  it("the journal does not carry the armed stamp", () => {
    const journal = readFileSync("drizzle/meta/_journal.json", "utf8");
    expect(journal).not.toContain("1785600000000");
  });

  it("the migration file contains no live DELETE", () => {
    const sql = readFileSync("drizzle/0003_wipe_flows.sql", "utf8");
    // Line-leading DELETE FROM only — the disarm rationale's commented-out
    // originals (`--     DELETE FROM "flow_results";`) are allowed to stay.
    expect(/^\s*DELETE\s+FROM/m.test(sql)).toBe(false);
  });
});
