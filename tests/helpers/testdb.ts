import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * Spin up a real Postgres (PGlite, in-process) with the production schema
 * applied via the generated migrations. Lets every engine function be exercised
 * against genuine SQL — unique constraints, ON CONFLICT, etc. — with no
 * external services.
 */
export async function createTestDb(): Promise<{ db: DB; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await migrate(db as any, { migrationsFolder: "./drizzle" });
  return { db: db as unknown as DB, close: () => client.close() };
}

/** Insert a connection row and return its id. */
export async function seedConnection(
  db: DB,
  overrides: Partial<{ orgId: string; source: string; name: string; status: string }> = {},
): Promise<string> {
  const [row] = await db
    .insert(schema.connections)
    .values({
      orgId: overrides.orgId ?? "org_test",
      source: overrides.source ?? "webhook",
      name: overrides.name ?? "Test connection",
      status: overrides.status ?? "active",
      authType: "secret",
    })
    .returning({ id: schema.connections.id });
  return row.id;
}
