import Link from "next/link";
import { redirect } from "next/navigation";
import { X } from "lucide-react";
import { eq } from "drizzle-orm";
import { openPortalAction } from "@/app/billing-actions";
import { AppShell } from "@/components/app-shell";
import { PlanPicker } from "@/components/billing/plan-picker";
import { PlanStatus, type Usage } from "@/components/billing/plan-status";
import { buttonVariants } from "@/components/ui/button";
import { PageContainer, PageHeader, SectionHeading } from "@/components/ui/page";
import { SubmitButton } from "@/components/ui/submit-button";
import { getDb } from "@/db/client";
import { billingSubscriptions } from "@/db/schema";
import { requireOrg } from "@/lib/auth";
import { codeErrorMessage, describePlan } from "@/lib/billing/describe";
import { upgradeMessage } from "@/lib/billing/limits";
import { PLANS } from "@/lib/billing/plans";
import { FREE } from "@/lib/billing/resolve";
import { billingEnabled, hasTrialed, workspacePlan } from "@/lib/billing/state";
import { syncCheckoutSession } from "@/lib/billing/stripe";
import { countApps, countMembers, countMetrics } from "@/lib/billing/usage";
import { canManageRanks } from "@/lib/permissions";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : (v ?? ""));

/**
 * PLAN & BILLING — where the workspace stands, what it uses against what its
 * plan includes, and the plan picker to change it.
 *
 * Every refusal in the product lands here with `?upgrade=<kind>`, and Stripe
 * sends people back with `?checkout=success&session_id=…`. The session is read
 * at once rather than waiting for the webhook, so the page someone lands on
 * after paying already shows what they paid for.
 *
 * With billing off (before launch) there are no plans to show, and the spec's
 * rule is that no plan UI appears outside /admin and /pricing — so it is not
 * a page at all yet.
 */
export default async function BillingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireOrg();
  if (!billingEnabled()) redirect("/dashboard/settings");
  const { orgId, userId, auth } = ctx;
  const sp = await searchParams;
  const db = getDb();

  const sessionId = one(sp.session_id);
  if (one(sp.checkout) === "success" && /^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    // The webhook does the same a moment later; this only saves them a stale page.
    await syncCheckoutSession(db, sessionId).catch((e) => console.error("[billing] checkout sync failed", e));
  }

  const [plan, trialed, apps, metrics, members, customer, governs] = await Promise.all([
    workspacePlan(db, orgId).catch(() => FREE),
    hasTrialed(db, userId).catch(() => true),
    countApps(db, orgId).catch(() => 0),
    countMetrics(db, orgId).catch(() => 0),
    countMembers(orgId).catch(() => 1),
    db
      .select({ id: billingSubscriptions.stripeCustomerId, interval: billingSubscriptions.interval })
      .from(billingSubscriptions)
      .where(eq(billingSubscriptions.orgId, orgId))
      .limit(1)
      .then((r) => r[0] ?? null)
      .catch(() => null),
    canManageRanks(db, ctx).catch(() => false),
  ]);

  const def = PLANS[plan.plan];
  const usage: Usage[] = [
    { label: "Apps", used: apps, limit: def.limits.apps, unlimited: def.unlimited, overNote: "Apps past the limit are paused — nothing is deleted" },
    { label: "Metrics", used: metrics, limit: def.limits.metrics, unlimited: def.unlimited, overNote: "Metrics past the limit are locked — nothing is deleted" },
    { label: "Members", used: members, limit: def.limits.members, overNote: "Members past the limit can't open the workspace until you upgrade" },
  ];

  const upgrade = upgradeMessage(one(sp.upgrade), plan.plan);
  const codeError = codeErrorMessage(one(sp.code_error));
  const notice: { tone: "success" | "danger" | "info"; text: string } | null =
    one(sp.checkout) === "success"
      ? { tone: "success", text: `Thanks — you're on ${def.name}. A receipt is on its way to your inbox.` }
      : one(sp.code) === "ok"
        ? { tone: "success", text: `Code applied — you're on ${def.name}.` }
        : codeError
          ? { tone: "danger", text: codeError }
          : one(sp.error) === "role"
            ? { tone: "danger", text: "Only the workspace owner or an admin can change the plan." }
            : one(sp.error) === "no_billing"
              ? { tone: "danger", text: "There's nothing to manage yet — billing starts when you add a card." }
              : upgrade
                ? { tone: "info", text: upgrade }
                : null;

  return (
    <AppShell userId={userId} orgId={orgId} userEmail={auth.user.email}>
      <PageContainer>
        <PageHeader title="Plan & billing" back={{ href: "/dashboard/settings", label: "Settings" }} />

        {notice && <Notice tone={notice.tone} text={notice.text} />}

        <PlanStatus
          className="mt-6"
          description={describePlan(plan)}
          usage={usage}
          actions={
            customer && governs ? (
              <form action={openPortalAction}>
                <SubmitButton variant={plan.state === "past_due" ? "accent" : "default"} pendingLabel="Opening…">
                  {plan.state === "past_due" ? "Update card" : "Manage billing"}
                </SubmitButton>
              </form>
            ) : null
          }
        />

        <section className="mt-10">
          <SectionHeading>Plans</SectionHeading>
          {governs ? null : (
            <p className="mb-4 text-sm text-muted-foreground">Only the workspace owner or an admin can change the plan.</p>
          )}
          <PlanPicker
            mode="settings"
            current={plan.plan}
            currentSource={plan.source}
            lifetime={plan.lifetime}
            trialAvailable={!trialed}
            readOnly={!governs}
            defaultInterval={customer?.interval === "year" ? "year" : "month"}
          />
        </section>
      </PageContainer>
    </AppShell>
  );
}

function Notice({ tone, text }: { tone: "success" | "danger" | "info"; text: string }) {
  const trio = {
    success: ["border-success-soft bg-success-soft/50 text-success-ink", "text-success-ink/70 hover:bg-success-soft hover:text-success-ink"],
    danger: ["border-danger-soft bg-danger-soft/50 text-danger-ink", "text-danger-ink/70 hover:bg-danger-soft hover:text-danger-ink"],
    info: ["border-brand-soft-line bg-brand-soft text-foreground", "text-muted-foreground hover:bg-brand-soft hover:text-foreground"],
  }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("mt-6 flex items-start justify-between gap-4 rounded-card border p-4 text-sm", trio[0])}>
      <p>{text}</p>
      <Link href="/dashboard/settings/billing" aria-label="Dismiss" className={cn(buttonVariants({ variant: "ghost", size: "iconSm" }), trio[1])}>
        <X />
      </Link>
    </div>
  );
}
