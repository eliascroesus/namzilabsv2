"use server";

import { redirect } from "next/navigation";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { getDb } from "@/db/client";
import { inngest } from "@/inngest/client";
import { recordAudit } from "@/lib/audit";
import { requireOrg, type OrgContext } from "@/lib/auth";
import { applyPlan } from "@/lib/billing/pauses";
import { isPaidPlan, type Interval, type PaidPlanId } from "@/lib/billing/plans";
import { billingEnabled, redeemCode, startTrial, workspacePlan } from "@/lib/billing/state";
import { createCheckout, createPortal } from "@/lib/billing/stripe";
import { canManageRanks } from "@/lib/permissions";

/**
 * THE ACTS BEHIND THE PLAN PICKER. Choosing a plan, paying, opening the
 * billing portal and redeeming a code are GOVERNANCE — the same people who can
 * manage ranks (the owner, admins, a rank with that permission) — because
 * each one changes what the whole workspace can do or what it is charged.
 */

const BILLING_PAGE = "/dashboard/settings/billing";

/** Only a path inside this app — never somewhere a crafted form could send them. */
function safeNext(raw: FormDataEntryValue | null): string {
  const s = typeof raw === "string" ? raw : "";
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\") ? s : "/dashboard";
}
const withParam = (path: string, param: string) => `${path}${path.includes("?") ? "&" : "?"}${param}`;
const appBase = () => (process.env.APP_BASE_URL ?? "https://namzilabs.co").replace(/\/$/, "");
const intervalOf = (raw: FormDataEntryValue | null): Interval => (raw === "year" ? "year" : "month");

async function mustGovern(ctx: OrgContext): Promise<void> {
  if (!(await canManageRanks(getDb(), ctx))) redirect(`${BILLING_PAGE}?error=role`);
}

/** Checkout for a plan, keeping whatever is left of a running trial. */
async function checkoutUrl(ctx: OrgContext, plan: PaidPlanId, interval: Interval): Promise<string> {
  const db = getDb();
  const current = await workspacePlan(db, ctx.orgId);
  const trialEnd = current.source === "trial" ? current.endsAt : null;
  const name = await getWorkOS()
    .organizations.getOrganization(ctx.orgId)
    .then((o) => o.name)
    .catch(() => "Namzilabs workspace");
  return createCheckout(db, { orgId: ctx.orgId, plan, interval, email: ctx.auth.user.email, name, trialEnd, returnBase: appBase() });
}

/**
 * THE PLAN STEP'S ONE BUTTON. Free goes straight on. A paid plan starts the
 * 30-day trial — no card — the first time this person asks; after that (a
 * second workspace, or a trial already used) it goes to Checkout instead.
 */
export async function choosePlanAction(formData: FormData): Promise<void> {
  const ctx = await requireOrg();
  if (!billingEnabled()) redirect("/dashboard");
  const next = safeNext(formData.get("next"));
  const plan = String(formData.get("plan") ?? "");
  if (plan === "free") redirect(next);
  if (!isPaidPlan(plan)) redirect(BILLING_PAGE);
  await mustGovern(ctx);

  const db = getDb();
  const trial = await startTrial(db, { orgId: ctx.orgId, userId: ctx.userId, plan });
  if (trial.ok) {
    await applyPlan(db, ctx.orgId).catch(() => {});
    await recordAudit(db, { action: "billing.trial_start", orgId: ctx.orgId, actorId: ctx.userId, detail: { plan } });
    try {
      await inngest.send({ name: "billing/trial.started", data: { orgId: ctx.orgId, userId: ctx.userId, plan, endsAt: trial.endsAt.toISOString() } });
    } catch (e) {
      // Reminders are a courtesy; the trial itself is already granted.
      console.error("[billing] trial reminder scheduling failed", e);
    }
    redirect(withParam(next, "welcome=trial"));
  }
  redirect(await checkoutUrl(ctx, plan, intervalOf(formData.get("interval"))));
}

/** Pay for a plan now — from the plan page, a trial banner, or the upgrade dialog. */
export async function startCheckoutAction(formData: FormData): Promise<void> {
  const ctx = await requireOrg();
  if (!billingEnabled()) redirect("/dashboard");
  const plan = String(formData.get("plan") ?? "");
  if (!isPaidPlan(plan)) redirect(BILLING_PAGE);
  await mustGovern(ctx);
  redirect(await checkoutUrl(ctx, plan, intervalOf(formData.get("interval"))));
}

/** Stripe's billing portal: card, invoices, cancel, plan and interval changes. */
export async function openPortalAction(): Promise<void> {
  const ctx = await requireOrg();
  await mustGovern(ctx);
  let url: string | null = null;
  try {
    url = await createPortal(getDb(), ctx.orgId, `${appBase()}${BILLING_PAGE}`);
  } catch (e) {
    console.error("[billing] portal failed", e);
  }
  redirect(url ?? `${BILLING_PAGE}?error=no_billing`);
}

/** Redeem an access code for this workspace. */
export async function redeemCodeAction(formData: FormData): Promise<void> {
  const ctx = await requireOrg();
  await mustGovern(ctx);
  const db = getDb();
  const r = await redeemCode(db, { orgId: ctx.orgId, code: String(formData.get("code") ?? "") });
  if (!r.ok) redirect(`${BILLING_PAGE}?code_error=${r.reason}`);
  await applyPlan(db, ctx.orgId).catch(() => {});
  await recordAudit(db, { action: "billing.code_redeem", orgId: ctx.orgId, actorId: ctx.userId, detail: { plan: r.plan, lifetime: r.endsAt == null } });
  const next = formData.get("next");
  redirect(next ? withParam(safeNext(next), "welcome=code") : `${BILLING_PAGE}?code=ok`);
}
