import { eq, inArray } from "drizzle-orm";
import {
  backfillJobs,
  connections,
  dashboardGroups,
  dashboardNotes,
  dashboardTilePlacements,
  dashboardTiles,
  dashboardViews,
  deadLetter,
  deliveryLog,
  events,
  flowResults,
  flowVersions,
  flows,
  mcpBindings,
  mcpCalls,
  mcpGrants,
  metrics,
  rankAssignments,
  rawEvents,
  referralCodes,
  referrals,
  sourceStreams,
  streamFields,
  syncState,
  testRuns,
  usageLedger,
  userProfiles,
  workspaceOwners,
  workspaceRanks,
  workspaceSettings,
  workspaceTemplateUses,
  workspaceTemplates,
} from "@/db/schema";
import type { DB } from "@/db/types";
import { isUndefinedTableError } from "@/lib/db-errors";
import { deleteConnectionData } from "@/lib/sync/delete-connection";

/**
 * DESTROYING A WORKSPACE, OR A PERSON. Irreversible, and deliberately so —
 * "hard delete on confirm, no grace period", which is the Notion and Zapier
 * shape rather than the 30-day-bin one.
 *
 * IT TAKES `db` AND DOES NO AUTH. Every gate lives in the server action that
 * calls this: who may ask, and whether they typed the name back. Splitting it
 * that way is what makes the most dangerous code in the product testable at
 * all — the same split `delete-connection.ts` and `retire-connection.ts`
 * already use, and for the same stated reason.
 *
 * WHY IT IS NOT ONE `DELETE ... CASCADE`. Three of the twenty-five tenant
 * tables are not reachable by cascade from anything:
 *
 *   - `sync_state` is keyed by `connection_id` with NO foreign key, so dropping
 *     a connection orphans its cursor rather than removing it.
 *   - `usage_ledger` holds one row that belongs to NOBODY — the fleet-wide
 *     provider budget under a sentinel org — which is why deletes here are
 *     always walled by the real `org_id`.
 *   - connections have work to do BEFORE their rows go: `deleteConnectionData`
 *     asks each provider to stop delivering to a webhook that is about to start
 *     403ing. A cascade would leave Calendly and Close retrying forever.
 *
 * So connections are destroyed one at a time through the path that already
 * knows all that, and the rest is an explicit sweep in child-before-parent
 * order.
 */

/** What was removed, per table, so an action can log something truthful. */
export type DestroyResult = { rows: Record<string, number>; connections: number };

/**
 * EVERY TENANT TABLE, IN DELETION ORDER — and the list is exhaustive on
 * purpose.
 *
 * `tests/destroy.test.ts` walks `src/db/schema.ts` and fails if a table
 * carrying `org_id` is missing from here. That check is the whole reason this
 * is a list rather than twenty-five inline statements: the failure mode of
 * workspace deletion is not a crash, it is a table quietly left behind holding
 * a customer's data after they were told it was gone.
 *
 * Children first even though most of these cascade, because relying on the
 * cascade means the order becomes load-bearing the day somebody drops an `on
 * delete` clause.
 */
const ORG_TABLES = [
  // Dashboard: placements reference views and groups; tiles reference views.
  // Notes reference either by id with no foreign key, so their place is free.
  { name: "dashboard_notes", table: dashboardNotes, late: true },
  { name: "dashboard_tile_placements", table: dashboardTilePlacements },
  { name: "dashboard_tiles", table: dashboardTiles },
  { name: "dashboard_views", table: dashboardViews },
  { name: "dashboard_groups", table: dashboardGroups },
  // Flows: results and versions both reference the flow.
  { name: "flow_results", table: flowResults },
  { name: "flow_versions", table: flowVersions },
  { name: "test_runs", table: testRuns },
  { name: "flows", table: flows },
  { name: "metrics", table: metrics },
  // Governance.
  { name: "rank_assignments", table: rankAssignments },
  { name: "workspace_ranks", table: workspaceRanks },
  { name: "workspace_settings", table: workspaceSettings },
  { name: "workspace_owners", table: workspaceOwners },
  // Sharing. A use row is the RECIPIENT's (its org is the workspace the copy
  // landed in); a template is the AUTHOR's, and deleting it cascades every
  // use of it in other workspaces — their copies stay, only the count goes.
  { name: "workspace_template_uses", table: workspaceTemplateUses, late: true },
  { name: "workspace_templates", table: workspaceTemplates, late: true },
  // The assistant's access to this workspace.
  { name: "mcp_bindings", table: mcpBindings },
  { name: "mcp_calls", table: mcpCalls },
  { name: "mcp_grants", table: mcpGrants },
  // Ingestion leftovers. `deleteConnectionData` clears these per connection;
  // this is the sweep for anything whose connection row had already gone.
  { name: "events", table: events },
  { name: "raw_events", table: rawEvents },
  { name: "delivery_log", table: deliveryLog },
  { name: "dead_letter", table: deadLetter },
  { name: "stream_fields", table: streamFields },
  { name: "source_streams", table: sourceStreams },
  { name: "backfill_jobs", table: backfillJobs },
  { name: "usage_ledger", table: usageLedger },
  { name: "connections", table: connections },
] as const;

/** The table names this module promises to clear, for the coverage test. */
export const DESTROYED_ORG_TABLES: readonly string[] = ORG_TABLES.map((t) => t.name);

/**
 * Remove a workspace's every row. The caller has already established WHO is
 * asking and that they named the thing.
 */
export async function destroyWorkspaceData(db: DB, orgId: string): Promise<DestroyResult> {
  const rows: Record<string, number> = {};

  /**
   * CONNECTIONS FIRST, THROUGH THEIR OWN PATH. Each one asks its provider to
   * tear the webhook down before its rows go — best-effort and never blocking,
   * but it has to happen while the connection still exists to be identified.
   *
   * `conn.name` is passed as the confirmation because THIS caller has already
   * been confirmed: the person typed the workspace's name, which is the
   * stronger statement. Requiring them to additionally type the name of every
   * connection inside it would be a worse interface, not a safer one.
   */
  const conns = await db.select({ id: connections.id, name: connections.name }).from(connections).where(eq(connections.orgId, orgId));
  for (const c of conns) {
    const res = await deleteConnectionData(db, orgId, c.id, c.name);
    for (const [k, v] of Object.entries(res.rows)) rows[k] = (rows[k] ?? 0) + v;
  }

  /**
   * `sync_state` HAS NO FOREIGN KEY and is keyed by connection id alone, so it
   * is the one table that cannot be reached from `org_id` at all. Collected
   * from the connections read ABOVE, which is why that read happens before
   * anything is deleted.
   */
  if (conns.length > 0) {
    const gone = await db
      .delete(syncState)
      .where(inArray(syncState.connectionId, conns.map((c) => c.id)))
      .returning({ id: syncState.connectionId });
    rows.sync_state = (rows.sync_state ?? 0) + gone.length;
  }

  for (const entry of ORG_TABLES) {
    const { name, table } = entry;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gone = await db.delete(table as any).where(eq((table as any).orgId, orgId)).returning();
      rows[name] = (rows[name] ?? 0) + gone.length;
    } catch (e) {
      /**
       * A TABLE WHOSE MIGRATION HAS NOT BEEN PASTED YET HOLDS NOTHING TO DELETE.
       *
       * Migrations here are applied by hand, so a deploy can run before the
       * tables it added exist. Without this, the three sharing tables would
       * have made "Delete workspace" throw in production for every workspace
       * until the paste — an irreversible act the owner had already confirmed,
       * failing over rows that cannot exist. Only tables marked `late` are
       * excused, and only for "relation does not exist": a missing column, a
       * permission error or a lock timeout on any table still fails loudly.
       */
      if ("late" in entry && entry.late && isUndefinedTableError(e)) {
        rows[name] = rows[name] ?? 0;
        continue;
      }
      throw e;
    }
  }

  return { rows, connections: conns.length };
}

/**
 * Remove everything that belongs to a PERSON rather than to a workspace.
 *
 * Called after their owned workspaces have already been destroyed, so what is
 * left is the handful of rows keyed by a user id.
 *
 * THE REFERRAL LEDGER GOES BOTH WAYS, and it is worth being explicit because
 * it costs somebody else something. Rows where this person is the REFERRER are
 * their own earned credit and go with them. Rows where they are the REFERRED
 * are somebody else's earned credit — and they still go, because the row is a
 * record OF this person and a hard delete that leaves their id in a table is
 * not a hard delete. The other party's count drops by one; that is the honest
 * consequence of the account no longer existing.
 */
export async function destroyUserData(db: DB, userId: string): Promise<Record<string, number>> {
  const rows: Record<string, number> = {};
  const count = async (name: string, run: () => Promise<Array<unknown>>) => {
    rows[name] = (await run()).length;
  };

  await count("user_profiles", () => db.delete(userProfiles).where(eq(userProfiles.userId, userId)).returning());
  await count("referral_codes", () => db.delete(referralCodes).where(eq(referralCodes.userId, userId)).returning());
  await count("referrals_as_referrer", () =>
    db.delete(referrals).where(eq(referrals.referrerUserId, userId)).returning(),
  );
  await count("referrals_as_referred", () =>
    db.delete(referrals).where(eq(referrals.referredUserId, userId)).returning(),
  );
  // Memberships of workspaces they did NOT own: the workspace survives, this
  // person's place in it does not.
  await count("rank_assignments", () => db.delete(rankAssignments).where(eq(rankAssignments.userId, userId)).returning());
  await count("mcp_grants", () => db.delete(mcpGrants).where(eq(mcpGrants.userId, userId)).returning());
  await count("mcp_bindings", () => db.delete(mcpBindings).where(eq(mcpBindings.userId, userId)).returning());
  /**
   * THE SHARING TABLES NAME PEOPLE TOO. A use row records that THIS person
   * took a template; a template records who shared it, under their name, and
   * is what their referral credit was keyed on. Both are records OF the person,
   * so both go — a template made inside somebody else's workspace included,
   * since the name on its public page is theirs. `late` for the same reason as
   * in `destroyWorkspaceData`: a missing table holds nothing to delete.
   */
  const late = async (name: string, run: () => Promise<Array<unknown>>) => {
    try {
      await count(name, run);
    } catch (e) {
      if (!isUndefinedTableError(e)) throw e;
      rows[name] = 0;
    }
  };
  await late("workspace_template_uses", () =>
    db.delete(workspaceTemplateUses).where(eq(workspaceTemplateUses.userId, userId)).returning(),
  );
  await late("workspace_templates", () =>
    db.delete(workspaceTemplates).where(eq(workspaceTemplates.createdBy, userId)).returning(),
  );

  return rows;
}
