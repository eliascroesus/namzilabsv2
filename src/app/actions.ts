"use server";

import { getWorkOS, withAuth, switchToOrganization, signOut } from "@workos-inc/authkit-nextjs";
import { getDb } from "@/db/client";
import { organizations } from "@/db/schema";

/**
 * Create a new WorkOS organization (the tenant/workspace), add the current user
 * as a member, mirror its name locally for display, then switch the session
 * into it. `switchToOrganization` redirects, ending the action.
 */
export async function createOrganizationAction(formData: FormData): Promise<void> {
  const auth = await withAuth({ ensureSignedIn: true });
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const workos = getWorkOS();
  const org = await workos.organizations.createOrganization({ name });
  await workos.userManagement.createOrganizationMembership({
    organizationId: org.id,
    userId: auth.user.id,
  });

  // Best-effort local mirror for display; never blocks org creation.
  try {
    await getDb().insert(organizations).values({ id: org.id, name: org.name }).onConflictDoNothing();
  } catch {
    // DATABASE_URL may be unset in some environments; WorkOS remains source of truth.
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
