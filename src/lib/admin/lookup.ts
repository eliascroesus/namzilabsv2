import { desc, eq, sql } from "drizzle-orm";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import {
  auditLog,
  connections,
  dashboardTiles,
  events,
  flows,
  mcpGrants,
  metrics,
  workspaceOwners,
} from "@/db/schema";
import { getDb } from "@/db/client";
import { requireStaff } from "@/lib/admin/access";

/**
 * LOOK ONE WORKSPACE UP — and only when somebody asks.
 *
 * ═══ WHY THERE IS NO LIST ═══
 *
 * The obvious admin dashboard renders every workspace in a table. At a
 * thousand customers that is a page nobody can read, backed by a query that
 * runs on every load, and the owner's instruction was the opposite: be as cheap
 * as possible, search when needed, and ten seconds is fine.
 *
 * So nothing here runs on page load. The search page renders an empty form; a
 * query happens only when it is submitted with a term. That is the whole
 * cost model — an idle admin dashboard costs one round trip for the overview
 * and nothing at all for this file.
 *
 * ═══ WHAT WORKOS CAN AND CANNOT SEARCH, WHICH SHAPED ALL OF THIS ═══
 *
 * Workspace names and account emails are not in our database. WorkOS owns
 * them, and its API is uneven:
 *
 *   - `listUsers({ email })`  — filters server-side. Exact, one request.
 *   - `listOrganizations()`   — takes `domains` and pagination and NOTHING for
 *                               names. There is no way to ask "which orgs are
 *                               called FSR".
 *
 * Hence three lookups rather than one box that does everything:
 *
 *   BY EMAIL      the good path. One WorkOS call to find the person, one to
 *                 list their memberships, then one cheap rollup per workspace.
 *                 This is the path support actually needs — somebody writes in,
 *                 you have their address.
 *   BY ORG ID     free. Paste the id out of a log line or an error report.
 *   BY NAME       the expensive one, because it has to PAGE THROUGH every
 *                 organization and filter locally. Bounded at
 *                 `NAME_SCAN_PAGES` × 100 and it says so when it gives up —
 *                 an admin tool that silently returns partial results is worse
 *                 than one that admits the limit.
 *
 * ═══ THE LINE ON WHAT IS SHOWN ═══
 *
 * Counts, health and identity — never contents. How many flows, not what they
 * compute. How many tiles, not what they say. Connection sources and status,
 * never a credential and never `last_error`, which is a provider string that
 * can quote a customer's own data back. The operator can see the shape of a
 * workspace and who to email about it; they cannot read it.
 */

/** Pages of 100 organizations to walk before giving up on a name search. */
const NAME_SCAN_PAGES = 20;

export type WorkspaceCard = {
  orgId: string;
  name: string | null;
  ownerUserId: string | null;
  ownerEmail: string | null;
  members: number | null;
  connections: Array<{ source: string; status: string; syncStatus: string }>;
  flows: number;
  metrics: number;
  tiles: number;
  aiGrants: number;
  events: number;
  claimedAt: Date | null;
  recentGovernance: Array<{ action: string; at: Date }>;
};

const one = (rows: Array<{ n: unknown }>): number => Number(rows[0]?.n ?? 0);

/**
 * Everything the dashboard shows about one workspace.
 *
 * Sequential by design — see the note in `fleet.ts` about `MIN_POOL_MAX` being
 * derived arithmetic that a wider fan-out would invalidate.
 *
 * `events` IS counted exactly here, unlike on the overview. The difference is
 * scope: one org's slice is bounded by an index, where the fleet-wide figure
 * would be a full scan. A per-workspace volume is also the number an operator
 * is actually deciding on.
 */
export async function workspaceCard(orgId: string): Promise<WorkspaceCard | null> {
  await requireStaff();
  const db = getDb();
  const workos = getWorkOS();

  const [owner] = await db
    .select({ userId: workspaceOwners.userId, claimedAt: workspaceOwners.claimedAt })
    .from(workspaceOwners)
    .where(eq(workspaceOwners.orgId, orgId))
    .limit(1);

  const org = await workos.organizations.getOrganization(orgId).catch(() => null);
  // Neither WorkOS nor we have heard of it — a mistyped id, not an empty
  // workspace. Distinguishing those matters: one is a typo, the other is the
  // orphan state `scripts/orphaned-tenants.ts` exists to find.
  if (!org && !owner) return null;

  const conns = await db
    .select({ source: connections.source, status: connections.status, syncStatus: connections.syncStatus })
    .from(connections)
    .where(eq(connections.orgId, orgId));

  const flowCount = one(await db.select({ n: sql<number>`count(*)::int` }).from(flows).where(eq(flows.orgId, orgId)));
  const metricCount = one(await db.select({ n: sql<number>`count(*)::int` }).from(metrics).where(eq(metrics.orgId, orgId)));
  const tileCount = one(
    await db.select({ n: sql<number>`count(*)::int` }).from(dashboardTiles).where(eq(dashboardTiles.orgId, orgId)),
  );
  const grantCount = one(
    await db.select({ n: sql<number>`count(*)::int` }).from(mcpGrants).where(eq(mcpGrants.orgId, orgId)),
  );
  // `events_org_*` indexes make this cheap for one tenant; see the note above.
  const eventCount = one(
    await db.select({ n: sql<number>`count(*)::int` }).from(events).where(eq(events.orgId, orgId)),
  );

  const recentGovernance = await db
    .select({ action: auditLog.action, at: auditLog.at })
    .from(auditLog)
    .where(eq(auditLog.orgId, orgId))
    .orderBy(desc(auditLog.at))
    .limit(10);

  const ownerEmail = owner?.userId
    ? await workos.userManagement
        .getUser(owner.userId)
        .then((u) => u.email)
        .catch(() => null)
    : null;

  const members = await workos.userManagement
    .listOrganizationMemberships({ organizationId: orgId, statuses: ["active"] })
    .then((r) => r.data.length)
    .catch(() => null);

  return {
    orgId,
    name: org?.name ?? null,
    ownerUserId: owner?.userId ?? null,
    ownerEmail,
    members,
    connections: conns,
    flows: flowCount,
    metrics: metricCount,
    tiles: tileCount,
    aiGrants: grantCount,
    events: eventCount,
    claimedAt: owner?.claimedAt ?? null,
    recentGovernance,
  };
}

export type SearchResult = {
  kind: "email" | "orgId" | "name";
  orgIds: string[];
  /** Set when a name scan hit its page cap, so the UI can say the list is partial. */
  truncated: boolean;
  note: string | null;
};

/** `org_…` ids are opaque but recognisable, which is what makes paste-to-search work. */
const looksLikeOrgId = (q: string) => /^org_[A-Za-z0-9]+$/.test(q);

/**
 * Turn whatever was typed into a set of workspace ids.
 *
 * Runs NOTHING unless `query` is non-empty — the page calls this only on submit.
 */
export async function findWorkspaces(query: string): Promise<SearchResult> {
  await requireStaff();
  const q = query.trim();
  if (!q) return { kind: "name", orgIds: [], truncated: false, note: null };

  const workos = getWorkOS();

  if (looksLikeOrgId(q)) {
    return { kind: "orgId", orgIds: [q], truncated: false, note: null };
  }

  if (q.includes("@")) {
    // THE GOOD PATH — WorkOS filters this server-side, so it is two requests
    // regardless of how many customers exist.
    const users = await workos.userManagement.listUsers({ email: q.toLowerCase(), limit: 10 }).catch(() => null);
    const user = users?.data[0];
    if (!user) return { kind: "email", orgIds: [], truncated: false, note: "No account with that email." };
    const memberships = await workos.userManagement
      .listOrganizationMemberships({ userId: user.id, statuses: ["active"] })
      .then((r) => r.data)
      .catch(() => []);
    return {
      kind: "email",
      orgIds: memberships.map((m) => m.organizationId),
      truncated: false,
      note: memberships.length === 0 ? "That account exists but belongs to no active workspace." : null,
    };
  }

  /**
   * THE EXPENSIVE PATH. WorkOS cannot filter organizations by name, so this
   * walks them. Bounded, and honest about the bound — at twenty pages it stops
   * and says the answer may be incomplete rather than implying it is the whole
   * set.
   */
  const needle = q.toLowerCase();
  const found: string[] = [];
  let after: string | undefined;
  let pages = 0;
  let truncated = false;
  for (;;) {
    const page = await workos.organizations.listOrganizations({ limit: 100, after }).catch(() => null);
    if (!page) break;
    for (const org of page.data) {
      if (org.name.toLowerCase().includes(needle)) found.push(org.id);
    }
    pages++;
    after = page.listMetadata?.after ?? undefined;
    if (!after) break;
    if (pages >= NAME_SCAN_PAGES) {
      truncated = true;
      break;
    }
  }
  return {
    kind: "name",
    orgIds: found.slice(0, 25),
    truncated,
    note: truncated ? `Stopped after ${NAME_SCAN_PAGES * 100} workspaces — search by email or paste an org id to be certain.` : null,
  };
}
