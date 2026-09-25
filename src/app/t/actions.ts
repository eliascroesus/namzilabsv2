"use server";

import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { getDb } from "@/db/client";
import { requireOrg } from "@/lib/auth";
import { effectiveAccess } from "@/lib/permissions";
import { boardHref } from "@/lib/board/href";
import { REFERRAL_COOKIE, REFERRAL_COOKIE_DAYS, referralCode } from "@/lib/referral";
import { TEMPLATE_COOKIE, templateCookieOptions } from "@/lib/templates/cookie";
import { getTemplateByCode, normaliseTemplateCode, TemplateRefusal, templatePath } from "@/lib/templates/store";
import { takeTemplate } from "@/lib/templates/use";

/**
 * THE TWO BUTTONS ON A TEMPLATE'S PAGE that are not "create a workspace" —
 * which goes through `createOrganizationAction`, the one place a workspace is
 * ever made.
 *
 * Every refusal lands back on the template's page with a CODE, never a
 * message: `/t/<code>?error=…` is a link anybody can craft and send, and a page
 * that printed whatever sentence it was handed would be a phishing kit with our
 * domain on it. The page maps the code to our own words.
 */

async function enabledTemplate(rawCode: FormDataEntryValue | null) {
  const code = normaliseTemplateCode(typeof rawCode === "string" ? rawCode : null);
  if (!code) redirect("/");
  const template = await getTemplateByCode(getDb(), code).catch(() => null);
  if (!template || !template.enabled || !template.snapshot) redirect(templatePath(code));
  return { code, template };
}

/**
 * SIGNED OUT, AND THEY WANT IT — remember the choice, credit the author, and
 * send them to make an account that comes straight back here.
 *
 * THE REFERRAL IS THE AUTHOR'S, and it overwrites any code already in the jar.
 * Last touch wins everywhere else too (`/r/CODE` sets it unconditionally), and
 * it is also plainly true here: the link they are acting on right now is the
 * coach's. The guards that decide whether it COUNTS — a new account, not the
 * author's own, once per person — are `recordReferral`'s, and run at sign-in
 * and again when the workspace is created.
 */
export async function startWithTemplateAction(fd: FormData): Promise<void> {
  const { code, template } = await enabledTemplate(fd.get("code"));
  const jar = await cookies();
  jar.set(TEMPLATE_COOKIE, code, templateCookieOptions);
  jar.set(REFERRAL_COOKIE, referralCode(template.createdBy), {
    ...templateCookieOptions,
    maxAge: REFERRAL_COOKIE_DAYS * 24 * 60 * 60,
  });
  redirect(`/signup?next=${encodeURIComponent(templatePath(code))}`);
}

/**
 * SIGNED IN, AND THEY WANT IT IN THE WORKSPACE THEY ARE IN — added after their
 * own tabs, never replacing any. Takes the same permission as adding a view
 * by hand, because it is adding views.
 */
export async function addTemplateToWorkspaceAction(fd: FormData): Promise<void> {
  const { code, template } = await enabledTemplate(fd.get("code"));
  const ctx = await requireOrg();
  const db = getDb();
  const access = await effectiveAccess(db, ctx);
  if (!access.can("create_flows")) redirect(`${templatePath(code)}?error=rank`);

  let first: string | undefined;
  try {
    ({
      viewIds: [first],
    } = await takeTemplate(db, { template, orgId: ctx.orgId, userId: ctx.userId, newWorkspace: false }));
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof TemplateRefusal) redirect(`${templatePath(code)}?error=${e.reason}`);
    console.error("[templates] add to workspace failed", e);
    redirect(`${templatePath(code)}?error=failed`);
  }
  (await cookies()).delete(TEMPLATE_COOKIE);
  redirect(boardHref({ view: first }));
}
