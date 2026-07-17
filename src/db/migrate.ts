import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { migrate } from "drizzle-orm/neon-http/migrator";

async function main() {
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
