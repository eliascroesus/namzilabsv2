"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getWorkOS, signOut, switchToOrganization, withAuth } from "@workos-inc/authkit-nextjs";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { workspaceOwners } from "@/db/schema";
import { requireOrg } from "@/lib/auth";
import { destroyUserData, destroyWorkspaceData } from "@/lib/destroy";

/**
 * THE THREE IRREVERSIBLE ACTS: hand a workspace over, destroy a workspace,
 * destroy an account. Hard deletes with no grace period, at the owner's
 * instruction — the Notion and Zapier shape rather than the 30-day bin.
 *
 * ═══ FOUR RULES HOLD ACROSS ALL THREE ═══
 *
 * 1. THE ORG COMES FROM THE SESSION, NEVER FROM THE FORM. A server action is a
 *    public endpoint whatever page is drawing it, and an `organizationId` field
 *    on a DELETE would let anybody destroy any workspace whose id they could
 *    guess. The only id read from a form is the TARGET MEMBER on transfer, and
 *    that one is walled by a membership check before it is used.
 *
 * 2. OWNER ONLY — not `canManageRanks`. That gate is right for inviting people
 *    and assigning roles, and wrong here: an admin who may govern a workspace
 *    may not end it, and may certainly not hand it to somebody else. Ownership
 *    is one row in `workspace_owners`, and it is the whole authority for this
 *    file.
 *
 * 3. THE NAME MUST BE TYPED BACK. Not a courtesy in the browser — the
 *    confirmation is part of the CONTRACT, so no path (a form, a script, a
 *    future admin tool) can destroy something without having established which
 *    thing. Exactly the rule `deleteConnectionData` already enforces.
 *
 * 4. OUR DATA GOES BEFORE WORKOS DOES. Every one of these ends in a WorkOS call
 *    that cannot be undone and cannot be retried against a user or org that no
 *    longer exists. If our sweep fails halfway, the workspace still exists and
 *    the customer can press the button again; if WorkOS went first, they would
 *    be locked out of a tenant still holding all their data.
 */

/** Is this person the workspace's owner? The only authority in this file. */
async function isOwner(orgId: string, userId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ userId: workspaceOwners.userId })
    .from(workspaceOwners)
    .where(eq(workspaceOwners.orgId, orgId))
    .limit(1);
  return row?.userId === userId;
}

const back = (msg: string) => redirect(`/dashboard/settings?danger_error=${encodeURIComponent(msg.slice(0, 200))}`);

/**
 * HAND THE WORKSPACE TO SOMEBODY ELSE.
 *
 * The prerequisite for an owner ever leaving cleanly: without it, the only way
 * out of owning a workspace other people depend on is to destroy it.
 *
 * THE NEW OWNER MUST ALREADY BE AN ACTIVE MEMBER, checked against WorkOS rather
 * than trusted from the form. Otherwise this is an endpoint that assigns
 * ownership of a workspace to an arbitrary user id.
 *
 * IT DOES NOT TOUCH THE OLD OWNER'S MEMBERSHIP. They stay in the workspace as
 * an ordinary member; handing over the keys is not the same act as leaving, and
 * a transfer that silently ejected you would be a surprise with no undo.
 */
export async function transferOwnershipAction(formData: FormData): Promise<void> {
  const { orgId, userId } = await requireOrg();
  if (!(await isOwner(orgId, userId))) back("Only the workspace owner can transfer ownership.");

  const target = String(formData.get("userId") ?? "").trim();
  if (!target) back("Pick who should own this workspace.");
  if (target === userId) back("You already own this workspace.");

  const members = await getWorkOS()
    .userManagement.listOrganizationMemberships({ organizationId: orgId, statuses: ["active"] })
    .then((r) => r.data)
    .catch(() => []);
  if (!members.some((m) => m.userId === target)) back("That person is not an active member of this workspace.");

  await getDb()
    .update(workspaceOwners)
    .set({ userId: target })
    .where(and(eq(workspaceOwners.orgId, orgId), eq(workspaceOwners.userId, userId)));

  revalidatePath("/", "layout");
  redirect("/dashboard/settings?danger_done=transferred");
}

/**
 * DESTROY THE WORKSPACE THIS SESSION IS IN.
 *
 * Twenty-five tables, every connection's provider webhook torn down first, then
 * the organization itself — which is what removes every other member's access,
 * because WorkOS deleting an organization deletes its memberships.
 *
 * `switchToOrganization` at the end rather than a bare redirect: the session
 * still names an org that no longer exists, and every authenticated route would
 * throw on it. Falling back to `/onboarding` is the honest destination for
 * somebody who just deleted their only workspace.
 */
export async function deleteWorkspaceAction(formData: FormData): Promise<void> {
  const { orgId, userId } = await requireOrg();
  if (!(await isOwner(orgId, userId))) back("Only the workspace owner can delete it.");

  const workos = getWorkOS();
  const org = await workos.organizations.getOrganization(orgId).catch(() => null);
  if (!org) back("This workspace could not be read, so nothing was deleted.");

  const typed = String(formData.get("confirm") ?? "").trim();
  if (typed !== org!.name.trim()) back("The name did not match, so nothing was deleted.");

  // OURS FIRST — see rule 4. A half-finished sweep leaves a workspace that can
  // be deleted again; a deleted org leaves data nobody can reach.
  const result = await destroyWorkspaceData(getDb(), orgId);
  console.info("[destroy] workspace", orgId, JSON.stringify(result.rows));

  await workos.organizations.deleteOrganization(orgId);

  // The session still points at an org that is gone. Move it, or every route
  // after this throws on a tenant that no longer exists.
  const rest = await workos.userManagement
    .listOrganizationMemberships({ userId, statuses: ["active"] })
    .then((r) => r.data.filter((m) => m.organizationId !== orgId))
    .catch(() => []);
  if (rest[0]) await switchToOrganization(rest[0].organizationId, { returnTo: "/dashboard" });
  redirect("/onboarding");
}

/**
 * DESTROY THE ACCOUNT, AND EVERY WORKSPACE IT OWNS.
 *
 * The owner's instruction, in their words: deleting an account takes the
 * workspaces it owns with it, evicting the members. That is the Notion shape,
 * and it is the only coherent one once ownership is a single row — a workspace
 * whose owner has gone has nobody who may delete it, which is how orphans
 * accumulate.
 *
 * WORKSPACES THEY MERELY BELONG TO SURVIVE. Their membership does not: the
 * workspace is somebody else's, and removing the person from it is the whole of
 * what leaving means.
 *
 * THE WORKOS USER IS THE LAST THING DELETED, deliberately. It is the one step
 * that cannot be retried — once the user is gone there is no session to
 * authenticate a second attempt — so everything that CAN be retried happens
 * first. A failure halfway leaves an account that can press the button again.
 */
export async function deleteAccountAction(formData: FormData): Promise<void> {
  const auth = await withAuth({ ensureSignedIn: true });
  const userId = auth.user.id;

  const typed = String(formData.get("confirm") ?? "").trim();
  // The email rather than a workspace name: this act is not about any one
  // workspace, and an account has exactly one name its owner cannot mistype.
  if (typed.toLowerCase() !== (auth.user.email ?? "").trim().toLowerCase()) {
    redirect(`/dashboard/profile?danger_error=${encodeURIComponent("The email did not match, so nothing was deleted.")}`);
  }

  const workos = getWorkOS();
  const memberships = await workos.userManagement
    .listOrganizationMemberships({ userId, statuses: ["active"] })
    .then((r) => r.data)
    .catch(() => []);

  for (const m of memberships) {
    if (await isOwner(m.organizationId, userId)) {
      // Theirs — it goes, and everybody in it loses access when the org does.
      const result = await destroyWorkspaceData(getDb(), m.organizationId);
      console.info("[destroy] owned workspace", m.organizationId, JSON.stringify(result.rows));
      await workos.organizations.deleteOrganization(m.organizationId).catch((e) => {
        console.error("[destroy] org delete failed", m.organizationId, e);
      });
    } else {
      // Somebody else's — the workspace stays, this person does not.
      await workos.userManagement.deleteOrganizationMembership(m.id).catch((e) => {
        console.error("[destroy] membership removal failed", m.id, e);
      });
    }
  }

  const rows = await destroyUserData(getDb(), userId);
  console.info("[destroy] account", userId, JSON.stringify(rows));

  await workos.userManagement.deleteUser(userId);
  // The session's user is gone; ending it is the only correct next state.
  await signOut(process.env.APP_BASE_URL ? { returnTo: process.env.APP_BASE_URL } : undefined);
}
