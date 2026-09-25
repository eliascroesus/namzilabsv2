import { describe, expect, it } from "vitest";
import { PLANS, TRIAL_DAYS, planForLookupKey, planRank } from "@/lib/billing/plans";
import { resolvePlan, type GrantInput, type SubscriptionInput } from "@/lib/billing/resolve";

/**
 * WHICH PLAN A WORKSPACE IS ON — the one rule every limit, lock and banner
 * reads, so it is a pure function and every branch is pinned here.
 *
 * Two inputs: the Stripe subscription (synced by webhook) and the access grants
 * (trials, codes, the owner's manual grants, referral rewards, launch trials).
 * The highest tier wins; nothing expired, revoked or not yet started counts.
 */

const NOW = new Date("2026-10-01T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const sub = (over: Partial<SubscriptionInput> = {}): SubscriptionInput => ({
  plan: "growth",
  status: "active",
  currentPeriodEnd: days(20),
  cancelAtPeriodEnd: false,
  trialEnd: null,
  ...over,
});
const grant = (over: Partial<GrantInput> = {}): GrantInput => ({
  plan: "growth",
  kind: "code",
  startsAt: days(-10),
  endsAt: days(10),
  revokedAt: null,
  ...over,
});

describe("the plans", () => {
  it("are the numbers the owner approved", () => {
    expect(PLANS.free.limits).toEqual({ apps: 3, metrics: 5, members: 1 });
    expect(PLANS.growth.limits).toEqual({ apps: 10, metrics: 50, members: 5 });
    expect(PLANS.scale.limits).toEqual({ apps: 50, metrics: 500, members: 20 });
    expect(PLANS.free.price).toBeNull();
    expect(PLANS.growth.price).toEqual({ month: 49, year: 468 });
    expect(PLANS.scale.price).toEqual({ month: 149, year: 1428 });
    expect(TRIAL_DAYS).toBe(30);
  });

  it("give Scale alone the AI assistant, and every paid plan template sharing", () => {
    expect(PLANS.free.features).toEqual({ shareTemplates: false, aiAssistant: false });
    expect(PLANS.growth.features).toEqual({ shareTemplates: true, aiAssistant: false });
    expect(PLANS.scale.features).toEqual({ shareTemplates: true, aiAssistant: true });
  });

  it("price a year at about 20% off twelve months", () => {
    for (const id of ["growth", "scale"] as const) {
      const p = PLANS[id].price!;
      const discount = 1 - p.year / (p.month * 12);
      expect(discount).toBeGreaterThan(0.19);
      expect(discount).toBeLessThan(0.21);
    }
  });

  it("rank Free < Growth < Scale", () => {
    expect(planRank("free")).toBeLessThan(planRank("growth"));
    expect(planRank("growth")).toBeLessThan(planRank("scale"));
  });

  it("read a Stripe price's lookup key back into a plan and interval", () => {
    expect(planForLookupKey("growth_monthly")).toEqual({ plan: "growth", interval: "month" });
    expect(planForLookupKey("scale_yearly")).toEqual({ plan: "scale", interval: "year" });
    expect(planForLookupKey("something_else")).toBeNull();
    expect(planForLookupKey(null)).toBeNull();
  });
});

describe("resolvePlan", () => {
  it("is Free with nothing at all", () => {
    expect(resolvePlan({ subscription: null, grants: [], now: NOW })).toEqual({
      plan: "free",
      source: "free",
      state: "free",
      endsAt: null,
      lifetime: false,
    });
  });

  it("follows a paying subscription", () => {
    const r = resolvePlan({ subscription: sub(), grants: [], now: NOW });
    expect(r).toMatchObject({ plan: "growth", source: "subscription", state: "active", endsAt: null });
  });

  it("keeps access while a payment is being retried", () => {
    expect(resolvePlan({ subscription: sub({ status: "past_due" }), grants: [], now: NOW })).toMatchObject({
      plan: "growth",
      state: "past_due",
    });
  });

  it("reports a Stripe trial with its end", () => {
    expect(resolvePlan({ subscription: sub({ status: "trialing", trialEnd: days(5) }), grants: [], now: NOW })).toMatchObject({
      plan: "growth",
      state: "trialing",
      endsAt: days(5),
    });
  });

  it("reports a cancelled-at-period-end subscription as ending with the period", () => {
    expect(resolvePlan({ subscription: sub({ cancelAtPeriodEnd: true }), grants: [], now: NOW })).toMatchObject({
      state: "canceling",
      endsAt: days(20),
    });
  });

  it.each(["canceled", "unpaid", "paused", "incomplete", "incomplete_expired"])("ignores a %s subscription", (status) => {
    expect(resolvePlan({ subscription: sub({ status }), grants: [], now: NOW }).plan).toBe("free");
  });

  it("follows a grant inside its window", () => {
    expect(resolvePlan({ subscription: null, grants: [grant()], now: NOW })).toMatchObject({
      plan: "growth",
      source: "code",
      state: "granted",
      endsAt: days(10),
      lifetime: false,
    });
  });

  it("calls an in-app trial a trial", () => {
    expect(resolvePlan({ subscription: null, grants: [grant({ kind: "trial" })], now: NOW })).toMatchObject({
      source: "trial",
      state: "trialing",
    });
  });

  it("ignores expired, not-yet-started and revoked grants — and one ending exactly now", () => {
    const grants = [
      grant({ endsAt: days(-1) }),
      grant({ startsAt: days(1) }),
      grant({ revokedAt: days(-2) }),
      grant({ endsAt: NOW }),
    ];
    expect(resolvePlan({ subscription: null, grants, now: NOW }).plan).toBe("free");
  });

  it("treats a grant with no end as lifetime", () => {
    expect(resolvePlan({ subscription: null, grants: [grant({ endsAt: null, kind: "manual" })], now: NOW })).toMatchObject({
      plan: "growth",
      lifetime: true,
      endsAt: null,
    });
  });

  it("takes the highest tier from any source", () => {
    const r = resolvePlan({ subscription: sub({ plan: "growth" }), grants: [grant({ plan: "scale" })], now: NOW });
    expect(r).toMatchObject({ plan: "scale", source: "code" });
  });

  it("prefers the paying subscription over a grant of the same tier", () => {
    expect(resolvePlan({ subscription: sub(), grants: [grant()], now: NOW }).source).toBe("subscription");
  });

  it("does not stack same-tier grants: lifetime first, then the latest end", () => {
    const later = grant({ endsAt: days(40), kind: "referral" });
    expect(resolvePlan({ subscription: null, grants: [grant(), later], now: NOW })).toMatchObject({ source: "referral", endsAt: days(40) });
    const forever = grant({ endsAt: null, kind: "manual" });
    expect(resolvePlan({ subscription: null, grants: [later, forever], now: NOW })).toMatchObject({ source: "manual", lifetime: true });
  });
});
