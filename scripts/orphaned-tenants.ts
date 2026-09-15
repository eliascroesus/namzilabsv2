/**
 * FIND — AND OPTIONALLY DESTROY — DATA BELONGING TO WORKSPACES THAT NO LONGER
 * EXIST.
 *
 * WHY THIS EXISTS. An organization removed OUTSIDE the product — in the WorkOS
 * dashboard, by a support action, by a script — takes none of our rows with it.
 * Both `deleteWorkspaceAction` and `deleteAccountAction` sweep our data BEFORE
 * calling WorkOS, precisely so a half-finished delete leaves a workspace you can
 * delete again rather than data nobody can reach; but neither runs at all when
 * the org is deleted somewhere else. What is left is a tenant with live
 * credentials, possibly a live webhook, and no human who can reach it. Nothing
 * was watching for that state.
 *
 * ═══ READ THIS BEFORE BELIEVING ANY OUTPUT ═══
 *
 * THE FIRST TIME THIS RAN IT WAS COMPLETELY WRONG, and the way it was wrong is
 * the most important thing in this file. It reported three organizations as
 * abandoned — eight connections, 26,151 events, live Google OAuth grants, a
 * webhook still taking deliveries. Every number was real. The conclusion was
 * nonsense: those were the operator's three LIVE workspaces.
 *
 * The cause was that `.env.local` pairs a `sk_test_` WorkOS key with a
 * `DATABASE_URL` pointing at the real database. Production org ids were checked
 * against the TEST environment, which has never heard of them, so all of them
 * answered 404. A `--live` run would have destroyed three working workspaces and
 * revoked their Google grants.
 *
 * Hence the environment banner and the mismatch guard below. An org id exists
 * only in the environment it was created in, this script cannot tell which
 * environment owns the database it is pointed at, and a 404 is therefore only
 * evidence of deletion once most of the other orgs have been found alive.
 *
 * Read-only by default; `--live` destroys.
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

  /**
   * WHICH WORKOS ARE WE EVEN ASKING? Printed first, and loudly, because getting
   * this wrong is how this script nearly destroyed three live workspaces the
   * first time it ran.
   *
   * `.env.local` holds a `sk_test_` key — the WorkOS TEST environment — while
   * `DATABASE_URL` in that same file points at the real database. Every
   * production org id was therefore checked against an environment that has
   * never heard of it, all of them answered 404, and the script confidently
   * reported the customer's three live workspaces as abandoned data to be
   * swept. The output was completely wrong and completely plausible.
   */
  const keyEnv = apiKey.startsWith("sk_live_") ? "LIVE" : apiKey.startsWith("sk_test_") ? "TEST" : "UNRECOGNISED";
  console.log(`Asking the WorkOS ${keyEnv} environment (key prefix ${apiKey.slice(0, 8)}…).`);
  console.log("An org id only exists in the environment it was created in — a key from the");
  console.log("wrong one makes every organization look deleted.\n");

  const orphans: string[] = [];
  let unknown = 0;
  let exists = 0;
  for (const orgId of orgIds) {
    const state = await orgState(orgId, apiKey);
    if (state === "exists") {
      exists++;
      continue;
    }
    if (state === "unknown") {
      unknown++;
      console.log(`  ? ${orgId} — WorkOS could not be asked. Skipped; run again.`);
      continue;
    }
    orphans.push(orgId);
  }

  /**
   * THE MISMATCH GUARD. A genuine orphan is a workspace somebody deleted
   * outside the product — rare, and a small minority of a real database. If
   * MOST of the organizations holding data appear to be gone, the overwhelmingly
   * likelier explanation is that the question was put to the wrong WorkOS
   * environment, and acting on that answer destroys live customers.
   *
   * So the ratio is treated as evidence about the KEY rather than about the
   * data, and the script stops rather than reporting. There is no override
   * flag: an operator with a genuinely majority-orphaned database needs to look
   * at it by hand, not to be handed a bulk delete.
   */
  if (orphans.length > 0 && exists === 0) {
    console.error(`STOPPING. Not one of the ${orgIds.length} organization(s) exists in the WorkOS ${keyEnv} environment.`);
    console.error("That is a key/database mismatch, not a database full of orphans.");
    console.error("Point WORKOS_API_KEY at the environment that owns this database and run again.");
    process.exit(2);
  }
  if (orphans.length > exists) {
    console.error(`STOPPING. ${orphans.length} of ${orphans.length + exists} organization(s) appear deleted, which is too many to believe.`);
    console.error(`Almost certainly the wrong WorkOS environment (currently ${keyEnv}). Check the key before trusting this.`);
    process.exit(2);
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
