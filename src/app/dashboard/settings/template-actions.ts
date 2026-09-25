"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireOrg } from "@/lib/auth";
import { canManageRanks, effectiveAccess } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";
import { getProfile } from "@/lib/profile";
import { ensureReferralCode } from "@/lib/referral-store";
import {
  TemplatesUnavailable,
  createTemplate,
  deleteTemplate,
  getTemplate,
  snapshotViews,
  updateTemplate,
} from "@/lib/templates/store";

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
 * string, the convention the rest of Settings follows for FormData actions.
 */

const BACK = "/dashboard/settings";
const back = (params: Record<string, string>): string =>
  `${BACK}?${new URLSearchParams(params).toString()}#templates`;

const nameSchema = z.string().trim().min(1, "Give the template a name.").max(80, "That name is too long.");
const descriptionSchema = z.string().trim().max(300, "Keep the description under 300 characters.");
const idSchema = z.string().min(1).max(64);

/** The governance gate, after the session one each action opens with. */
async function mustManage(ctx: Awaited<ReturnType<typeof requireOrg>>): Promise<void> {
  if (!(await canManageRanks(getDb(), ctx))) {
    redirect(back({ template_error: "Only workspace admins can share templates." }));
  }
}

/** A refusal the person can read, whatever threw. Never an internal message. */
function failed(e: unknown): never {
  if (e instanceof TemplatesUnavailable) redirect(back({ template_error: e.message }));
  console.error("[templates] act failed", e);
  redirect(back({ template_error: "Something went wrong saving that template. Try again in a moment." }));
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
  const name = nameSchema.safeParse(fd.get("name"));
  if (!name.success) redirect(back({ template_error: name.error.issues[0]?.message ?? "Give the template a name." }));
  const description = descriptionSchema.safeParse(fd.get("description") ?? "");
  if (!description.success) redirect(back({ template_error: description.error.issues[0]?.message ?? "That description won't work." }));
  const viewIds = fd.getAll("views").map(String);
  if (viewIds.length === 0) redirect(back({ template_error: "Pick at least one view to share." }));

  let id: string;
  try {
    const db = getDb();
    const access = await effectiveAccess(db, ctx);
    const built = await snapshotViews(db, ctx.orgId, viewIds, (key) => access.canSeeMetric(key));
    if (!built) redirect(back({ template_error: "Those views aren't in this workspace any more. Reload and pick again." }));
    // Referral credit is keyed on the author's code, which must be resolvable
    // by the time the first student signs up — see `recordReferral`.
    await ensureReferralCode(ctx.userId);
    ({ id } = await createTemplate(db, {
      orgId: ctx.orgId,
      createdBy: ctx.userId,
      authorName: await authorName(ctx),
      name: name.data,
      description: description.data || null,
      snapshot: built.snapshot,
      sourceViewIds: built.viewIds,
    }));
    await recordAudit(db, {
      action: "template.create",
      orgId: ctx.orgId,
      actorId: ctx.userId,
      target: id,
      detail: { views: built.viewIds.length },
    });
  } catch (e) {
    unstable_rethrow(e);
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
  const id = idSchema.safeParse(fd.get("id"));
  if (!id.success) redirect(back({ template_error: "Unknown template." }));
  const name = nameSchema.safeParse(fd.get("name"));
  if (!name.success) redirect(back({ template_error: name.error.issues[0]?.message ?? "Give the template a name." }));
  const description = descriptionSchema.safeParse(fd.get("description") ?? "");
  if (!description.success) redirect(back({ template_error: description.error.issues[0]?.message ?? "That description won't work." }));

  try {
    const db = getDb();
    const template = await getTemplate(db, ctx.orgId, id.data);
    if (!template) redirect(back({ template_error: "That template isn't in this workspace any more." }));
    const access = await effectiveAccess(db, ctx);
    const built = await snapshotViews(db, ctx.orgId, template.sourceViewIds, (key) => access.canSeeMetric(key));
    if (!built) {
      redirect(
        back({
          template_error: "Every view this template was made from has been deleted. Share a view again to make a new one.",
        }),
      );
    }
    await updateTemplate(db, ctx.orgId, id.data, {
      name: name.data,
      description: description.data || null,
      snapshot: built.snapshot,
      sourceViewIds: built.viewIds,
    });
    await recordAudit(db, {
      action: "template.update",
      orgId: ctx.orgId,
      actorId: ctx.userId,
      target: id.data,
      detail: { views: built.viewIds.length, version: template.version + 1 },
    });
  } catch (e) {
    unstable_rethrow(e);
    failed(e);
  }
  revalidatePath(BACK);
  redirect(back({ template_updated: id.data }));
}

/** Turn the link off (every visit and every use answers "not available") or back on. */
export async function setTemplateLinkAction(fd: FormData): Promise<void> {
  const ctx = await requireOrg();
  await mustManage(ctx);
  const id = idSchema.safeParse(fd.get("id"));
  if (!id.success) redirect(back({ template_error: "Unknown template." }));
  const enabled = fd.get("enabled") === "1";
  try {
    const db = getDb();
    if (await updateTemplate(db, ctx.orgId, id.data, { enabled })) {
      await recordAudit(db, {
        action: "template.link_toggle",
        orgId: ctx.orgId,
        actorId: ctx.userId,
        target: id.data,
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
  if (!id.success) redirect(back({ template_error: "Unknown template." }));
  try {
    const db = getDb();
    if (await deleteTemplate(db, ctx.orgId, id.data)) {
      await recordAudit(db, { action: "template.delete", orgId: ctx.orgId, actorId: ctx.userId, target: id.data });
    }
  } catch (e) {
    failed(e);
  }
  revalidatePath(BACK);
  redirect(back({}));
}
