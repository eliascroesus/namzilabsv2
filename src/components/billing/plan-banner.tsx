import Link from "next/link";
import { X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { daysLeft, planDate } from "@/lib/billing/describe";
import { PLANS, TRIAL_DAYS } from "@/lib/billing/plans";
import type { ResolvedPlan } from "@/lib/billing/resolve";
import { cn } from "@/lib/utils";

/**
 * THE ONE LINE A PLAN MAY SAY ON THE BOARD — and most of the time it says
 * nothing. The spec's rule: a trial stays quiet until its last seven days, a
 * failing payment is red, and a workspace that dropped below its usage is told
 * how many metrics are locked and that nothing was deleted. A welcome after a
 * trial starts or a code is applied shows once, from the URL.
 *
 * `plan` is null while billing is off, and then nothing renders at all.
 */

const BILLING = "/dashboard/settings/billing";
type Tone = "info" | "warn" | "danger" | "success";

const TONES: Record<Tone, string> = {
  info: "border-brand-soft-line bg-brand-soft text-foreground",
  warn: "border-warn/25 bg-warn-soft text-warn-ink",
  danger: "border-danger-soft bg-danger-soft/50 text-danger-ink",
  success: "border-success-soft bg-success-soft/50 text-success-ink",
};

type Said = { tone: Tone; text: string; action?: { href: string; label: string }; dismissable?: boolean };

function whatToSay(plan: ResolvedPlan, lockedCount: number, welcome: string | null | undefined, now: Date): Said | null {
  const name = PLANS[plan.plan].name;
  if (welcome === "trial" && plan.source === "trial")
    return {
      tone: "success",
      text: `Your ${TRIAL_DAYS}-day ${name} trial has started — no card needed. We'll remind you a week before it ends.`,
      dismissable: true,
    };
  if (welcome === "code" && plan.plan !== "free")
    return {
      tone: "success",
      text: `Code applied — ${name} is yours ${plan.lifetime ? "for life" : plan.endsAt ? `until ${planDate(plan.endsAt, now)}` : "now"}.`,
      dismissable: true,
    };
  if (plan.state === "past_due")
    return {
      tone: "danger",
      text: `Your last payment for ${name} didn't go through. Update your card to keep your plan — Stripe will try again in the meantime.`,
      action: { href: BILLING, label: "Update card" },
    };
  // Any free time about to run out — a trial, a launch gift, a code, a referral
  // reward — is worth a week's notice; a lifetime grant never runs out.
  if (plan.source !== "subscription" && plan.plan !== "free" && plan.endsAt && !plan.lifetime) {
    const left = daysLeft(plan.endsAt, now);
    const when = left <= 1 ? "within a day" : `in ${left} days`;
    if (left <= 7)
      return {
        tone: "warn",
        text:
          plan.source === "trial"
            ? `Your ${name} trial ends ${when}. Add a card to keep it — you won't be charged until it ends.`
            : `Your free ${name} ends ${when}. Add a card to keep it — you won't be charged until then.`,
        action: { href: BILLING, label: "Add a card" },
      };
    return null;
  }
  if (lockedCount > 0)
    return {
      tone: "info",
      text: `${lockedCount} ${lockedCount === 1 ? "metric is" : "metrics are"} locked on the ${name} plan. Nothing is deleted — upgrade to see ${lockedCount === 1 ? "it" : "them"} again.`,
      action: { href: `${BILLING}?upgrade=metrics`, label: "See plans" },
    };
  return null;
}

export function PlanBanner({
  plan,
  lockedCount,
  welcome,
  dismissHref,
  now = new Date(),
}: {
  plan: ResolvedPlan | null;
  lockedCount: number;
  /** `?welcome=` — set once by the plan step or a redeemed code. */
  welcome?: string | null;
  /** The same board without `?welcome=`. */
  dismissHref: string;
  now?: Date;
}) {
  if (!plan) return null;
  const said = whatToSay(plan, lockedCount, welcome, now);
  if (!said) return null;
  return (
    <div
      role={said.tone === "danger" ? "alert" : "status"}
      className={cn("mb-6 flex flex-col gap-3 rounded-card border p-4 text-sm sm:flex-row sm:items-center sm:justify-between", TONES[said.tone])}
    >
      <p>{said.text}</p>
      <div className="flex shrink-0 items-center gap-2">
        {said.action && (
          <Link href={said.action.href} className={buttonVariants({ variant: said.tone === "danger" ? "destructive" : "default" })}>
            {said.action.label}
          </Link>
        )}
        {said.dismissable && (
          <Link href={dismissHref} aria-label="Dismiss" className={cn(buttonVariants({ variant: "ghost", size: "iconSm" }), "text-current opacity-70 hover:opacity-100")}>
            <X />
          </Link>
        )}
      </div>
    </div>
  );
}
