/**
 * ONE-TIME cleanup after Sendblue's event ids stopped embedding the message
 * status. Inspect by default; `--apply` writes.
 *
 *   pnpm tsx scripts/reconcile-sendblue-ids.ts
 *   pnpm tsx scripts/reconcile-sendblue-ids.ts --apply
 *
 * RUN A FULL RE-SYNC ON EACH SENDBLUE CONNECTION FIRST, then this. Reversed,
 * the re-sync re-imports under new ids after this has already counted and the
 * report no longer describes what is there.
 *
 * Soft-deletes only, batched, idempotent — an interrupted run is safely
 * re-runnable and a second run finds nothing left.
 */
import { getDb } from "@/db/client";
import { rekeySendblueIds } from "@/lib/sync/sendblue-rekey";

const apply = process.argv.includes("--apply");

async function main() {
  const r = await rekeySendblueIds(getDb(), { apply });

  console.log(`Sendblue connections: ${r.connections}`);
  console.log(`Old-shape rows still live: ${r.candidates}`);
  console.log(`  …of which no sweep can EVER retire: ${r.unreachableByAnySweep}`);
  console.log("");

  if (r.candidates === 0) {
    console.log("Nothing to do — no rows carry the old `sendblue:<conn>:<status>:<handle>` shape.");
    return;
  }

  // The window, stated before anyone is asked to act on it.
  console.log("WHY THIS MATTERS");
  console.log("  Ids changed from `sendblue:<conn>:<status>:<handle>` to `sendblue:<conn>:<handle>`.");
  console.log("  The two never collide, so every message stored before the change now exists TWICE");
  console.log("  and Sendblue counts read HIGH until this is applied. A message that arrived by");
  console.log("  webhook at all three lifecycle stages (QUEUED/SENT/DELIVERED) counts FOUR times.");
  console.log("");
  console.log("  Poll-written rows (generation >= 1) are retired by a full re-sync on their own.");
  console.log(`  Webhook-written rows (generation 0, stream_hash NULL) are NOT: ${r.unreachableByAnySweep} of the`);
  console.log("  rows above are unreachable by every sweep in the codebase, by construction — the");
  console.log("  append-only class has to survive them. Those are permanent until this script runs.");
  console.log("");

  if (r.dryRun) {
    console.log(`Dry run — nothing written. Re-run with --apply to retire ${r.candidates} row(s).`);
    return;
  }
  console.log(`Tombstoned ${r.tombstoned} row(s). Re-run any time; it is idempotent.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
