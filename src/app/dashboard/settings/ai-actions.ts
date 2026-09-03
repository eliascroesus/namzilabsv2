"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { workspaceSettings } from "@/db/schema";
import { requireOrg } from "@/lib/auth";
import { canManageRanks } from "@/lib/permissions";
import { revokeGrant } from "@/lib/mcp/workspace";

/**
 * The two writes Settings → AI assistants needs. Both derive the org from
 * the session, never from the browser — same discipline as every other
 * action in this directory (see actions.ts).
 *
 * `setAiAssistantsEnabledAction` is the workspace-wide switch: owner or
 * `manage_workspace` only, same governance tier as inviting a member or
 * editing a role (canManageRanks).
 *
 * `disconnectAssistantAction` is narrower: a member may cut off their OWN
 * assistant (no governance needed to disconnect yourself), while cutting off
 * someone ELSE's requires the same governance tier.
 */

export async function setAiAssistantsEnabledAction(enabled: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireOrg();
  const db = getDb();
  if (!(await canManageRanks(db, ctx))) return { ok: false, error: "Only a workspace owner or admin can change this." };
  await db
    .insert(workspaceSettings)
    .values({ orgId: ctx.orgId, aiAssistantsEnabled: enabled, updatedAt: new Date() })
    .onConflictDoUpdate({ target: workspaceSettings.orgId, set: { aiAssistantsEnabled: enabled, updatedAt: new Date() } });
  revalidatePath("/dashboard/settings");
  return { ok: true };
}

export async function disconnectAssistantAction(userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireOrg();
  const db = getDb();
  if (userId !== ctx.userId && !(await canManageRanks(db, ctx))) {
    return { ok: false, error: "Only a workspace owner or admin can disconnect someone else's assistant." };
  }
  await revokeGrant(db, ctx.orgId, userId);
  revalidatePath("/dashboard/settings");
  return { ok: true };
}
