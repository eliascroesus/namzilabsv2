"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { choosePlanAction, openPortalAction, redeemCodeAction, startCheckoutAction } from "@/app/billing-actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PERIOD_PILL, PERIOD_TRACK } from "@/components/ui/page";
import { SubmitButton } from "@/components/ui/submit-button";
import { PLANS, TRIAL_DAYS, planRank, type Interval, type PlanId } from "@/lib/billing/plans";
import type { ResolvedPlan } from "@/lib/billing/resolve";
import { cn } from "@/lib/utils";

/**
 * THE PLAN PICKER — one component, three places: step 2 of onboarding, Plan &
 * billing in settings, and the public `/pricing` page.
 *
 * Laid out after the owner's reference (Mochi's plan step): a Monthly/Yearly
 * toggle, three cards with Growth raised under "Most popular", the paid price
 * struck through beside FREE while a trial is on offer, an access-code field
 * bottom-left and "Need more? Talk to us" bottom-right.
 *
 * WHAT EACH BUTTON DOES depends on where the workspace stands, and every
 * branch is a server action that re-checks it — the button is an offer, never
 * the permission. A subscriber changes plan or cancels in Stripe's billing
 * portal (proration and refunds are Stripe's job); anyone else goes through
 * `choosePlanAction` (trial first, Checkout after) or straight to Checkout.
 */

export type PlanPickerProps = {
  mode: "onboarding" | "settings" | "public";
  /** The workspace's plan now; null on the public page, where there is no workspace. */
  current: PlanId | null;
  currentSource: ResolvedPlan["source"] | null;
  /** This person has never had a trial — a paid card offers 30 days free instead of a price. */
  trialAvailable: boolean;
  /** A lifetime grant: nothing at or below it is for sale. */
  lifetime?: boolean;
  /** Onboarding: where to go once a plan is chosen. */
  next?: string;
  /** Where a failed access code sends them back to, with the reason. */
  back?: string;
  /** A member who cannot change the plan: the plans, and no buttons that would only refuse them. */
  readOnly?: boolean;
  defaultInterval?: Interval;
};

const ORDER: PlanId[] = ["free", "growth", "scale"];
const SUPPORT = "mailto:support@namzilabs.com?subject=Namzilabs%20plans";
const GRANTED = new Set(["code", "manual", "referral", "launch"]);

/** What a card's button does. `form` posts to a server action with these fields. */
type Cta =
  | { kind: "link"; href: string; label: string; note?: string }
  | { kind: "form"; action: (fd: FormData) => Promise<void>; fields: Record<string, string>; label: string; pending: string; note?: string }
  | { kind: "text"; note: string };

function ctaFor(plan: PlanId, props: PlanPickerProps, interval: Interval, offersTrial: boolean): Cta | null {
  const { mode, current, currentSource, lifetime } = props;
  const name = PLANS[plan].name;
  const payFields = { plan, interval };

  if (mode === "public") {
    if (plan === "free") return { kind: "link", href: "/signup", label: "Start free", note: "No card needed" };
    return { kind: "link", href: "/signup", label: `Start ${TRIAL_DAYS}-day free trial`, note: "No card needed" };
  }

  if (mode === "onboarding") {
    const fields: Record<string, string> = { ...payFields, next: props.next ?? "/dashboard" };
    if (plan === "free") return { kind: "form", action: choosePlanAction, fields, label: "Continue free", pending: "Continuing…" };
    if (offersTrial)
      return { kind: "form", action: choosePlanAction, fields, label: `Start ${TRIAL_DAYS}-day free trial`, pending: "Starting…", note: "No card needed" };
    return { kind: "form", action: choosePlanAction, fields, label: `Choose ${name}`, pending: "Opening checkout…", note: "Secure checkout by Stripe" };
  }

  // Settings.
  const portal = (label: string, note?: string): Cta => ({ kind: "form", action: openPortalAction, fields: {}, label, pending: "Opening…", note });
  const checkout = (label: string, note?: string): Cta => ({ kind: "form", action: startCheckoutAction, fields: payFields, label, pending: "Opening checkout…", note });

  if (currentSource === "subscription") {
    if (plan === current) return portal("Manage billing");
    if (plan === "free") return portal("Cancel subscription", "You keep your plan until the period ends");
    return portal(`Switch to ${name}`, "Prorated by Stripe");
  }
  if (currentSource === "trial") {
    if (plan === "free") return { kind: "text", note: "Where you land if the trial ends" };
    if (plan === current) return checkout(`Add a card to keep ${name}`, "No charge until your trial ends");
    return checkout(`Switch to ${name}`, "No charge until your trial ends");
  }
  if (currentSource && GRANTED.has(currentSource) && current) {
    const higher = planRank(plan) > planRank(current);
    if (plan === "free") return lifetime ? null : { kind: "text", note: "Where you land when your free time ends" };
    if (lifetime && !higher) return { kind: "text", note: "Included in your plan" };
    if (higher) return checkout(`Choose ${name}`);
    return checkout(plan === current ? `Add a card to keep ${name}` : `Choose ${name}`, "No charge until your free time ends");
  }
  // On Free.
  if (plan === "free") return null;
  if (offersTrial)
    return {
      kind: "form",
      action: choosePlanAction,
      fields: { ...payFields, next: "/dashboard/settings/billing" },
      label: `Start ${TRIAL_DAYS}-day free trial`,
      pending: "Starting…",
      note: "No card needed",
    };
  return checkout(`Choose ${name}`, "Secure checkout by Stripe");
}

export function PlanPicker(props: PlanPickerProps) {
  const [interval, setInterval] = useState<Interval>(props.defaultInterval ?? "month");
  const { mode, current } = props;
  const inSettings = mode === "settings";
  // A trial is on offer to anyone who has not had one and is not on a paid plan.
  const offersTrial = props.trialAvailable && (current == null || current === "free");
  // Settings raises the plan they are on; everywhere else, the one most people pick.
  const featured: PlanId = inSettings && current && current !== "free" ? current : "growth";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-center">
        <div role="radiogroup" aria-label="Billing period" className={cn(PERIOD_TRACK, "p-0.5")}>
          {(["month", "year"] as const).map((value) => {
            const on = interval === value;
            return (
              <Button
                key={value}
                type="button"
                variant="ghost"
                role="radio"
                aria-checked={on}
                onClick={() => setInterval(value)}
                className={cn(
                  PERIOD_PILL,
                  "gap-2",
                  on ? "bg-primary text-primary-foreground hover:bg-primary-hover" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {value === "month" ? "Monthly" : "Yearly"}
                {value === "year" && (
                  <span
                    className={cn(
                      "rounded-xs px-1.5 py-px text-2xs font-medium uppercase tracking-label",
                      on ? "bg-primary-foreground/15 text-primary-foreground" : "bg-brand-soft text-marker",
                    )}
                  >
                    Save 20%
                  </span>
                )}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="grid items-stretch gap-4 md:grid-cols-3">
        {ORDER.map((plan) => (
          <PlanCard
            key={plan}
            plan={plan}
            interval={interval}
            featured={plan === featured}
            ribbon={plan === featured ? (inSettings && plan === current ? "Current plan" : "Most popular") : null}
            isCurrent={inSettings && plan === current}
            offersTrial={offersTrial && plan !== "free"}
            cta={props.readOnly ? null : ctaFor(plan, props, interval, offersTrial)}
          />
        ))}
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        {props.readOnly ? <span /> : <AccessCode mode={mode} next={props.next} back={props.back} />}
        <p className="text-sm text-muted-foreground">
          Need more?{" "}
          <a href={SUPPORT} className="font-medium text-foreground underline-offset-4 hover:underline">
            Talk to us
          </a>
        </p>
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  interval,
  featured,
  ribbon,
  isCurrent,
  offersTrial,
  cta,
}: {
  plan: PlanId;
  interval: Interval;
  featured: boolean;
  ribbon: string | null;
  isCurrent: boolean;
  offersTrial: boolean;
  cta: Cta | null;
}) {
  const def = PLANS[plan];
  return (
    /* THE RAISED CARD CARRIES ITS RIBBON INSIDE ITS OWN RING, and the other two
       start one ribbon lower on a wide screen so all three bodies share a top
       edge — which is what makes the middle one read as lifted rather than
       merely taller. Stacked on a phone, nobody is raised. */
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-surface border bg-card",
        featured ? "border-primary ring-1 ring-primary" : "border-border md:mt-8",
      )}
    >
      {ribbon && (
        <div className="flex h-8 items-center justify-center bg-primary text-xs font-medium uppercase tracking-label text-primary-foreground">
          {ribbon}
        </div>
      )}
      <div className="flex flex-1 flex-col gap-5 p-5">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-foreground">{def.name}</h3>
            {isCurrent && !ribbon && (
              <span className="rounded-xs bg-accent px-1.5 py-px text-2xs font-medium uppercase tracking-label text-muted-foreground">Current plan</span>
            )}
          </div>
          <p className="mt-1 min-h-10 text-sm text-muted-foreground">{def.tagline}</p>
        </div>

        <Price plan={plan} interval={interval} offersTrial={offersTrial} />

        <CtaBlock cta={cta} primary={featured} />

        <ul className="flex flex-col gap-2 border-t border-border pt-4 text-sm text-foreground">
          {def.bullets.map((b) => (
            <li key={b} className="flex items-start gap-2">
              <Check size={16} aria-hidden className="mt-0.5 shrink-0 text-marker" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Price({ plan, interval, offersTrial }: { plan: PlanId; interval: Interval; offersTrial: boolean }) {
  const price = PLANS[plan].price;
  if (!price) {
    return (
      <div>
        <p className="flex items-baseline gap-1.5">
          <span className="tnum text-display-sm font-semibold text-foreground">$0</span>
          <span className="text-sm text-muted-foreground">/month</span>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">Free for as long as you like</p>
      </div>
    );
  }
  const perMonth = interval === "year" ? Math.round(price.year / 12) : price.month;
  const then = interval === "year" ? `$${price.year.toLocaleString("en-US")}/year` : `$${price.month}/month`;
  if (offersTrial) {
    return (
      <div>
        <p className="flex items-baseline gap-2">
          <s className="tnum text-lg text-muted-foreground">{`$${perMonth}`}</s>
          <span className="text-display-sm font-semibold text-foreground">FREE</span>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{`${TRIAL_DAYS} days free, then ${then}`}</p>
      </div>
    );
  }
  return (
    <div>
      <p className="flex items-baseline gap-1.5">
        <span className="tnum text-display-sm font-semibold text-foreground">{`$${perMonth}`}</span>
        <span className="text-sm text-muted-foreground">/month</span>
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {interval === "year" ? `$${price.year.toLocaleString("en-US")} billed yearly` : "Billed monthly — cancel any time"}
      </p>
    </div>
  );
}

function CtaBlock({ cta, primary }: { cta: Cta | null; primary: boolean }) {
  const variant = primary ? "accent" : "default";
  let control: ReactNode = null;
  if (cta?.kind === "text") {
    control = <p className="flex h-10 items-center text-sm text-muted-foreground">{cta.note}</p>;
  } else if (cta?.kind === "link") {
    control = (
      <Link href={cta.href} className={cn(buttonVariants({ variant, size: "lg" }), "w-full")}>
        {cta.label}
      </Link>
    );
  } else if (cta?.kind === "form") {
    control = (
      <form action={cta.action}>
        {Object.entries(cta.fields).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <SubmitButton variant={variant} size="lg" className="w-full" pendingLabel={cta.pending}>
          {cta.label}
        </SubmitButton>
      </form>
    );
  }
  const note = cta && cta.kind !== "text" ? cta.note : undefined;
  /* ONE SHAPE FOR EVERY CARD — a 40px slot and a 16px note line, filled or
     not — so the three bullet lists start on one line whatever each card
     offers. A card with nothing to offer keeps the same empty shape. */
  return (
    <div className="flex flex-col gap-2">
      <div className="h-10">{control}</div>
      <p aria-hidden={note ? undefined : true} className="h-4 text-center text-xs leading-4 text-muted-foreground">
        {note ?? ""}
      </p>
    </div>
  );
}

/**
 * THE ACCESS-CODE FIELD. In the app it redeems for this workspace at once. On
 * the public page there is no workspace yet, so it follows the code's own link
 * — `/p/CODE` keeps the code in a cookie and sends them to sign up, and the
 * workspace they create is granted it.
 */
function AccessCode({ mode, next, back }: { mode: PlanPickerProps["mode"]; next?: string; back?: string }) {
  const [code, setCode] = useState("");
  const id = useId();
  const field = (
    <div className="flex gap-2">
      <Input
        id={id}
        name="code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Enter code"
        autoCapitalize="characters"
        className="w-44 uppercase placeholder:normal-case"
        required
      />
      <SubmitButton variant="default" pendingLabel="Applying…">
        Apply
      </SubmitButton>
    </div>
  );
  const label = (
    <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-muted-foreground">
      Access code
    </label>
  );
  if (mode === "public") {
    const go = (e: FormEvent) => {
      e.preventDefault();
      const c = code.trim();
      if (c) window.location.assign(`/p/${encodeURIComponent(c)}`);
    };
    return (
      <form onSubmit={go}>
        {label}
        {field}
      </form>
    );
  }
  return (
    <form action={redeemCodeAction}>
      {next && <input type="hidden" name="next" value={next} />}
      {back && <input type="hidden" name="back" value={back} />}
      {label}
      {field}
    </form>
  );
}
