import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // Use the direct (non-pooled) connection for migrations when available.
    url:
      process.env.DATABASE_MIGRATION_URL ??
      process.env.DATABASE_URL ??
      "postgresql://user:pass@localhost:5432/db",
  },
});
