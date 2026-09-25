import { eq } from "drizzle-orm";
import { workspaceOwners } from "@/db/schema";
import type { DB } from "@/db/types";
import { PLANS } from "./plans";
import { billingEnabled, workspacePlan } from "./state";

/**
 * SEATS — who may use a workspace on its current plan.
 *
 * The owner always. Then the earliest members, by when they joined, up to the
 * plan's limit (which counts the owner). Anyone later is not removed — they
 * see "ask the owner to upgrade", and an upgrade lets them straight back in.
 */

export type Membership = { userId: string; createdAt: string };

export function seatAllowed(input: { userId: string; ownerId: string | null; memberships: Membership[]; limit: number }): boolean {
  const { userId, ownerId, memberships, limit } = input;
  if (ownerId && userId === ownerId) return true;
  if (!memberships.some((m) => m.userId === userId)) return false;
  const seats = Math.max(0, limit - (ownerId ? 1 : 0));
  const seated = memberships
    .filter((m) => m.userId !== ownerId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.userId.localeCompare(b.userId))
    .slice(0, seats)
    .map((m) => m.userId);
  return seated.includes(userId);
}

/**
 * The seat check for one person in one workspace. The owner and a disabled
 * billing switch answer without asking the identity provider anything; only a
 * non-owner on a live plan costs a membership list (injectable for tests).
 */
export async function checkSeat(
  db: DB,
  orgId: string,
  userId: string,
  listMemberships: () => Promise<Membership[]>,
): Promise<boolean> {
  if (!billingEnabled()) return true;
  const [owner] = await db.select({ userId: workspaceOwners.userId }).from(workspaceOwners).where(eq(workspaceOwners.orgId, orgId)).limit(1);
  if (owner?.userId === userId) return true;
  const { plan } = await workspacePlan(db, orgId);
  return seatAllowed({ userId, ownerId: owner?.userId ?? null, memberships: await listMemberships(), limit: PLANS[plan].limits.members });
}
