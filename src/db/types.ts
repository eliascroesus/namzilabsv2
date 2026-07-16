import type { PgDatabase } from "drizzle-orm/pg-core";

/**
 * Driver-agnostic database handle. Both the production Neon-HTTP driver and the
 * in-process PGlite driver used in tests satisfy this base type, so every
 * engine function can accept a `DB` and be exercised against a real Postgres in
 * unit tests without external services.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DB = PgDatabase<any, any, any>;
