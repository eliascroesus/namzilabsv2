import { and, count, desc, eq, gt, inArray, isNull, like, lte, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import { accessGrants, auditLog, billingSubscriptions, planPauses, promoCodes, referrals, workspaceAcquisitions, workspaceOwners } from "@/db/schema";
import { requireStaff } from "@/lib/admin/access";
import { monthlyEquivalent, isPaidPlan } from "@/lib/billing/plans";
import type { ResolvedPlan } from "@/lib/billing/resolve";
import { listGrants, workspacePlan, type GrantRow } from "@/lib/billing/state";
import { linkFunnel } from "@/lib/growth/links";

/**
 * THE BACK OFFICE'S READS ABOUT MONEY AND GROWTH. Every function calls
 * `requireStaff()` for itself, as everything in `src/lib/admin/` does — the
 * layout's gate is the outer wall, not the only one.
 */

const PAYING = ["active", "past_due"];

export type BillingOverview = {
  paying: number;
  /** Whole dollars a month: list prices, yearly plans divided by twelve. Discounts and credits are not netted. */
  mrr: number;
  trialsActive: number;
  launchStartedAt: Date | null;
  byPlan: Array<{ plan: string; n: number }>;
  /** Apps paused because a plan shrank — the ones switching billing off would strand. */
  planPaused: number;
};

export async function billingOverview(now = new Date()): Promise<BillingOverview> {
  await requireStaff();
  const db = getDb();
  const subs = await db
    .select({ orgId: billingSubscriptions.orgId, plan: billingSubscriptions.plan, interval: billingSubscriptions.interval, status: billingSubscriptions.status })
    .from(billingSubscriptions)
    .where(inArray(billingSubscriptions.status, [...PAYING, "trialing"]));
  const paying = subs.filter((s) => PAYING.includes(s.status ?? ""));
  const mrr = paying.reduce((sum, s) => (isPaidPlan(s.plan) ? sum + monthlyEquivalent(s.plan, s.interval === "year" ? "year" : "month") : sum), 0);

  // Distinct workspaces: one on an in-app trial that has since added a card
  // holds a trial grant AND a trialing subscription, and is one trial.
  const trialGrantOrgs = await db
    .selectDistinct({ orgId: accessGrants.orgId })
    .from(accessGrants)
    .where(
      and(
        inArray(accessGrants.kind, ["trial", "launch"]),
        isNull(accessGrants.revokedAt),
        lte(accessGrants.startsAt, now),
        gt(accessGrants.endsAt, now),
      ),
    );
  const [launch] = await db
    .select({ at: accessGrants.createdAt })
    .from(accessGrants)
    .where(eq(accessGrants.kind, "launch"))
    .orderBy(accessGrants.createdAt)
    .limit(1);

  const [paused] = await db.select({ n: count() }).from(planPauses);

  const byPlan = new Map<string, number>();
  for (const s of paying) byPlan.set(s.plan ?? "unknown", (byPlan.get(s.plan ?? "unknown") ?? 0) + 1);
  return {
    planPaused: Number(paused?.n ?? 0),
    paying: paying.length,
    mrr: Math.round(mrr),
    trialsActive: new Set([...trialGrantOrgs.map((g) => g.orgId), ...subs.filter((s) => s.status === "trialing").map((s) => s.orgId)]).size,
    launchStartedAt: launch?.at ?? null,
    byPlan: [...byPlan].map(([plan, n]) => ({ plan, n })),
  };
}

export type WorkspaceBilling = {
  plan: ResolvedPlan;
  subscription: typeof billingSubscriptions.$inferSelect | null;
  grants: Array<GrantRow & { code: string | null }>;
  acquisition: typeof workspaceAcquisitions.$inferSelect | null;
  /** People the workspace's owner has brought, across every workspace they own. */
  referrals: number;
};

export async function workspaceBilling(orgId: string): Promise<WorkspaceBilling> {
  await requireStaff();
  const db = getDb();
  const [plan, grants, [subscription], [acquisition], [owner]] = await Promise.all([
    workspacePlan(db, orgId),
    listGrants(db, orgId),
    db.select().from(billingSubscriptions).where(eq(billingSubscriptions.orgId, orgId)).limit(1),
    db.select().from(workspaceAcquisitions).where(eq(workspaceAcquisitions.orgId, orgId)).limit(1),
    db.select({ userId: workspaceOwners.userId }).from(workspaceOwners).where(eq(workspaceOwners.orgId, orgId)).limit(1),
  ]);
  const codeIds = grants.map((g) => g.promoCodeId).filter((x): x is string => Boolean(x));
  const codes = codeIds.length ? await db.select({ id: promoCodes.id, code: promoCodes.code }).from(promoCodes).where(inArray(promoCodes.id, codeIds)) : [];
  const [refs] = owner ? await db.select({ n: count() }).from(referrals).where(eq(referrals.referrerUserId, owner.userId)) : [{ n: 0 }];
  return {
    plan,
    subscription: subscription ?? null,
    grants: grants.map((g) => ({ ...g, code: codes.find((c) => c.id === g.promoCodeId)?.code ?? null })),
    acquisition: acquisition ?? null,
    referrals: Number(refs?.n ?? 0),
  };
}

export type CodeRow = typeof promoCodes.$inferSelect & { redeemed: number };

export async function listCodes(): Promise<CodeRow[]> {
  await requireStaff();
  const db = getDb();
  const codes = await db.select().from(promoCodes).orderBy(desc(promoCodes.createdAt));
  const uses = await db
    .select({ id: accessGrants.promoCodeId, n: count() })
    .from(accessGrants)
    .where(inArray(accessGrants.kind, ["code"]))
    .groupBy(accessGrants.promoCodeId);
  return codes.map((c) => ({ ...c, redeemed: Number(uses.find((u) => u.id === c.id)?.n ?? 0) }));
}

export async function growthFunnel() {
  await requireStaff();
  return linkFunnel(getDb());
}

export type LogRow = typeof auditLog.$inferSelect;

/** The back office's own acts and the billing events they sit beside, newest first. */
export async function adminLog(limit = 200): Promise<LogRow[]> {
  await requireStaff();
  return getDb()
    .select()
    .from(auditLog)
    .where(or(like(auditLog.action, "admin.%"), like(auditLog.action, "billing.%")))
    .orderBy(desc(auditLog.at))
    .limit(limit);
}
