"use server";

import { getWorkOS, withAuth, switchToOrganization, signOut } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { workspaceOwners } from "@/db/schema";
import { workspaceCap } from "@/lib/limits";

/**
 * Create a new WorkOS organization (the tenant/workspace), add the current user
 * as a member, then switch the session into it. `switchToOrganization`
 * redirects, ending the action. WorkOS is the ONLY store of org identity —
 * an earlier local `organizations` mirror was write-only (nothing ever read
 * it back) and was dropped with migration 0022.
 */
export async function createOrganizationAction(formData: FormData): Promise<void> {
  const auth = await withAuth({ ensureSignedIn: true });
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const workos = getWorkOS();

  // Idempotency guard against the duplicate-workspace bug: a double-submit, a
  // retry, or an org-less session landing back on /onboarding must NOT mint a
  // second organization. If the user already belongs to an active org with this
  // exact name, switch into it instead of creating another.
  const existing = await workos.userManagement.listOrganizationMemberships({
    userId: auth.user.id,
    statuses: ["active"],
  });
  const dup = existing.data.find(
    (m) => (m.organizationName ?? "").trim().toLowerCase() === name.toLowerCase(),
  );
  if (dup) {
    await switchToOrganization(dup.organizationId, { returnTo: "/dashboard" });
    return;
  }

  /**
   * THE CAP, COUNTED IN WORKSPACES THIS PERSON OWNS.
   *
   * Not in memberships: being invited into a dozen workspaces must not consume
   * somebody's own allowance, and the count that matters for runaway tenants is
   * how many were CREATED. `workspace_owners` records exactly that at the only
   * moment it is certain — see the insert below — with `source = 'created'`
   * separating a real creation from the backfill that adopted pre-existing orgs.
   *
   * CHECKED AFTER THE DUPLICATE GUARD, on purpose. A double-submit at the cap
   * must still land you in the workspace you just made rather than refusing;
   * the guard above answers that case first and returns.
   *
   * IT IS THE SERVER'S ANSWER, NOT THE MENU'S. The switcher also hides the row
   * at the cap, but that is a courtesy — this is the wall, because a form post
   * is a public endpoint whatever the menu is currently drawing.
   */
  const cap = workspaceCap();
  const owned = await getDb()
    .select({ c: sql<number>`count(*)::int` })
    .from(workspaceOwners)
    .where(and(eq(workspaceOwners.userId, auth.user.id), eq(workspaceOwners.source, "created")))
    .then((r) => Number(r[0]?.c ?? 0))
    .catch(() => 0); // A read failure must not lock somebody out of their own product.
  if (owned >= cap) redirect(`/dashboard?error=workspace_limit`);

  const org = await workos.organizations.createOrganization({ name });
  const membership = await workos.userManagement.createOrganizationMembership({
    organizationId: org.id,
    userId: auth.user.id,
  });

  // THE CREATOR IS THE OWNER, recorded by US at the only moment the fact is
  // certain. WorkOS seeds every environment with a default `member` role and
  // has an `admin` slug only when roles are configured in its dashboard — so
  // authority has to be our database's fact, the way Slack/Notion/Linear do
  // it, with the IdP only authenticating. Best-effort, never fatal: a
  // workspace with no owner row still has full PRODUCT access for everyone
  // (the unranked default), but nobody can MANAGE ranks — canManageRanks
  // returns false with no owner row and no explicit grant — until the
  // settings page's backfill claims an owner on its next visit.
  try {
    await getDb().insert(workspaceOwners).values({ orgId: org.id, userId: auth.user.id, source: "created" }).onConflictDoNothing();
  } catch (e) {
    console.error(`[onboarding] owner row failed for ${org.id}: ${e instanceof Error ? e.message : String(e)}`);
  }
  // If the environment DOES define an admin role, wear it too — it makes the
  // zero-query admin short-circuit true for the creator. Roles are dashboard
  // config we cannot assume, so failure here is expected and silent.
  try {
    await workos.userManagement.updateOrganizationMembership(membership.id, { roleSlug: "admin" });
  } catch {
    /* no admin role configured — the workspace_owners row is the authority */
  }

  await switchToOrganization(org.id, { returnTo: "/dashboard" });
}

/**
 * Switch the active session to another organization the user belongs to.
 * WorkOS verifies membership; unauthorized switches redirect to re-auth.
 */
export async function switchOrgAction(formData: FormData): Promise<void> {
  const organizationId = String(formData.get("organizationId") ?? "");
  if (!organizationId) return;
  await switchToOrganization(organizationId, { returnTo: "/dashboard" });
}

/** End the session and return to the marketing home. */
export async function signOutAction(): Promise<void> {
  const returnTo = process.env.APP_BASE_URL;
  await signOut(returnTo ? { returnTo } : undefined);
}
