import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { codeErrorMessage, describePlan } from "@/lib/billing/describe";
import type { ResolvedPlan } from "@/lib/billing/resolve";

/**
 * WHAT A PERSON IS SHOWN about their plan — one sentence per state, and the
 * plan picker's offer in each place it appears. Rendered to HTML: the words
 * and the buttons are the contract; the look is checked in the browser.
 */

vi.mock("@/app/billing-actions", () => ({
  choosePlanAction: async () => {},
  startCheckoutAction: async () => {},
  openPortalAction: async () => {},
  redeemCodeAction: async () => {},
}));
const { PlanPicker } = await import("@/components/billing/plan-picker");

const NOW = new Date("2026-10-01T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const plan = (over: Partial<ResolvedPlan>): ResolvedPlan => ({ plan: "free", source: "free", state: "free", endsAt: null, lifetime: false, ...over });

describe("describePlan", () => {
  it("names each state in one plain sentence", () => {
    expect(describePlan(plan({}), NOW)).toMatchObject({ title: "Free", tone: "neutral" });
    expect(describePlan(plan({ plan: "growth", source: "trial", state: "trialing", endsAt: days(23) }), NOW)).toMatchObject({
      title: "Growth — free trial",
      detail: "23 days left. Add a card to keep Growth — you won't be charged until the trial ends.",
    });
    expect(describePlan(plan({ plan: "growth", source: "trial", state: "trialing", endsAt: days(1) }), NOW).detail).toMatch(/^1 day left/);
    expect(describePlan(plan({ plan: "scale", source: "subscription", state: "active" }), NOW)).toMatchObject({ title: "Scale", tone: "positive" });
    expect(describePlan(plan({ plan: "growth", source: "subscription", state: "canceling", endsAt: days(10) }), NOW).detail).toMatch(/ends on October 11/);
    expect(describePlan(plan({ plan: "growth", source: "subscription", state: "past_due" }), NOW)).toMatchObject({ tone: "danger" });
    expect(describePlan(plan({ plan: "growth", source: "code", state: "granted", endsAt: days(90) }), NOW).detail).toMatch(/free until December 30/);
    expect(describePlan(plan({ plan: "scale", source: "manual", state: "granted", lifetime: true }), NOW).detail).toMatch(/for life/);
    // A subscriber given a higher plan for a while keeps paying underneath — no card to add.
    const over = describePlan({ ...plan({ plan: "scale", source: "code", state: "granted", endsAt: days(30) }), subscribed: true }, NOW).detail;
    expect(over).not.toMatch(/Add a card/);
    expect(over).toMatch(/subscription carries on/);
  });
});

describe("codeErrorMessage", () => {
  it("says why a code did not work, and nothing when it did", () => {
    expect(codeErrorMessage("expired")).toBe("That code has expired.");
    expect(codeErrorMessage("constructor")).toBe("That code didn't work.");
    expect(codeErrorMessage("")).toBeNull();
  });
});

const html = (props: Parameters<typeof PlanPicker>[0]) => renderToStaticMarkup(createElement(PlanPicker, props));

describe("the plan picker", () => {
  it("offers a free trial with no card on the onboarding step", () => {
    const h = html({ mode: "onboarding", current: "free", currentSource: "free", trialAvailable: true, next: "/dashboard" });
    expect(h).toContain("Most popular");
    expect(h).toContain("Start 30-day free trial");
    expect(h).toContain("No card needed");
    expect(h).toContain("Continue free");
    expect(h).toMatch(/<s[^>]*>\$49<\/s>/);
    expect(h).toContain("30 days free, then $49/month");
    expect(h).toContain("Access code");
    expect(h).toContain("mailto:support@namzilabs.com");
  });

  it("prices the year as the year, and the struck price per month", () => {
    const h = html({ mode: "public", current: null, currentSource: null, trialAvailable: true, defaultInterval: "year" });
    expect(h).toMatch(/<s[^>]*>\$39<\/s>/);
    expect(h).toContain("30 days free, then $468/year");
    expect(h).toContain("30 days free, then $1,428/year");
    const paid = html({ mode: "onboarding", current: "free", currentSource: "free", trialAvailable: false, defaultInterval: "year" });
    expect(paid).toContain("$1,428 billed yearly");
  });

  it("offers the price, not a trial, to someone who has had theirs", () => {
    const h = html({ mode: "onboarding", current: "free", currentSource: "free", trialAvailable: false });
    expect(h).not.toContain("Start 30-day free trial");
    expect(h).toContain("Choose Growth");
    expect(h).not.toMatch(/<s[^>]*>\$49<\/s>/);
  });

  it("marks the plan a subscriber pays for, and sends plan changes to the billing portal", () => {
    const h = html({ mode: "settings", current: "growth", currentSource: "subscription", trialAvailable: false });
    expect(h).toContain("Current plan");
    expect(h).toContain("Switch to Scale");
    expect(h).toContain("Cancel subscription");
  });

  it("sends a workspace that already pays to the portal for every paid plan, even under a code", () => {
    const h = html({ mode: "settings", current: "scale", currentSource: "code", subscribed: true, trialAvailable: false });
    expect(h).not.toContain("Add a card");
    expect(h).not.toContain("Choose Growth");
    expect(h).toContain("Switch to Growth");
  });

  it("asks a trialing workspace to add a card to keep its plan", () => {
    const h = html({ mode: "settings", current: "growth", currentSource: "trial", trialAvailable: false });
    expect(h).toContain("Add a card to keep Growth");
  });

  it("shows a member who cannot change the plan the plans, without buttons that would refuse them", () => {
    const h = html({ mode: "settings", current: "free", currentSource: "free", trialAvailable: true, readOnly: true });
    expect(h).toContain("Growth");
    expect(h).not.toContain("Start 30-day free trial");
    expect(h).not.toContain("Access code");
  });

  it("sends a visitor on the public page to sign up", () => {
    const h = html({ mode: "public", current: null, currentSource: null, trialAvailable: true });
    expect(h).toContain('href="/signup"');
    expect(h).toContain("Start free");
  });
});
