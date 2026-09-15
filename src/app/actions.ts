"use server";

import { getWorkOS, withAuth, switchToOrganization, signOut } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { workspaceOwners } from "@/db/schema";
import { workspaceCap } from "@/lib/limits";
import { canManageRanks } from "@/lib/permissions";
import { revalidatePath } from "next/cache";

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
 * RENAME THE WORKSPACE YOU ARE IN.
 *
 * WorkOS is the only store of org identity — there is no local `organizations`
 * mirror to keep in step (one existed, was write-only, and went with migration
 * 0022) — so this is one `updateOrganization` call and a revalidate.
 *
 * IT RENAMES THE ACTIVE ORG AND TAKES NO ID FROM THE FORM, which is the whole
 * security design. A server action is a public endpoint whatever the menu
 * happens to be drawing, and an `organizationId` field would let anybody POST
 * a new name onto any organization whose id they could guess. `switchOrgAction`
 * can take one safely because WorkOS validates membership on the switch; there
 * is no equivalent check inside `updateOrganization`, so the id comes from the
 * SESSION instead and the question "may I rename this?" reduces to "am I in
 * it, with authority?".
 *
 * AUTHORITY IS `canManageRanks`, not membership. Renaming the workspace is
 * governance — it changes what the thing is called for everybody in it, the
 * same class of act as inviting a member or assigning a rank — and this
 * product deliberately separates "can use everything" from "can govern
 * everyone" (see `permissions.ts`: an unranked member gets full product access
 * and no governance). The switcher hides the control for anybody else, but
 * that is a courtesy; this is the wall.
 *
 * NO REDIRECT, unlike its two neighbours. Create and switch both move you to a
 * different workspace, so they end in `switchToOrganization`. A rename leaves
 * you exactly where you were and the only thing that changed is a word on
 * screen — `revalidatePath("/", "layout")` is what repaints the rail, the
 * switcher and the top bar, all of which read the name from the session's
 * organization on the server.
 */
export async function renameOrganizationAction(formData: FormData): Promise<void> {
  const auth = await withAuth({ ensureSignedIn: true });
  const orgId = auth.organizationId;
  if (!orgId) return;

  const name = String(formData.get("name") ?? "").trim();
  // Same bounds the create field enforces, restated here because a form post
  // is a public endpoint and `maxLength` on an input is a hint to a browser.
  if (!name || name.length > 60) return;

  const allowed = await canManageRanks(getDb(), { orgId, userId: auth.user.id, role: auth.role });
  if (!allowed) return;

  await getWorkOS().organizations.updateOrganization({ organization: orgId, name });

  // The name is read on the server in the rail, the switcher and the account
  // menu, so the whole layout is what has to come back — not just the page.
  revalidatePath("/", "layout");
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
