"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireOrg } from "@/lib/auth";
import { canManageRanks, effectiveAccess } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";
import { getProfile } from "@/lib/profile";
import { ensureReferralCode } from "@/lib/referral-store";
import type { TemplateErrorCode } from "@/lib/templates/messages";
import {
  TemplateRefusal,
  TemplatesUnavailable,
  createTemplate,
  deleteTemplate,
  getTemplate,
  snapshotViews,
  templateTag,
  updateTemplate,
} from "@/lib/templates/store";
import { PlanLimitError, assertFeature, upgradeHref } from "@/lib/billing/limits";

/**
 * SHARING A WORKSPACE'S STRUCTURE — the four acts on the Settings page.
 *
 * GOVERNANCE, SO `canManageRanks`. A template publishes the names of this
 * workspace's metrics and the shape of its boards to anyone holding a link, and
 * whether that may happen is the same kind of decision as who may be invited:
 * it is where the workspace's contents GO. So it takes the same gate invites
 * do, re-checked here on every act — the section being hidden from everyone
 * else is the courtesy, this is the wall.
 *
 * Every act lands back on the Templates section with its outcome in the query
 * string, as a CODE (`lib/templates/messages.ts`) — never as a sentence, since
 * a crafted settings link must not be able to put words on an admin's screen.
 *
 * EVERY ACT THAT CHANGES A TEMPLATE CLEARS ITS PUBLIC CACHE (`updateTag`), so
 * an update, a link switched off or a delete is what the very next visitor to
 * the link sees — see `getPublicTemplate`.
 */

const BACK = "/dashboard/settings";
const back = (params: Record<string, string>): string =>
  `${BACK}?${new URLSearchParams(params).toString()}#templates`;
const refuse = (code: TemplateErrorCode): never => redirect(back({ template_error: code }));

const nameSchema = z.string().trim().min(1).max(80);
const descriptionSchema = z.string().trim().max(300);
const idSchema = z.string().min(1).max(64);

/** The governance gate, after the session one each action opens with. */
async function mustManage(ctx: Awaited<ReturnType<typeof requireOrg>>): Promise<void> {
  if (!(await canManageRanks(getDb(), ctx))) refuse("admin");
}

/** Whatever threw, as a code the page can put into words. Never an internal message. */
function failed(e: unknown): never {
  unstable_rethrow(e);
  if (e instanceof TemplatesUnavailable) refuse("unavailable");
  if (e instanceof TemplateRefusal && (e.reason === "views" || e.reason === "size" || e.reason === "shape")) refuse(e.reason);
  console.error("[templates] act failed", e);
  return refuse("failed");
}

/**
 * THE NAME ON THE PUBLIC PAGE — the person's chosen display name, then their
 * WorkOS name, and otherwise nothing. Never the email: "Shared by
 * someone@gmail.com" on a page anybody with the link can open would publish an
 * address the person typed into a sign-up form, not onto a template.
 */
async function authorName(ctx: Awaited<ReturnType<typeof requireOrg>>): Promise<string | null> {
  const profile = await getProfile(ctx.userId, null);
  const workos = [ctx.auth.user.firstName, ctx.auth.user.lastName].filter(Boolean).join(" ").trim();
  return (profile.displayName ?? workos) || null;
}

export async function createTemplateAction(fd: FormData): Promise<void> {
  const ctx = await requireOrg();
  await mustManage(ctx);
  // Sharing templates is part of every paid plan; nothing changes with billing off.
  try {
    await assertFeature(getDb(), ctx.orgId, "shareTemplates");
  } catch (e) {
    if (e instanceof PlanLimitError) redirect(upgradeHref("shareTemplates"));
    throw e;
  }
  const name = nameSchema.safeParse(fd.get("name"));
  if (!name.success) refuse("name");
  const description = descriptionSchema.safeParse(fd.get("description") ?? "");
  if (!description.success) refuse("description");
  const viewIds = fd.getAll("views").map(String);
  if (viewIds.length === 0) refuse("views_none");

  let id = "";
  try {
    const db = getDb();
    const access = await effectiveAccess(db, ctx);
    const built = await snapshotViews(db, ctx.orgId, viewIds, (key) => access.canSeeMetric(key));
    if (!built) refuse("views_gone");
    // Referral credit is keyed on the author's code, which must be resolvable
    // by the time the first student signs up — see `recordReferral`.
    await ensureReferralCode(ctx.userId);
    ({ id } = await createTemplate(db, {
      orgId: ctx.orgId,
      createdBy: ctx.userId,
      authorName: await authorName(ctx),
      name: name.data!,
      description: description.data || null,
      snapshot: built!.snapshot,
      sourceViewIds: built!.viewIds,
    }));
    await recordAudit(db, {
      action: "template.create",
      orgId: ctx.orgId,
      actorId: ctx.userId,
      target: id,
      detail: { views: built!.viewIds.length },
    });
  } catch (e) {
    failed(e);
  }
  revalidatePath(BACK);
  redirect(back({ template_made: id }));
}

/**
 * RE-READ THE VIEWS IT WAS MADE FROM, and rename it if asked. Only FUTURE uses
 * see the change — a copy somebody already made is theirs.
 */
export async function updateTemplateAction(fd: FormData): Promise<void> {
  const ctx = await requireOrg();
  await mustManage(ctx);
  // Sharing templates is part of every paid plan; nothing changes with billing off.
  try {
    await assertFeature(getDb(), ctx.orgId, "shareTemplates");
  } catch (e) {
    if (e instanceof PlanLimitError) redirect(upgradeHref("shareTemplates"));
    throw e;
  }
  const id = idSchema.safeParse(fd.get("id"));
  if (!id.success) refuse("gone");
  const name = nameSchema.safeParse(fd.get("name"));
  if (!name.success) refuse("name");
  const description = descriptionSchema.safeParse(fd.get("description") ?? "");
  if (!description.success) refuse("description");

  try {
    const db = getDb();
    const template = await getTemplate(db, ctx.orgId, id.data!);
    if (!template) refuse("gone");
    const access = await effectiveAccess(db, ctx);
    const built = await snapshotViews(db, ctx.orgId, template!.sourceViewIds, (key) => access.canSeeMetric(key));
    if (!built) refuse("sources_gone");
    await updateTemplate(db, ctx.orgId, id.data!, {
      name: name.data!,
      description: description.data || null,
      snapshot: built!.snapshot,
      sourceViewIds: built!.viewIds,
    });
    updateTag(templateTag(template!.code));
    await recordAudit(db, {
      action: "template.update",
      orgId: ctx.orgId,
      actorId: ctx.userId,
      target: id.data!,
      detail: { views: built!.viewIds.length, version: template!.version + 1 },
    });
  } catch (e) {
    failed(e);
  }
  revalidatePath(BACK);
  redirect(back({ template_updated: id.data! }));
}

/** Turn the link off (every visit and every use answers "not available") or back on. */
export async function setTemplateLinkAction(fd: FormData): Promise<void> {
  const ctx = await requireOrg();
  await mustManage(ctx);
  const id = idSchema.safeParse(fd.get("id"));
  if (!id.success) refuse("gone");
  const enabled = fd.get("enabled") === "1";
  try {
    const db = getDb();
    const template = await getTemplate(db, ctx.orgId, id.data!);
    if (template && (await updateTemplate(db, ctx.orgId, template.id, { enabled }))) {
      updateTag(templateTag(template.code));
      await recordAudit(db, {
        action: "template.link_toggle",
        orgId: ctx.orgId,
        actorId: ctx.userId,
        target: template.id,
        detail: { enabled },
      });
    }
  } catch (e) {
    failed(e);
  }
  revalidatePath(BACK);
  redirect(back({}));
}

/** Delete it. Copies already made are untouched; only the link and the count go. */
export async function deleteTemplateAction(fd: FormData): Promise<void> {
  const ctx = await requireOrg();
  await mustManage(ctx);
  const id = idSchema.safeParse(fd.get("id"));
  if (!id.success) refuse("gone");
  try {
    const db = getDb();
    const template = await getTemplate(db, ctx.orgId, id.data!);
    if (template && (await deleteTemplate(db, ctx.orgId, template.id))) {
      updateTag(templateTag(template.code));
      await recordAudit(db, { action: "template.delete", orgId: ctx.orgId, actorId: ctx.userId, target: template.id });
    }
  } catch (e) {
    failed(e);
  }
  revalidatePath(BACK);
  redirect(back({}));
}
