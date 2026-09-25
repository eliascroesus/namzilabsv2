import type { Metadata } from "next";
import Link from "next/link";
import { PlanPicker } from "@/components/billing/plan-picker";
import { NamzilabsLockup } from "@/components/namzilabs-logo";
import { buttonVariants } from "@/components/ui/button";
import { PLANS, TRIAL_DAYS } from "@/lib/billing/plans";

export const metadata: Metadata = {
  title: "Pricing — Namzilabs",
  description: `Start free, or try Growth or Scale free for ${TRIAL_DAYS} days with no card.`,
};

const FAQ = [
  {
    q: "What counts as a metric?",
    a: "One number on your board — revenue, booked calls, show rate. Views, dashboards and date ranges are never limited.",
  },
  {
    q: `What happens when the ${TRIAL_DAYS}-day trial ends?`,
    a: `If you haven't added a card, the workspace moves to Free. Your first ${PLANS.free.limits.metrics} metrics stay live and the rest are locked until you upgrade — nothing is deleted, and upgrading unlocks everything at once.`,
  },
  {
    q: "Can I change plans or cancel?",
    a: "Any time, from Plan & billing. Changes are prorated, and a cancelled plan runs to the end of the period you paid for.",
  },
  {
    q: "I have an access code.",
    a: "Enter it below the plans. It's applied to the workspace you create, or at once if you're already signed in.",
  },
];

/**
 * THE PUBLIC PRICE LIST — the same picker the app shows, with every button
 * leading to sign-up. It is drawn from `PLANS`, so it cannot disagree with
 * what Checkout charges.
 *
 * Built from the app's kit, not the landing page's: this is the page between
 * deciding and signing up, and the next screen they see is the product's.
 */
export default function PricingPage() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label="Namzilabs home" className="text-foreground">
          <NamzilabsLockup height={22} decorative />
        </Link>
        <nav aria-label="Account" className="flex items-center gap-2">
          <Link href="/login" className={buttonVariants({ variant: "ghost" })}>
            Sign in
          </Link>
          <Link href="/signup" className={buttonVariants({ variant: "accent" })}>
            Start free
          </Link>
        </nav>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-20 pt-10 sm:px-6">
        <h1 className="text-center text-display-sm font-semibold text-foreground">Pricing</h1>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm text-muted-foreground">
          Start free on your core apps, or try Growth or Scale free for {TRIAL_DAYS} days — no card needed.
        </p>

        <div className="mt-10">
          <PlanPicker mode="public" current={null} currentSource={null} trialAvailable />
        </div>

        <section aria-labelledby="faq" className="mx-auto mt-20 max-w-3xl">
          <h2 id="faq" className="text-lg font-semibold text-foreground">
            Questions
          </h2>
          <dl className="mt-4 divide-y divide-border border-y border-border">
            {FAQ.map(({ q, a }) => (
              <div key={q} className="grid gap-2 py-5 sm:grid-cols-[16rem_minmax(0,1fr)] sm:gap-8">
                <dt className="text-sm font-medium text-foreground">{q}</dt>
                <dd className="text-sm text-muted-foreground">{a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>
    </div>
  );
}
