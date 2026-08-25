// Deliberately NOT `import "server-only"`: resolveRank is a pure function and
// tests/permissions.test.ts exercises it directly from vitest, which has no
// React server context. The server-only boundary stays where it already is —
// src/lib/auth.ts — and effectiveAccess is safe here because it takes its DB
// handle and org context as ARGUMENTS instead of reaching for a session.
import { and, eq } from "drizzle-orm";
import { workspaceRanks, rankAssignments, workspaceOwners } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * The permission catalog — every gate in the app is one of these keys, and the
 * rank editor renders this list, so adding a permission is adding a row here.
 * Metric visibility is separate (per-tile keys, not enumerable up front):
 * a flow tile is "flow:<flowId>", a classic metric tile is "metric:<metricId>".
 */
export const PERMISSIONS = [
  { key: "create_flows", label: "Build flows & metrics", blurb: "Create, edit, publish and delete flows and dashboard metrics" },
  { key: "view_integrations", label: "View integrations", blurb: "Open the Apps page and see connections" },
  { key: "connect_integrations", label: "Manage integrations", blurb: "Connect and remove app accounts" },
  // GOVERNANCE, not product access. Consulted only through canManageRanks —
  // deliberately NOT satisfied by the unranked member's full-product-access
  // default, because "can use everything" and "can govern everyone" are
  // different trusts everywhere this was researched (Whop's admin preset,
  // Canva's team admin, Notion's membership admin, Miro's team admin).
  { key: "manage_workspace", label: "Manage workspace", blurb: "Invite members, create roles and assign them" },
] as const;

export type PermissionKey = "create_flows" | "view_integrations" | "connect_integrations" | "manage_workspace";

/** One rank as stored: a bundle of grants plus the rank ids it inherits from. */
export type RankRow = {
  id: string;
  name: string;
  allPermissions: boolean;
  permissions: string[];
  allMetrics: boolean;
  metricKeys: string[];
  inherits: string[];
};

/** What a caller may do, resolved once per request and closed over the sets. */
export type Access = {
  admin: boolean;
  can: (p: PermissionKey) => boolean;
  canSeeMetric: (key: string) => boolean;
};

/**
 * Resolve a rank's EFFECTIVE grants: the union over its inheritance closure.
 *
 * Live inheritance is the point — this runs at read time, so editing a parent
 * changes every inheritor on their next access check with no copy to go stale.
 * The walk keeps a visited set, so a cycle (A→B→A, however it got saved)
 * terminates with the union of both rather than looping. Unknown ids are
 * skipped silently: a deleted parent must not break its children, it just
 * stops contributing. allPermissions/allMetrics are sticky ORs across the
 * closure — any rank in the chain granting "everything" grants it here.
 */
export function resolveRank(
  ranks: Map<string, RankRow>,
  id: string,
): { allPermissions: boolean; permissions: Set<string>; allMetrics: boolean; metricKeys: Set<string> } {
  const visited = new Set<string>();
  const permissions = new Set<string>();
  const metricKeys = new Set<string>();
  let allPermissions = false;
  let allMetrics = false;

  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue; // the cycle/diamond guard: each rank contributes once
    visited.add(current);
    const rank = ranks.get(current);
    if (!rank) continue; // deleted parent: skip, never throw
    allPermissions = allPermissions || rank.allPermissions;
    allMetrics = allMetrics || rank.allMetrics;
    for (const p of rank.permissions) permissions.add(p);
    for (const k of rank.metricKeys) metricKeys.add(k);
    for (const parent of rank.inherits) stack.push(parent);
  }

  return { allPermissions, permissions, allMetrics, metricKeys };
}

/** Everything allowed. One shared shape for the three full-access cases below. */
function fullAccess(admin: boolean): Access {
  return { admin, can: () => true, canSeeMetric: () => true };
}

/**
 * The access a member actually has, resolved from their rank assignment.
 *
 * The rules, in order:
 * - role === "admin" (the WorkOS slug) → everything, before any query. Admins
 *   are never restricted — even if someone assigns them a rank — and the
 *   short-circuit keeps the common case at zero DB cost.
 * - NO rank assigned → full access. Restrictions BEGIN when a rank is
 *   assigned: existing workspaces keep working with zero setup and the
 *   migration cannot strand anyone.
 * - A rank → exactly its effective (inheritance-resolved) grants.
 */
export async function effectiveAccess(
  db: DB,
  ctx: { orgId: string; userId: string; role?: string },
): Promise<Access> {
  if (ctx.role === "admin") return fullAccess(true);

  const [assignment] = await db
    .select({ rankId: rankAssignments.rankId })
    .from(rankAssignments)
    .where(and(eq(rankAssignments.orgId, ctx.orgId), eq(rankAssignments.userId, ctx.userId)))
    .limit(1);
  if (!assignment) return fullAccess(false);

  const rows = await db
    .select({
      id: workspaceRanks.id,
      name: workspaceRanks.name,
      allPermissions: workspaceRanks.allPermissions,
      permissions: workspaceRanks.permissions,
      allMetrics: workspaceRanks.allMetrics,
      metricKeys: workspaceRanks.metricKeys,
      inherits: workspaceRanks.inherits,
    })
    .from(workspaceRanks)
    .where(eq(workspaceRanks.orgId, ctx.orgId));
  const ranks = new Map<string, RankRow>(rows.map((r) => [r.id, r]));

  // THE OWNER IS NEVER RESTRICTED — checked here, on the ranked path only, so
  // the two common paths (admin slug, unranked member) stay query-free and
  // query-one. Someone assigning the owner a rank, by slip or by malice, must
  // not be able to lock the workspace's creator out of their own workspace.
  const [owner] = await db
    .select({ userId: workspaceOwners.userId })
    .from(workspaceOwners)
    .where(eq(workspaceOwners.orgId, ctx.orgId))
    .limit(1);
  if (owner?.userId === ctx.userId) return fullAccess(true);

  // An assignment pointing at a rank that no longer exists is "no rank", not
  // "empty rank": resolving it would grant NOTHING, and a deleted rank must
  // never lock its former holders out of everything.
  if (!ranks.has(assignment.rankId)) return fullAccess(false);

  const resolved = resolveRank(ranks, assignment.rankId);
  return {
    admin: false,
    can: (p) => resolved.allPermissions || resolved.permissions.has(p),
    canSeeMetric: (key) => resolved.allMetrics || resolved.metricKeys.has(key),
  };
}

/**
 * WHO MAY GOVERN THE WORKSPACE — manage ranks, assign them, invite members.
 *
 * Owner and WorkOS admins always; everyone else only through an EXPLICIT
 * `manage_workspace` grant on their rank. An UNRANKED member gets full
 * PRODUCT access (that default keeps zero-setup workspaces working) but NO
 * governance — the first version fell back to "unranked may manage", and the
 * bug report was a screenshot of a plain member reassigning everyone's ranks.
 * "Can use everything" and "can govern everyone" are different trusts in
 * every product this was measured against (Whop, Canva, Notion, Miro):
 * members never manage members by default.
 */
export async function canManageRanks(db: DB, ctx: { orgId: string; userId: string; role?: string }): Promise<boolean> {
  if (ctx.role === "admin") return true;
  const [owner] = await db
    .select({ userId: workspaceOwners.userId })
    .from(workspaceOwners)
    .where(eq(workspaceOwners.orgId, ctx.orgId))
    .limit(1);
  if (owner?.userId === ctx.userId) return true;

  const [assignment] = await db
    .select({ rankId: rankAssignments.rankId })
    .from(rankAssignments)
    .where(and(eq(rankAssignments.orgId, ctx.orgId), eq(rankAssignments.userId, ctx.userId)))
    .limit(1);
  if (!assignment) return false;

  const rows = await db
    .select({
      id: workspaceRanks.id,
      name: workspaceRanks.name,
      allPermissions: workspaceRanks.allPermissions,
      permissions: workspaceRanks.permissions,
      allMetrics: workspaceRanks.allMetrics,
      metricKeys: workspaceRanks.metricKeys,
      inherits: workspaceRanks.inherits,
    })
    .from(workspaceRanks)
    .where(eq(workspaceRanks.orgId, ctx.orgId));
  const ranks = new Map<string, RankRow>(rows.map((r) => [r.id, r]));
  if (!ranks.has(assignment.rankId)) return false;
  const resolved = resolveRank(ranks, assignment.rankId);
  return resolved.allPermissions || resolved.permissions.has("manage_workspace");
}

/**
 * BACKFILL FOR ORGS OLDER THAN `workspace_owners`.
 *
 * New orgs get their owner row written by createOrganizationAction the moment
 * they are created. Orgs from before the table have nobody — so the first
 * settings visit claims the EARLIEST-created active membership, which is the
 * creator, because onboarding creates the org and its first membership in one
 * action. Idempotent by construction: the primary key on org_id means one
 * writer wins and every later call sees the winner. The memberships come from
 * the caller (the settings page already lists them for its own UI) so this
 * adds no WorkOS round trip.
 */
export async function claimOwnerIfMissing(
  db: DB,
  orgId: string,
  memberships: Array<{ userId: string; createdAt: string | Date }>,
): Promise<string | null> {
  const [existing] = await db
    .select({ userId: workspaceOwners.userId })
    .from(workspaceOwners)
    .where(eq(workspaceOwners.orgId, orgId))
    .limit(1);
  if (existing) return existing.userId;
  if (memberships.length === 0) return null;

  const earliest = [...memberships].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )[0];
  await db
    .insert(workspaceOwners)
    .values({ orgId, userId: earliest.userId, source: "backfill_earliest" })
    .onConflictDoNothing();
  // Re-read rather than assume: on a conflict, someone else's claim won.
  const [winner] = await db
    .select({ userId: workspaceOwners.userId })
    .from(workspaceOwners)
    .where(eq(workspaceOwners.orgId, orgId))
    .limit(1);
  return winner?.userId ?? null;
}
