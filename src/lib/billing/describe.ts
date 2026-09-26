import { PLANS } from "./plans";
import type { ResolvedPlan } from "./resolve";

/**
 * A WORKSPACE'S PLAN IN ONE PLAIN SENTENCE — the line at the top of Plan &
 * billing, and the words a banner borrows. Pure, so every state is a test.
 *
 * The tone is the only styling decision made here, and it follows the spec's
 * one rule about noise: a trial stays quiet until its last seven days, and only
 * a failing payment is red.
 */

export type PlanTone = "neutral" | "positive" | "warning" | "danger";
/** `badge` is the state in a word, for the pill beside the title; null on Free. */
export type PlanDescription = { title: string; detail: string; tone: PlanTone; badge: string | null };

const DAY = 86_400_000;

/** Whole days left, counting a part-day as a day — "1 day left" on the last one. */
export function daysLeft(endsAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / DAY));
}

/** "October 11", or "January 5, 2027" when it is not this year. */
export function planDate(d: Date, now: Date): string {
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" });
}

const GRANT_REASON: Record<string, string> = {
  code: "from an access code",
  referral: "as a referral reward",
  launch: "as a launch gift",
  manual: "courtesy of Namzilabs",
};

export function describePlan(p: ResolvedPlan & { subscribed?: boolean }, now = new Date()): PlanDescription {
  const name = PLANS[p.plan].name;
  if (p.plan === "free") {
    const { apps, metrics } = PLANS.free.limits;
    return { title: "Free", detail: `${apps} apps and ${metrics} metrics, just you.`, tone: "neutral", badge: null };
  }
  if (p.source === "trial") {
    const left = p.endsAt ? daysLeft(p.endsAt, now) : 0;
    return {
      title: `${name} — free trial`,
      detail: `${left} ${left === 1 ? "day" : "days"} left. Add a card to keep ${name} — you won't be charged until the trial ends.`,
      tone: left <= 7 ? "warning" : "neutral",
      badge: "Trial",
    };
  }
  if (p.source === "subscription") {
    if (p.state === "past_due")
      return {
        title: `${name} — payment failed`,
        detail: `Your last payment didn't go through. Stripe will try again; update your card to keep ${name}.`,
        tone: "danger",
        badge: "Payment failed",
      };
    if (p.state === "canceling")
      return {
        title: `${name} — cancelled`,
        detail: `Your subscription ends on ${p.endsAt ? planDate(p.endsAt, now) : "the last day of this period"}. The workspace moves to Free after that — nothing is deleted.`,
        tone: "warning",
        badge: "Cancelled",
      };
    if (p.state === "trialing")
      return {
        title: `${name} — free trial`,
        detail: p.endsAt ? `Your card is on file. The first payment is on ${planDate(p.endsAt, now)}.` : "Your card is on file.",
        tone: "positive",
        badge: "Trial",
      };
    return {
      title: name,
      detail: "Your subscription renews automatically. Change your card, plan or billing period from Manage billing.",
      tone: "positive",
      badge: "Active",
    };
  }
  const reason = GRANT_REASON[p.source] ?? GRANT_REASON.manual;
  if (p.lifetime) return { title: name, detail: `${name} is yours for life, ${reason}.`, tone: "positive", badge: "Lifetime" };
  const after = p.subscribed ? "Your subscription carries on underneath, as before." : "Add a card any time to keep it after that.";
  return {
    title: name,
    detail: `${name} is free until ${p.endsAt ? planDate(p.endsAt, now) : "the end of your free time"}, ${reason}. ${after}`,
    tone: "positive",
    badge: "Free access",
  };
}

const CODE_ERRORS: Record<string, string> = {
  unknown: "That code doesn't exist. Check the spelling and try again.",
  disabled: "That code has been switched off.",
  expired: "That code has expired.",
  used_up: "That code has been used as many times as it allows.",
  already_redeemed: "This workspace has already used that code.",
};

/** Why an access code did not work, from its `?code_error=` reason. Null when there is none. */
export function codeErrorMessage(reason: string): string | null {
  if (!reason) return null;
  return Object.hasOwn(CODE_ERRORS, reason) ? CODE_ERRORS[reason] : "That code didn't work.";
}
