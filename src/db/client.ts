import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";
import type { DB } from "./types";

let cached: DB | null = null;

/**
 * Lazily construct the runtime (Neon serverless) database handle. Lazy so the
 * app can build without DATABASE_URL and so import-time never crashes.
 */
export function getDb(): DB {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  const sql = neon(url);
  cached = drizzle(sql, { schema }) as unknown as DB;
  return cached;
}
