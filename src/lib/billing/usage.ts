import { and, count, eq, ne } from "drizzle-orm";
import { connections, flowResults, flows } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * WHAT A WORKSPACE USES, counted the way a customer would count it.
 *
 * An app is a connection that is not disabled — an app in `error` is still
 * theirs and still counts. A metric is a number the board shows: a result row
 * of a PUBLISHED flow, the same join `publishedFlowTiles` makes, so the count
 * on the plan page and the tiles on the board can never disagree.
 */

export async function countApps(db: DB, orgId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(connections)
    .where(and(eq(connections.orgId, orgId), ne(connections.status, "disabled")));
  return Number(row?.n ?? 0);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function countMetrics(db: DB, orgId: string, opts: { excludeFlowId?: string } = {}): Promise<number> {
  // A flow that has never been saved has no id the column could hold; there is
  // nothing of its own to leave out, and comparing the uuid column to it would
  // throw instead of counting.
  const exclude = opts.excludeFlowId && UUID.test(opts.excludeFlowId) ? opts.excludeFlowId : null;
  const [row] = await db
    .select({ n: count() })
    .from(flowResults)
    .innerJoin(flows, eq(flows.id, flowResults.flowId))
    .where(
      and(
        eq(flowResults.orgId, orgId),
        eq(flows.status, "published"),
        ...(exclude ? [ne(flowResults.flowId, exclude)] : []),
      ),
    );
  return Number(row?.n ?? 0);
}

/**
 * Everyone in the workspace, owner included, plus invitations still open — an
 * invite holds a seat from the moment it is sent, or a Free workspace could
 * send twenty and let them land later.
 */
export async function countMembers(orgId: string): Promise<number> {
  // Loaded here, not at the top: the AuthKit package pulls in `next/cache`,
  // which only resolves inside Next — and every other function in this module
  // is plain SQL that tests import directly.
  const { getWorkOS } = await import("@workos-inc/authkit-nextjs");
  const workos = getWorkOS();
  const [members, invites] = await Promise.all([
    workos.userManagement.listOrganizationMemberships({ organizationId: orgId, statuses: ["active"], limit: 100 }),
    workos.userManagement.listInvitations({ organizationId: orgId, limit: 100 }),
  ]);
  const pending = invites.data.filter((i) => i.state === "pending").length;
  return members.data.length + pending;
}
