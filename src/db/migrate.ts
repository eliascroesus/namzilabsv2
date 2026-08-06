import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { migrate } from "drizzle-orm/neon-http/migrator";

async function main() {
  /**
   * REFUSES BY DEFAULT, on purpose. Every migration in this project is
   * applied BY HAND via the pasteable blocks in drizzle/HAND_APPLY.md, so
   * drizzle's migration tracker records what drizzle BELIEVES it applied —
   * which has never matched reality here (HAND_APPLY.md's own words: "do not
   * read it, and do not try to repair it"). Running this migrator against the
   * real database would replay every journal entry past the tracker's stale
   * high-water mark into a schema that already has those changes.
   *
   * The one sanctioned caller is the manual `DB Migrate (production)` GitHub
   * workflow (workflow_dispatch only), which sets the flag knowingly and
   * carries its own guards. A stray local `pnpm db:migrate` stops here.
   */
  if (process.env.DB_MIGRATE_I_UNDERSTAND !== "1") {
    // eslint-disable-next-line no-console
    console.error(
      [
        "REFUSING to run the drizzle migrator.",
        "",
        "This project applies migrations BY HAND — paste the SQL blocks from",
        "drizzle/HAND_APPLY.md into the Neon SQL Editor and verify with",
        "scripts/schema-audit.sql (or the Schema drift check Action).",
        "",
        "The drizzle tracker has never matched this database; running the",
        "migrator would replay migrations the database already has.",
        "",
        "If you are the manual db-migrate workflow (or truly know better):",
        "set DB_MIGRATE_I_UNDERSTAND=1.",
      ].join("\n"),
    );
    process.exit(1);
  }
  // Prefer the direct (non-pooled) Neon connection for DDL; fall back to the
  // pooled runtime URL. Pooled connections can mishandle multi-statement DDL.
  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_MIGRATION_URL (direct) or DATABASE_URL");
  const db = drizzle(neon(url));
  await migrate(db, { migrationsFolder: "./drizzle" });
  // eslint-disable-next-line no-console
  console.log("Migrations applied.");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
