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
 * EVERY MIGRATION HAS A PASTEABLE BLOCK, AND THIS IS THE TEST THAT WAS MISSING.
 *
 * Migration 0032 was generated, committed, and never written into
 * HAND_APPLY.md. Since that file IS the procedure — the only place anybody
 * looks to find out what still needs pasting — the tables were never created.
 * The referral system shipped recording nothing, silently, because every one of
 * its writes swallows its own failure by design. It surfaced days later as an
 * error in the UI.
 *
 * Nothing could have caught it: the suite builds its own database from the
 * migration FILES, so the code and the files agreed perfectly and the only
 * disagreement was with a database no test opens. `check-schema-drift.ts` would
 * have found it, but only if somebody ran it, and the reason nobody ran it is
 * that nobody knew there was anything to apply.
 *
 * So the gate is on the DOCUMENT, which is the one artifact the process
 * actually depends on. A migration with no block here is a migration that will
 * not be applied.
 *
 * THE FLOOR IS 0013 because that is where HAND_APPLY.md starts — everything
 * before it predates the document and is long since applied. A real boundary,
 * not a way to keep the list short.
 */
describe("every migration is written up where somebody will paste it", () => {
  it("has a HAND_APPLY.md block for each migration from 0013 on", async () => {
    const { readdirSync } = await import("node:fs");
    const doc = readFileSync("drizzle/HAND_APPLY.md", "utf8");
    const documented = new Set([...doc.matchAll(/^## (\d{4})/gm)].map((m) => m[1]));

    const onDisk = readdirSync("drizzle")
      .filter((f) => /^\d{4}_.*\.sql$/.test(f))
      .map((f) => f.slice(0, 4))
      .filter((n) => n >= "0013")
      .sort();

    // Would pass vacuously on a tree where the filenames stopped matching.
    expect(onDisk.length, "no migrations found — this check would pass vacuously").toBeGreaterThan(15);

    const missing = onDisk.filter((n) => !documented.has(n));
    expect(
      missing,
      `Migration(s) with no pasteable block in drizzle/HAND_APPLY.md: ${missing.join(", ")}. ` +
        `That file is the procedure — a migration missing from it does not get applied, ` +
        `which is exactly how 0032 shipped as a silently empty feature.`,
    ).toEqual([]);
  });

  it("documents nothing that is not a migration", async () => {
    const { readdirSync } = await import("node:fs");
    const files = readdirSync("drizzle").filter((f) => /^\d{4}_.*\.sql$/.test(f));
    const doc = readFileSync("drizzle/HAND_APPLY.md", "utf8");
    const documented = [...doc.matchAll(/^## (\d{4})/gm)].map((m) => m[1]);
    const numbers = new Set(files.map((f) => f.slice(0, 4)));
    const stale = documented.filter((n) => !numbers.has(n));
    expect(stale, `Documented but no such migration file: ${stale.join(", ")}`).toEqual([]);
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
