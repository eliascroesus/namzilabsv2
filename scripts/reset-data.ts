/**
 * Wipe synced and computed data so the product can be exercised from a clean
 * state. DESTRUCTIVE. Inspect by default; two flags are required to write.
 *
 *   pnpm tsx scripts/reset-data.ts                                  # inspect
 *   pnpm tsx scripts/reset-data.ts --level=data --apply --confirm=data
 *   pnpm tsx scripts/reset-data.ts --level=all  --apply --confirm=all
 *
 * `--confirm` must repeat the level, so `--level=all` can never be run by
 * someone who meant `--level=data` and reached for a remembered command.
 *
 * TAKE A NEON BRANCH SNAPSHOT FIRST. Nothing here is recoverable: these are
 * hard deletes, not the soft-delete path the sync machinery uses.
 *
 * Organizations, users and memberships are never touched at any level.
 */
import { getDb } from "@/db/client";
import {
  orphanedFlowCount,
  resetData,
  unsyncedConnectionCount,
  type ReRegisterPlanEntry,
  type ResetLevel,
} from "@/lib/reset-data";

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}
const has = (name: string) => process.argv.includes(`--${name}`);

/**
 * The streams the reset will re-create, named so a human can check them against
 * the flows they expect to keep syncing. A bare count cannot be checked; this
 * can.
 */
function printReRegisterPlan(plan: ReRegisterPlanEntry[], heading: string) {
  console.log(`${heading} (${plan.length}):`);
  if (plan.length === 0) {
    console.log("  (none)");
  }
  plan.forEach((entry, i) => {
    console.log(`  ${(i + 1).toString().padStart(2)}. ${entry.source} — ${entry.connectionName}`);
    console.log(`      resource: ${JSON.stringify(entry.config)}`);
    console.log(`      used by:  ${entry.flows.join(", ")}`);
  });
  console.log("");
  console.log("  Only stream-scoped sources appear here — Calendly, Google Sheets, Google");
  console.log("  Calendar and Instantly. Close and catch-hook connections sync at");
  console.log("  the CONNECTION level, have no stream row, and are restored by the re-arm");
  console.log("  above instead. A flow that reads only those will never be listed, and that");
  console.log("  is correct rather than a miss.");
  console.log("");
}

async function main() {
  const raw = arg("level") ?? "data";
  if (raw !== "data" && raw !== "all") {
    console.error(`unknown --level=${raw} (expected "data" or "all")`);
    process.exit(1);
  }
  const level: ResetLevel = raw;
  const apply = has("apply");
  const confirm = arg("confirm");

  if (apply && confirm !== level) {
    console.error(
      confirm === undefined
        ? `Refusing to write. Re-run with --confirm=${level} to acknowledge this deletes data permanently.`
        : `--confirm=${confirm} does not match --level=${level}. They must be identical.`,
    );
    process.exit(1);
  }

  const db = getDb();
  const r = await resetData(db, { level, apply });
  const total = r.tables.reduce((n, t) => n + t.rows, 0);

  console.log(`Level: ${level} — ${r.dryRun ? "INSPECT (nothing written)" : "APPLIED"}\n`);
  for (const t of r.tables) console.log(`  ${t.rows.toString().padStart(9)}  ${t.table}`);
  console.log(`  ${"—".repeat(9)}`);
  console.log(`  ${total.toString().padStart(9)}  rows in total\n`);

  if (r.dryRun) {
    console.log("KEPT AT EVERY LEVEL: accounts and workspaces (identity lives in WorkOS, not this database).");
    console.log(
      level === "data"
        ? "KEPT AT THIS LEVEL:  connections (credentials + config), metrics, flows, flow_versions."
        : "ALSO DELETED AT THIS LEVEL: connections, metrics, flows, flow_versions — every credential and every flow.",
    );
    console.log("");
    if (level === "data") {
      console.log("AFTER APPLYING, THIS SCRIPT ALSO:");
      console.log(`  • Re-arms ${r.connectionsRearmed} connection(s): clears pause, breaker, idle backoff and`);
      console.log("    next-sweep time so syncing resumes within one sweep. Credentials, config and");
      console.log("    name are untouched. `sync_generation` is deliberately LEFT CLIMBING — resetting");
      console.log("    it while any event row survived would strand those rows above the current");
      console.log("    generation, where nothing can update or retire them.");
      console.log(`  • Re-registers ${r.streamsReRegistered} source_stream(s) from each flow's saved graph. Without this,`);
      console.log("    stream-scoped connections (Calendly, Sheets, Calendar, Instantly) would stay");
      console.log("    dark until a human opened every flow, because only a flow save or a Test");
      console.log("    creates a stream row.");
      console.log("");
      printReRegisterPlan(r.reRegisterPlan, "STREAMS THAT WILL BE RE-REGISTERED");
    }
    console.log("EXPECT AFTER APPLYING:");
    console.log("  • Dashboard tiles empty until the next sweep syncs data and recompute runs.");
    console.log("  • Any Inngest job already in flight that references a deleted raw_event or");
    console.log("    test_run will fail and land in the DLQ. Harmless; run this when quiet.");
    console.log("  • No redeploy needed. Calendly's in-process identity cache holds provider");
    console.log("    identity only (5-minute TTL) and the editor's label cache clears on reload.");
    console.log("");
    console.log(`Re-run with --apply --confirm=${level} to delete ${total} row(s).`);
    return;
  }

  console.log(`Re-armed ${r.connectionsRearmed} connection(s); re-registered ${r.streamsReRegistered} stream(s).`);
  if (level === "data") printReRegisterPlan(r.reRegisterPlan, "STREAMS RE-REGISTERED");
  if (r.streamsReRegistered !== r.reRegisterPlan.length) {
    console.log(
      `NOTE: ${r.reRegisterPlan.length - r.streamsReRegistered} of these already existed, so only ` +
        `${r.streamsReRegistered} row(s) were created. That is what a resumed run looks like — the end state is the same.`,
    );
  }
  const orphans = await orphanedFlowCount(db);
  const unsynced = await unsyncedConnectionCount(db);
  if (orphans > 0) console.log(`WARNING: ${orphans} flow(s) reference a connection that no longer exists — re-point their Get data step.`);
  console.log(`${unsynced} connection(s) now have no cursor and will do a first sync on their next sweep.`);
  console.log("\nDone. Re-runnable at any time; a second run finds nothing left.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
