"use server";

import { getWorkOS, withAuth, switchToOrganization, signOut } from "@workos-inc/authkit-nextjs";
import { getDb } from "@/db/client";
import { workspaceOwners } from "@/db/schema";

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
  // workspace with no owner row still works (canManageRanks falls back to
  // unranked members) and the settings page backfills on its next visit.
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
