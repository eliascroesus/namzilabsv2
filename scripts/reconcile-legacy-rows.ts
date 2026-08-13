/**
 * ONE-TIME HUMAN-RUN legacy-row reconciliation
 * (PRE_LAUNCH_CHECKLIST.md item 6 — run after deploy, BEFORE any fleet
 * backfill or reprocessConnection replay).
 *
 * Retires pre-unification "ghost" rows: poll-managed events on STREAM-SCOPED
 * connections that carry no stream identity (`sync_generation >= 1 AND
 * stream_hash IS NULL`). Today's sweeps are stream-scoped by design, so
 * nothing else can ever retire these — they linger and are counted by reads
 * that aren't stream-filtered.
 *
 * Rows on connection-scoped connections (Close, Instantly, custom
 * webhook) are NEVER touched: there, a null stream_hash is correct for every
 * row. Generation-0 (webhook) rows are never touched anywhere.
 *
 *   # 1. inspect (default — writes nothing)
 *   DATABASE_URL="postgresql://…" pnpm tsx scripts/reconcile-legacy-rows.ts
 *
 *   # 2. apply, once the counts look right
 *   DATABASE_URL="postgresql://…" pnpm tsx scripts/reconcile-legacy-rows.ts --apply
 *
 * Idempotent: re-running after a completed or interrupted run is a no-op.
 */
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import * as schema from "../src/db/schema";
import type { DB } from "../src/db/types";
import { inspectLegacyRows, legacyRowsByConnection, reconcileLegacyRows } from "../src/lib/sync/legacy-reconciliation";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Set DATABASE_URL and re-run.");
    process.exit(2);
  }
  const apply = process.argv.includes("--apply");
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema }) as unknown as DB;

  try {
    console.log(`Legacy-row reconciliation — ${apply ? "APPLY" : "INSPECT (no writes)"}\n`);

    const before = await inspectLegacyRows(db);
    console.log(`  stream-scoped connections : ${before.streamScopedConnections}`);
    console.log(`  legacy ghost rows found   : ${before.candidates}`);

    if (before.candidates === 0) {
      console.log("\nNothing to do — no legacy rows remain. (Already reconciled, or a clean install.)");
      return;
    }

    const breakdown = await legacyRowsByConnection(db);
    console.log("\n  by connection:");
    for (const b of breakdown) {
      console.log(`    ${b.rows.toString().padStart(8)}  ${b.source.padEnd(10)} ${b.name} (${b.connectionId})`);
    }

    if (!apply) {
      console.log("\nInspect only — nothing was written. Re-run with --apply to retire these rows.");
      return;
    }

    const result = await reconcileLegacyRows(db);
    console.log(`\n  tombstoned                : ${result.tombstoned}`);

    const after = await inspectLegacyRows(db);
    console.log(`  remaining                 : ${after.candidates}`);
    if (after.candidates === 0) {
      console.log("\nPASS — every legacy ghost row is retired. Backfills and replays are now unblocked.");
    } else {
      console.log("\nWARNING — rows remain (new ones may have appeared mid-run). Re-run --apply; it is idempotent.");
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(`\nAborted: ${e instanceof Error ? e.message : e}`);
  process.exit(2);
});

export {};
