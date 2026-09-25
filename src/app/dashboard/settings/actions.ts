"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { rankAssignments, workspaceRanks } from "@/db/schema";
import { requireOrg } from "@/lib/auth";
import { invitationBelongsToOrg } from "@/lib/org-invites";
import { PERMISSIONS, type RankRow, canManageRanks } from "@/lib/permissions";
import { emailDomain, pseudonym, recordAudit } from "@/lib/audit";
import { PlanLimitError, assertCanInvite, upgradeHref } from "@/lib/billing/limits";

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
 *
 * EVERY ACT IN THIS FILE IS AUDITED, because every act in this file changes who
 * can reach the workspace's data — which is the whole test for what belongs in
 * `audit_log`. Invites and revocations move people in and out; the four rank
 * actions move the permissions underneath them, and a rank quietly widened is
 * the privilege escalation nobody notices. Rows are written only on the path
 * where the act actually committed, never on a rejected attempt.
 *
 * NO NAMES AND NO EMAILS REACH THE ROWS. An invited address is stored as a
 * truncated hash with its domain in the clear (see src/lib/audit.ts), and a
 * rank is identified by its id rather than the name somebody typed.
 */

const emailSchema = z.string().trim().toLowerCase().email();

export async function inviteMemberAction(formData: FormData): Promise<void> {
  const ctx = await requireOrg();
  const { orgId, userId } = ctx;
  // Inviting is GOVERNANCE, same tier as ranks: members never add members in
  // any of the products this model was measured against.
  if (!(await canManageRanks(getDb(), ctx))) redirect("/dashboard/settings?invite_error=Your role doesn't allow inviting members.");
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) redirect("/dashboard/settings?invite_error=That doesn't look like an email address.");
  // A seat is held from the moment an invitation is sent — see countMembers.
  try {
    await assertCanInvite(getDb(), orgId);
  } catch (e) {
    if (e instanceof PlanLimitError) redirect(upgradeHref("members"));
    throw e;
  }

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
  // The address is the one audited subject that genuinely IS personal data, so
  // it is hashed and only the domain is kept — enough to see an outsider being
  // invited in, not enough to read addresses out of the table.
  await recordAudit(getDb(), {
    action: "member.invite",
    orgId,
    actorId: userId,
    target: pseudonym(parsed.data),
    detail: { domain: emailDomain(parsed.data) },
  });

  revalidatePath("/dashboard/settings");
  redirect(`/dashboard/settings?invited=${encodeURIComponent(parsed.data)}`);
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  const ctx = await requireOrg();
  const { orgId } = ctx;
  if (!(await canManageRanks(getDb(), ctx))) redirect("/dashboard/settings?invite_error=Your role doesn't allow managing invitations.");
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
  await recordAudit(getDb(), { action: "member.invite_revoke", orgId, actorId: ctx.userId, target: invitationId });

  revalidatePath("/dashboard/settings");
  redirect("/dashboard/settings");
}

/**
 * Ranks: named permission bundles an admin assigns to members (schema:
 * workspace_ranks / rank_assignments; resolution: src/lib/permissions.ts).
 *
 * These return {ok,...} objects instead of riding the ?invite_error= query
 * params above because the rank editor is an interactive client surface, not
 * a plain form post. Admin-only — but via the WorkOS role slug, NOT a rank:
 * ranks restrict members, and the people who edit ranks must be un-restrictable
 * by construction or a bad edit could lock the editors out of the editor.
 */
const ADMIN_ONLY = "Your role doesn\u2019t allow managing roles.";

const KNOWN_PERMISSION_KEYS = new Set<string>(PERMISSIONS.map((p) => p.key));

/** Postgres unique-violation → the human sentence, everything else verbatim. */
function rankErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("workspace_ranks_org_name_uq")) return "A role with that name already exists.";
  return msg.slice(0, 200);
}

export async function createRankAction(
  name: string,
  /**
   * "admin" creates the Whop-style preset: every permission and every metric,
   * on. It is a STARTING POINT, not a special kind — the row it writes is an
   * ordinary rank whose masters are switched on, fully editable afterwards,
   * so there is no second code path for presets to drift from.
   */
  preset?: "admin",
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await requireOrg();
  const { orgId } = ctx;
  if (!(await canManageRanks(getDb(), ctx))) return { ok: false, error: ADMIN_ONLY };
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Give the role a name." };

  // Minted app-side (not a DB default) so `inherits` can hold rank ids as
  // plain strings — see the schema comment on workspace_ranks.
  const id = randomUUID();
  try {
    await getDb()
      .insert(workspaceRanks)
      .values({ id, orgId, name: trimmed, allPermissions: preset === "admin", allMetrics: preset === "admin" });
  } catch (e) {
    return { ok: false, error: rankErrorMessage(e) };
  }
  // The preset matters and the name does not: "an all-permissions role was
  // created" is the security event.
  await recordAudit(getDb(), {
    action: "rank.create",
    orgId,
    actorId: ctx.userId,
    target: id,
    detail: { preset: preset ?? "none", allPermissions: preset === "admin" },
  });

  revalidatePath("/dashboard/settings");
  return { ok: true, id };
}

export async function updateRankAction(
  rankId: string,
  patch: Partial<Pick<RankRow, "name" | "allPermissions" | "permissions" | "allMetrics" | "metricKeys" | "inherits">>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireOrg();
  const { orgId } = ctx;
  if (!(await canManageRanks(getDb(), ctx))) return { ok: false, error: ADMIN_ONLY };

  // Validate before touching the row: a patch is applied whole or not at all.
  if (patch.name !== undefined && !patch.name.trim()) return { ok: false, error: "Give the role a name." };
  // Self-inheritance is rejected at the door rather than trusted to the
  // cycle-safe resolver — it is always a mistake, so say so immediately.
  if (patch.inherits?.includes(rankId)) return { ok: false, error: "A role cannot inherit from itself." };
  // Inherited ids must be THIS org's ranks. The resolver skips unknown ids so
  // a foreign id was inert, but inert junk in a permissions table is exactly
  // where the next bug hides — reject it at the door instead.
  if (patch.inherits !== undefined && patch.inherits.length > 0) {
    const orgRanks = await getDb()
      .select({ id: workspaceRanks.id })
      .from(workspaceRanks)
      .where(eq(workspaceRanks.orgId, orgId));
    const known = new Set(orgRanks.map((r) => r.id));
    if (patch.inherits.some((i) => !known.has(i))) return { ok: false, error: "Unknown role in inherit list." };
  }
  if (patch.metricKeys?.some((k) => !/^(flow|metric):/.test(k))) {
    return { ok: false, error: "Metric keys must look like flow:<id> or metric:<id>." };
  }
  if (patch.permissions?.some((p) => !KNOWN_PERMISSION_KEYS.has(p))) {
    return { ok: false, error: "Unknown permission key." };
  }

  const set: Partial<typeof workspaceRanks.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.allPermissions !== undefined) set.allPermissions = patch.allPermissions;
  if (patch.permissions !== undefined) set.permissions = patch.permissions;
  if (patch.allMetrics !== undefined) set.allMetrics = patch.allMetrics;
  if (patch.metricKeys !== undefined) set.metricKeys = patch.metricKeys;
  if (patch.inherits !== undefined) set.inherits = patch.inherits;
  if (Object.keys(set).length === 0) return { ok: true }; // an empty patch changes nothing, truthfully

  let updated: Array<{ id: string }>;
  try {
    updated = await getDb()
      .update(workspaceRanks)
      .set(set)
      .where(and(eq(workspaceRanks.id, rankId), eq(workspaceRanks.orgId, orgId)))
      .returning({ id: workspaceRanks.id });
  } catch (e) {
    return { ok: false, error: rankErrorMessage(e) };
  }
  if (updated.length === 0) return { ok: false, error: "Role not found." };

  /**
   * WHAT WIDENED, not what it is called. The two master switches and the sizes
   * of the three lists are the whole security content of a rank edit: a role
   * going from four permissions to fourteen, or `allMetrics` flipping true, is
   * a privilege escalation whether or not anybody renamed it. `renamed` is a
   * flag rather than the string, so no user content enters the table.
   */
  await recordAudit(getDb(), {
    action: "rank.update",
    orgId,
    actorId: ctx.userId,
    target: rankId,
    detail: {
      renamed: patch.name !== undefined,
      allPermissions: patch.allPermissions ?? null,
      allMetrics: patch.allMetrics ?? null,
      permissions: patch.permissions?.length ?? null,
      metricKeys: patch.metricKeys?.length ?? null,
      inherits: patch.inherits?.length ?? null,
    },
  });

  revalidatePath("/dashboard/settings");
  return { ok: true };
}

export async function deleteRankAction(rankId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireOrg();
  const { orgId } = ctx;
  if (!(await canManageRanks(getDb(), ctx))) return { ok: false, error: ADMIN_ONLY };
  const db = getDb();

  const deleted = await db
    .delete(workspaceRanks)
    .where(and(eq(workspaceRanks.id, rankId), eq(workspaceRanks.orgId, orgId)))
    .returning({ id: workspaceRanks.id });
  if (deleted.length === 0) return { ok: false, error: "Role not found." };

  // A deleted rank must VANISH, not linger: its assignments go (holders fall
  // back to full access — see effectiveAccess), and it is stripped from every
  // other rank's inherits so the editor never renders a ghost parent. The
  // resolver would already skip an unknown id, so a crash between these steps
  // leaves stale references inert, never load-bearing.
  await db.delete(rankAssignments).where(and(eq(rankAssignments.orgId, orgId), eq(rankAssignments.rankId, rankId)));
  const others = await db
    .select({ id: workspaceRanks.id, inherits: workspaceRanks.inherits })
    .from(workspaceRanks)
    .where(eq(workspaceRanks.orgId, orgId));
  for (const other of others) {
    if (!other.inherits.includes(rankId)) continue;
    await db
      .update(workspaceRanks)
      .set({ inherits: other.inherits.filter((i) => i !== rankId) })
      .where(and(eq(workspaceRanks.id, other.id), eq(workspaceRanks.orgId, orgId)));
  }

  await recordAudit(getDb(), { action: "rank.delete", orgId, actorId: ctx.userId, target: rankId });

  revalidatePath("/dashboard/settings");
  return { ok: true };
}

export async function assignRankAction(
  memberUserId: string,
  rankId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireOrg();
  const { orgId } = ctx;
  if (!(await canManageRanks(getDb(), ctx))) return { ok: false, error: ADMIN_ONLY };
  if (!memberUserId) return { ok: false, error: "Missing member." };
  const db = getDb();

  // The member id arrives from the browser, same as the rank id below — but
  // nothing here ever validated it against WorkOS, so any string was accepted
  // as a member. Confirm an ACTIVE membership before either branch writes: a
  // crafted or stale id must not be able to plant a rank assignment, or clear
  // one, for someone who was never (or is no longer) in this workspace.
  const { data: memberships } = await getWorkOS().userManagement.listOrganizationMemberships({
    organizationId: orgId,
    userId: memberUserId,
    statuses: ["active"],
  });
  if (memberships.length === 0) return { ok: false, error: "That person is not a member of this workspace." };

  if (rankId === null) {
    // Clearing restores the no-rank default: full access, by design.
    await db.delete(rankAssignments).where(and(eq(rankAssignments.orgId, orgId), eq(rankAssignments.userId, memberUserId)));
  } else {
    // The rank id arrives from the browser — wall it to this org before writing.
    const [rank] = await db
      .select({ id: workspaceRanks.id })
      .from(workspaceRanks)
      .where(and(eq(workspaceRanks.id, rankId), eq(workspaceRanks.orgId, orgId)))
      .limit(1);
    if (!rank) return { ok: false, error: "Role not found." };
    // At most one rank per member (composite pk) — reassigning replaces.
    await db
      .insert(rankAssignments)
      .values({ orgId, userId: memberUserId, rankId })
      .onConflictDoUpdate({
        target: [rankAssignments.orgId, rankAssignments.userId],
        set: { rankId, assignedAt: new Date() },
      });
  }

  // `target` is the member whose access changed; `rank` is what they now hold,
  // with null meaning the no-rank default — which is FULL access here, so
  // clearing a rank is a widening and needs to be as visible as setting one.
  await recordAudit(getDb(), {
    action: "member.rank_assign",
    orgId,
    actorId: ctx.userId,
    target: memberUserId,
    detail: { rank: rankId, cleared: rankId === null },
  });

  revalidatePath("/dashboard/settings");
  return { ok: true };
}
