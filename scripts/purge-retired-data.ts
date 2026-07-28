/**
 * Phase 2B retention. THE ONLY PATH IN THIS PRODUCT THAT DESTROYS CUSTOMER DATA.
 *
 *   pnpm tsx scripts/purge-retired-data.ts                          # inspect
 *   pnpm tsx scripts/purge-retired-data.ts --apply --confirm=purge  # destroy
 *
 * Everything else here soft-deletes: `deleted_at` takes rows out of circulation
 * and can be cleared again. This hard-deletes. There is no undo inside the app,
 * and the Neon branch snapshot is the only way back.
 *
 * TAKE A NEON BRANCH SNAPSHOT FIRST. Then run it in inspect mode, read what it
 * says it would destroy, and only then apply.
 *
 * What it will and will not touch:
 *   - A connection DISABLED for more than 30 days: archived, then its events
 *     and raw payloads deleted. The connection itself survives.
 *   - A connection DISABLED for more than 60 days: the row, its streams, and
 *     the five tables that leak because they have no foreign key to it.
 *   - Tombstones older than 30 days on connections that are still ACTIVE.
 *   - NEVER an active connection's live rows, whatever its `disabled_at` says.
 *   - NEVER a disabled connection with no `disabled_at`: unknown age is not
 *     old enough.
 */
import { getDb } from "@/db/client";
import {
  purgeRetiredData,
  PURGE_CONNECTION_AFTER_DAYS,
  PURGE_EVENTS_AFTER_DAYS,
  PURGE_TOMBSTONES_AFTER_DAYS,
} from "@/lib/retention";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const apply = has("apply");
  if (apply && arg("confirm") !== "purge") {
    console.error("Refusing to destroy data. Re-run with --apply --confirm=purge.");
    console.error("Take a Neon branch snapshot first — nothing here is recoverable from inside the app.");
    process.exit(1);
  }

  const r = await purgeRetiredData(getDb(), { apply, budgetMs: apply ? 60_000 : 60_000 });

  console.log(`${r.dryRun ? "INSPECT (nothing written)" : "APPLIED"}\n`);
  console.log(`Day ${PURGE_EVENTS_AFTER_DAYS} — archive, then delete events and raw payloads:`);
  if (r.eventsPurged.length === 0) console.log("  (nothing eligible)");
  for (const c of r.eventsPurged) {
    console.log(`  ${c.source}  ${c.connectionId}  ${c.events} event(s), ${c.rawEvents} raw payload(s)`);
  }
  console.log(`\nDay ${PURGE_CONNECTION_AFTER_DAYS} — remove the connection and everything keyed to it:`);
  if (r.connectionsRemoved.length === 0) console.log("  (nothing eligible)");
  for (const c of r.connectionsRemoved) {
    const detail = Object.entries(c.rows).filter(([, n]) => n > 0).map(([t, n]) => `${t}=${n}`).join(" ");
    console.log(`  ${c.source}  ${c.connectionId}  ${detail || "(counted on apply)"}`);
  }
  console.log(`\nTombstones older than ${PURGE_TOMBSTONES_AFTER_DAYS} days on ACTIVE connections: ${r.tombstonesPurged}`);

  if (r.hitBudget) {
    console.log("\nStopped on its time budget rather than on empty. Every batch commits on its own,");
    console.log("so this is a resumable state, not a partial one — just run it again.");
  }
  if (!r.dryRun) {
    console.log(
      `\nBacklog after this run: ${r.backlog.events} event(s), ${r.backlog.rawEvents} raw payload(s), ` +
        `${r.backlog.tombstones} tombstone(s).`,
    );
    console.log("Non-zero is normal on a first pass. Non-zero that never falls means it cannot keep up.");
  }

  if (r.dryRun) {
    console.log("\nWHAT BECOMES UNRECOVERABLE, and when:");
    console.log(`  • At day ${PURGE_EVENTS_AFTER_DAYS} a disconnected connection's records and raw payloads are gone.`);
    console.log("    Reconnecting after that re-imports from the provider, subject to whatever history");
    console.log("    it still exposes — which for Close and Sendblue is 30 days.");
    console.log(`  • At day ${PURGE_CONNECTION_AFTER_DAYS} nothing remains but the connection_archive summary.`);
    console.log("\nRe-run with --apply --confirm=purge to destroy the rows listed above.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
