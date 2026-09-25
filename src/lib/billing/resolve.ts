import { planRank, type GrantKind, type PaidPlanId, type PlanId } from "./plans";

/**
 * WHICH PLAN A WORKSPACE IS ON — pure, so every rule is a test.
 *
 * Two inputs, one answer. The subscription is what Stripe says; the grants are
 * everything that gives a plan without a charge: an in-app trial, an access
 * code, a grant the owner made by hand, a referral reward, a launch trial. The
 * highest tier wins. Ties go to the paying subscription (it is the one that
 * renews), then to a lifetime grant, then to the grant that ends last —
 * overlapping grants never stack, the owner's rule of 25 Sep 2026.
 */

export type SubscriptionInput = {
  plan: PaidPlanId;
  /** Stripe's subscription status, verbatim. */
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: Date | null;
};

export type GrantInput = {
  plan: PaidPlanId;
  kind: GrantKind;
  startsAt: Date;
  /** Null = lifetime. */
  endsAt: Date | null;
  revokedAt: Date | null;
};

export type PlanState = "active" | "trialing" | "past_due" | "canceling" | "granted" | "free";

export type ResolvedPlan = {
  plan: PlanId;
  source: "subscription" | GrantKind | "free";
  state: PlanState;
  /** When this plan stops applying on its own; null when it renews or is lifetime. */
  endsAt: Date | null;
  lifetime: boolean;
};

/**
 * THE STATUSES THAT STILL GRANT THE PLAN. `past_due` is on the list on purpose:
 * Stripe is retrying the card (8 tries over two weeks), and a customer whose
 * card declined once keeps what they paid for while that runs. Everything else
 * — canceled, unpaid, paused, incomplete — is not a plan.
 */
const LIVE = new Set(["active", "trialing", "past_due"]);

export const FREE: ResolvedPlan = { plan: "free", source: "free", state: "free", endsAt: null, lifetime: false };

export function resolvePlan(input: {
  subscription: SubscriptionInput | null;
  grants: GrantInput[];
  now: Date;
}): ResolvedPlan {
  const { subscription, grants, now } = input;
  const t = now.getTime();
  const candidates: Array<ResolvedPlan & { order: number }> = [];

  if (subscription && LIVE.has(subscription.status)) {
    const state: PlanState =
      subscription.status === "past_due"
        ? "past_due"
        : subscription.status === "trialing"
          ? "trialing"
          : subscription.cancelAtPeriodEnd
            ? "canceling"
            : "active";
    candidates.push({
      plan: subscription.plan,
      source: "subscription",
      state,
      endsAt: state === "trialing" ? subscription.trialEnd : state === "canceling" ? subscription.currentPeriodEnd : null,
      lifetime: false,
      // Paying wins a tie with any grant.
      order: Number.MAX_SAFE_INTEGER,
    });
  }

  for (const g of grants) {
    if (g.revokedAt) continue;
    if (g.startsAt.getTime() > t) continue;
    if (g.endsAt && g.endsAt.getTime() <= t) continue;
    candidates.push({
      plan: g.plan,
      source: g.kind,
      state: g.kind === "trial" ? "trialing" : "granted",
      endsAt: g.endsAt,
      lifetime: g.endsAt === null,
      // Lifetime beats any dated grant; among dated grants the latest end wins.
      order: g.endsAt === null ? Number.MAX_SAFE_INTEGER - 1 : g.endsAt.getTime(),
    });
  }

  if (candidates.length === 0) return FREE;
  candidates.sort((a, b) => planRank(b.plan) - planRank(a.plan) || b.order - a.order);
  const { order: _order, ...best } = candidates[0];
  return best;
}
