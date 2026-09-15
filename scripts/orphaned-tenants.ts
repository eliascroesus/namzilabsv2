/**
 * FIND — AND OPTIONALLY DESTROY — DATA BELONGING TO WORKSPACES THAT NO LONGER
 * EXIST.
 *
 * WHY THIS EXISTS. Verifying an account deletion on 15 Sep 2026 turned up three
 * organizations that were gone from WorkOS while still holding rows here: eight
 * connections, 26,151 events, and — the part that matters — **live OAuth grants
 * against real Google accounts and a webhook still taking deliveries**. One of
 * the three had received 104 deliveries in the previous seven days, ingesting
 * into a tenant no human being could reach.
 *
 * THE DELETION PATH IN THE PRODUCT CANNOT PRODUCE THIS. Both
 * `deleteWorkspaceAction` and `deleteAccountAction` sweep our rows BEFORE
 * calling WorkOS, precisely so a half-finished delete leaves a workspace you can
 * delete again rather than data nobody can reach. Residue in this shape means
 * the organization was removed by something that never ran our code — deleting
 * it in the WorkOS dashboard does exactly that, and so would a support action or
 * a script.
 *
 * So this is not a bug to fix in the delete path. It is a STATE NOBODY WAS
 * WATCHING FOR, and the two things it needed were a way to notice and a way to
 * clean up. Read-only by default; `--live` destroys.
 *
 * ═══ WHAT IT IS AND IS NOT SAFE ABOUT ═══
 *
 * IT REUSES `destroyWorkspaceData`, deliberately, rather than issuing its own
 * deletes. That function is the audited path: it tears each connection's webhook
 * down at the provider and revokes the OAuth grant BEFORE the encrypted row
 * goes, then sweeps all twenty-five tenant tables in child-before-parent order,
 * then handles `sync_state`, which no `org_id` can reach. A second
 * implementation here would be a second thing to keep correct, and the first
 * time it drifted it would leave exactly the residue this script exists to find.
 *
 * IT ONLY EVER TOUCHES AN ORG WORKOS ANSWERS **404** FOR. Not an error, not a
 * timeout, not a 5xx — a definite "this does not exist". An org that cannot be
 * checked is reported and skipped, because the failure mode of getting this
 * wrong is destroying a live customer's data on the strength of a network blip.
 *
 * IT NEVER TOUCHES `audit_log`, which is not in `ORG_TABLES` by design — the
 * record of what happened to a workspace outlives the workspace. Cleaning up
 * after a deletion must not erase the evidence of one.
 */
import { and, eq, gt, sql as raw } from "drizzle-orm";
import { connections, deliveryLog, events, workspaceOwners } from "@/db/schema";
import { getDb } from "@/db/client";
import { destroyWorkspaceData } from "@/lib/destroy";
import { recordAudit } from "@/lib/audit";

const LIVE = process.argv.includes("--live");

/**
 * Does this organization still exist?
 *
 * Three answers, not two. `unknown` is the one that matters: it is what a
 * timeout, a rate limit or a 5xx produces, and it must never be treated as
 * "gone". Only a 404 is a fact.
 */
async function orgState(orgId: string, apiKey: string): Promise<"exists" | "gone" | "unknown"> {
  try {
    const res = await fetch(`https://api.workos.com/organizations/${orgId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.status === 404) return "gone";
    if (res.ok) return "exists";
    return "unknown";
  } catch {
    return "unknown";
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.WORKOS_API_KEY;
  if (!process.env.DATABASE_URL || !apiKey) {
    console.error("DATABASE_URL and WORKOS_API_KEY must both be set.");
    process.exit(1);
  }
  const db = getDb();

  /**
   * Every org id with a footprint, from the three tables that mean "a workspace
   * was really used": it holds credentials, it holds data, or somebody owns it.
   * An org present only in, say, `usage_ledger` has nothing worth destroying and
   * nothing worth alarming about.
   */
  const rows = await db
    .select({ orgId: connections.orgId })
    .from(connections)
    .union(db.select({ orgId: events.orgId }).from(events))
    .union(db.select({ orgId: workspaceOwners.orgId }).from(workspaceOwners));
  const orgIds = [...new Set(rows.map((r) => r.orgId))].sort();

  console.log(`${orgIds.length} organization(s) have rows in this database.\n`);

  const orphans: string[] = [];
  let unknown = 0;
  for (const orgId of orgIds) {
    const state = await orgState(orgId, apiKey);
    if (state === "exists") continue;
    if (state === "unknown") {
      unknown++;
      console.log(`  ? ${orgId} — WorkOS could not be asked. Skipped; run again.`);
      continue;
    }
    orphans.push(orgId);
  }

  if (orphans.length === 0) {
    console.log(unknown > 0 ? `\nNo orphans found, but ${unknown} org(s) could not be checked.` : "\nNo orphans. Every org holding data still exists.");
    return;
  }

  console.log(`\n${orphans.length} ORPHANED organization(s) — gone from WorkOS, still holding data here:\n`);

  for (const orgId of orphans) {
    const conns = await db
      .select({
        source: connections.source,
        status: connections.status,
        authType: connections.authType,
        hasCreds: raw<boolean>`${connections.credentialsEncrypted} is not null`,
      })
      .from(connections)
      .where(eq(connections.orgId, orgId));
    const [{ n: eventCount }] = await db
      .select({ n: raw<number>`count(*)::int` })
      .from(events)
      .where(eq(events.orgId, orgId));
    // Still ARRIVING is what decides urgency: a dead tenant with a live webhook
    // is taking somebody's data right now.
    const [{ n: recent }] = await db
      .select({ n: raw<number>`count(*)::int` })
      .from(deliveryLog)
      .where(and(eq(deliveryLog.orgId, orgId), gt(deliveryLog.createdAt, new Date(Date.now() - 7 * 86_400_000))));

    console.log(`  ${orgId}`);
    console.log(`     ${conns.length} connection(s), ${eventCount} event(s), ${recent} delivery(s) in the last 7 days`);
    for (const c of conns) {
      console.log(`       ${c.source} (${c.authType}, ${c.status})${c.hasCreds ? " — HOLDS CREDENTIALS" : ""}`);
    }

    if (!LIVE) continue;

    /**
     * The audited path. It revokes the provider grant and tears the webhook
     * down before the encrypted row goes, which is the whole reason this is not
     * a `DELETE FROM` loop — those grants are still authorised against somebody's
     * real Google account until something asks the provider to end them.
     */
    const result = await destroyWorkspaceData(db, orgId);
    console.log(`     → destroyed: ${Object.values(result.rows).reduce((a, b) => a + b, 0)} row(s), ${result.connections} connection(s)`);
    await recordAudit(db, {
      action: "workspace.delete",
      orgId,
      // No actor: nobody pressed a button. Recording it as an operator cleanup
      // rather than attributing it to a person is the honest row.
      detail: { cause: "orphan-cleanup", connections: result.connections },
    });
  }

  if (!LIVE) {
    console.log("\nDRY RUN — nothing was destroyed.");
    console.log("Re-run with --live to revoke those grants, tear down the webhooks, and sweep the rows.");
    return;
  }
  console.log(`\n${orphans.length} orphaned workspace(s) destroyed, each recorded in audit_log.`);
}

/** Only when run as a command — see the same guard in rotate-encryption-key.ts. */
const invokedDirectly = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? " ");

if (invokedDirectly) {
  main().then(
    () => process.exit(0),
    (err) => {
      console.error(`orphan scan failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    },
  );
}
