"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { z } from "zod";
import { requireOrg } from "@/lib/auth";
import { invitationBelongsToOrg } from "@/lib/org-invites";

/**
 * Team invitations, riding entirely on WorkOS: `sendInvitation` sends the
 * email itself (its JSDoc: "Sends an invitation email to the recipient"), so
 * no email infrastructure is built here — Resend exists in this codebase for
 * ops alerts only (src/lib/alerts.ts).
 *
 * Every action derives the org from the session (requireOrg) and never from
 * the form; the one id that DOES arrive from the browser — the invitation id
 * on revoke — is walled off via invitationBelongsToOrg before the capability-
 * shaped WorkOS call runs.
 *
 * Outcomes travel as query params (?invited= / ?invite_error=), the same
 * zero-client-JS pattern as /integrations?error= — the page renders the
 * banner and a plain Link dismisses it.
 */

const emailSchema = z.string().trim().toLowerCase().email();

export async function inviteMemberAction(formData: FormData): Promise<void> {
  const { orgId, userId } = await requireOrg();
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) redirect("/dashboard/settings?invite_error=That doesn't look like an email address.");

  try {
    await getWorkOS().userManagement.sendInvitation({
      email: parsed.data,
      organizationId: orgId,
      inviterUserId: userId,
    });
  } catch (e) {
    // WorkOS 4xxs carry human-adjacent messages (already a member, already
    // invited); surface them rather than a stack trace.
    const msg = e instanceof Error ? e.message : String(e);
    redirect(`/dashboard/settings?invite_error=${encodeURIComponent(msg.slice(0, 200))}`);
  }
  revalidatePath("/dashboard/settings");
  redirect(`/dashboard/settings?invited=${encodeURIComponent(parsed.data)}`);
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  const { orgId } = await requireOrg();
  const invitationId = String(formData.get("invitationId") ?? "");
  if (!invitationId) redirect("/dashboard/settings?invite_error=Missing invitation.");

  const workos = getWorkOS();
  try {
    // TENANT WALL — see src/lib/org-invites.ts. revokeInvitation takes only
    // the id and the id came from the browser.
    const invitation = await workos.userManagement.getInvitation(invitationId);
    if (!invitationBelongsToOrg(invitation, orgId)) {
      redirect("/dashboard/settings?invite_error=That invitation is not part of this workspace.");
    }
    await workos.userManagement.revokeInvitation(invitationId);
  } catch (e) {
    // redirect() throws its own control-flow error — let it through.
    if (e && typeof e === "object" && "digest" in e) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    redirect(`/dashboard/settings?invite_error=${encodeURIComponent(msg.slice(0, 200))}`);
  }
  revalidatePath("/dashboard/settings");
  redirect("/dashboard/settings");
}
