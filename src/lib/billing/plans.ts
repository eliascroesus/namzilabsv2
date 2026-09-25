/**
 * THE PLANS — every number a customer pays for, in one place.
 *
 * Approved by the owner on 25 Sep 2026 (see
 * docs/superpowers/specs/2026-09-25-billing-and-admin-design.md). Changing a
 * price here changes what NEW checkouts charge; people already paying keep the
 * Stripe price they subscribed on, because the price objects are Stripe's and
 * are found by lookup key, never rewritten.
 *
 * A METRIC is one number on the board (one enabled metric of a published flow,
 * one `flow_results` row). An APP is a connection that is not disabled.
 * MEMBERS counts everyone in the workspace, the owner included.
 */

export type PlanId = "free" | "growth" | "scale";
export type PaidPlanId = Exclude<PlanId, "free">;
export type Interval = "month" | "year";
/** Why a workspace holds a plan it is not paying Stripe for. */
export type GrantKind = "trial" | "code" | "manual" | "referral" | "launch";

export type PlanLimits = { apps: number; metrics: number; members: number };
export type PlanFeatures = { shareTemplates: boolean; aiAssistant: boolean };

export type PlanDef = {
  id: PlanId;
  name: string;
  /** One line under the name on the plan card. */
  tagline: string;
  limits: PlanLimits;
  features: PlanFeatures;
  /** Whole US dollars; `year` is the price of the whole year. Null for Free. */
  price: { month: number; year: number } | null;
  /** The Stripe Price lookup keys the owner creates, one per interval. */
  lookupKeys: { month: string; year: string } | null;
  /**
   * SHOWN AS "Unlimited — fair use". The limits still exist — a runaway script
   * must meet a wall somewhere — but no real workspace on this plan is expected
   * to reach them, so the card does not print a number nobody will use.
   */
  unlimited: boolean;
  /** The card's list, in order. Written for a coach, not an engineer. */
  bullets: string[];
};

/** How long a trial lasts, and how long an unpaid trial has before Free limits apply. */
export const TRIAL_DAYS = 30;

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id: "free",
    name: "Free",
    tagline: "See the number your tools can't show you — on your core apps.",
    limits: { apps: 3, metrics: 5, members: 1 },
    features: { shareTemplates: false, aiAssistant: false },
    price: null,
    lookupKeys: null,
    unlimited: false,
    bullets: ["3 connected apps", "5 metrics", "Just you", "Live dashboard and calendar", "Email support"],
  },
  growth: {
    id: "growth",
    name: "Growth",
    tagline: "For coaches and small teams running the business on their numbers.",
    limits: { apps: 10, metrics: 50, members: 5 },
    features: { shareTemplates: true, aiAssistant: false },
    price: { month: 49, year: 468 },
    lookupKeys: { month: "growth_monthly", year: "growth_yearly" },
    unlimited: false,
    bullets: [
      "10 connected apps",
      "50 metrics",
      "5 team members",
      "Share templates with students and clients",
      "Funnels, pies and custom date ranges",
      "Priority email support",
    ],
  },
  scale: {
    id: "scale",
    name: "Scale",
    tagline: "For teams with setters and closers, and agencies running clients.",
    limits: { apps: 50, metrics: 500, members: 20 },
    features: { shareTemplates: true, aiAssistant: true },
    price: { month: 149, year: 1428 },
    lookupKeys: { month: "scale_monthly", year: "scale_yearly" },
    unlimited: true,
    bullets: [
      "Unlimited apps (fair use)",
      "Unlimited metrics (fair use)",
      "20 team members",
      "AI assistant — ask Claude or ChatGPT about your numbers",
      "Everything in Growth",
      "Priority support on WhatsApp",
    ],
  },
};

export const PAID_PLANS: PaidPlanId[] = ["growth", "scale"];

export function planRank(plan: PlanId): number {
  return plan === "scale" ? 2 : plan === "growth" ? 1 : 0;
}

/** A Stripe price's lookup key, read back into the plan and interval it sells. */
export function planForLookupKey(key: string | null | undefined): { plan: PaidPlanId; interval: Interval } | null {
  if (!key) return null;
  for (const plan of PAID_PLANS) {
    const keys = PLANS[plan].lookupKeys!;
    if (keys.month === key) return { plan, interval: "month" };
    if (keys.year === key) return { plan, interval: "year" };
  }
  return null;
}

/** The monthly-equivalent price in dollars, for revenue figures. */
export function monthlyEquivalent(plan: PaidPlanId, interval: Interval): number {
  const price = PLANS[plan].price!;
  return interval === "year" ? price.year / 12 : price.month;
}

export function isPaidPlan(value: unknown): value is PaidPlanId {
  return value === "growth" || value === "scale";
}
