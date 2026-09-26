import Link from "next/link";
import { notFound } from "next/navigation";
import { grantPlanAction, revokeGrantAction } from "@/app/admin/actions";
import { AdminRow, WorkspaceCardView } from "@/components/admin/workspace-card";
import { When } from "@/components/admin/bits";
import { StatusPill } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { FieldLabel } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { PageContainer, PageHeader, SectionHeading } from "@/components/ui/page";
import { SubmitButton } from "@/components/ui/submit-button";
import { Table, TableShell, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireStaff } from "@/lib/admin/access";
import { workspaceBilling, type WorkspaceBilling } from "@/lib/admin/billing";
import { workspaceCard } from "@/lib/admin/lookup";
import { describePlan } from "@/lib/billing/describe";
import { PLANS, isPaidPlan } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : (v ?? ""));
const day = (d: Date) => d.toISOString().slice(0, 10);

const NOTICES: Record<string, { tone: "success" | "danger"; text: string }> = {
  "done=grant": { tone: "success", text: "Plan granted." },
  "done=revoke": { tone: "success", text: "Grant revoked. The workspace drops to whatever it holds next." },
  "error=plan": { tone: "danger", text: "Choose Growth or Scale." },
  "error=duration": { tone: "danger", text: "Choose a length, or a date in the future." },
  "error=revoke": { tone: "danger", text: "That grant was already revoked." },
};

type Grant = WorkspaceBilling["grants"][number];

/** What a grant is doing now. A referral credit is a row with no time in it — it was paid as money. */
function grantState(g: Grant, now: Date): { label: string; tone: "success" | "pending" | "warn" | "danger" } {
  if (g.revokedAt) return { label: "revoked", tone: "danger" };
  if (g.kind === "referral" && g.endsAt && g.endsAt.getTime() === g.startsAt.getTime()) return { label: "stripe credit", tone: "pending" };
  if (g.startsAt.getTime() > now.getTime()) return { label: "upcoming", tone: "pending" };
  if (g.endsAt && g.endsAt.getTime() <= now.getTime()) return { label: "ended", tone: "pending" };
  return { label: "active", tone: "success" };
}

/**
 * ONE WORKSPACE, AND WHAT THE OWNER CAN DO ABOUT ITS PLAN: see where it came
 * from and what it holds — subscription, every grant it has ever had, the
 * codes behind them — and grant or revoke. Every act is audited.
 */
export default async function AdminWorkspacePage({ params, searchParams }: { params: Promise<{ orgId: string }>; searchParams: Promise<SP> }) {
  await requireStaff();
  const orgId = decodeURIComponent((await params).orgId);
  const sp = await searchParams;
  const card = await workspaceCard(orgId);
  if (!card) notFound();
  const billing = await workspaceBilling(orgId);
  const plan = describePlan(billing.plan);
  const sub = billing.subscription;
  const acq = billing.acquisition;
  const now = new Date();
  const noticeKey = ["done", "error"].map((k) => (one(sp[k]) ? `${k}=${one(sp[k])}` : "")).find(Boolean) ?? "";
  const notice = NOTICES[noticeKey];

  return (
    <PageContainer>
      <PageHeader title={card.name ?? "Workspace"} back={{ href: "/admin/search", label: "Workspaces" }} />

      {notice && (
        <p
          role={notice.tone === "danger" ? "alert" : "status"}
          className={
            notice.tone === "danger"
              ? "mb-6 rounded-card border border-danger-soft bg-danger-soft/50 p-4 text-sm text-danger-ink"
              : "mb-6 rounded-card border border-success-soft bg-success-soft/50 p-4 text-sm text-success-ink"
          }
        >
          {notice.text}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-8">
          <section>
            <SectionHeading>Plan</SectionHeading>
            <Card className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-semibold">{plan.title}</span>
                {plan.badge ? <StatusPill tone={plan.tone === "danger" ? "danger" : plan.tone === "warning" ? "warn" : "success"}>{plan.badge}</StatusPill> : null}
                <span className="text-xs text-muted-foreground">from {billing.plan.source}</span>
              </div>
              <p className="text-sm text-muted-foreground">{plan.detail}</p>
              <div className="border-t border-border pt-2">
                <AdminRow label="Stripe subscription" value={sub ? `${sub.status ?? "unknown"} · ${sub.plan ?? "?"} / ${sub.interval ?? "?"}` : "none"} />
                {sub?.currentPeriodEnd ? <AdminRow label="Period ends" value={day(sub.currentPeriodEnd)} /> : null}
                {sub?.cancelAtPeriodEnd ? <AdminRow label="Cancels" value="at period end" /> : null}
                {sub ? (
                  <div className="flex items-baseline justify-between gap-4 py-1">
                    <span className="text-xs text-muted-foreground">Customer</span>
                    <a
                      href={`https://dashboard.stripe.com/customers/${encodeURIComponent(sub.stripeCustomerId)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-foreground underline-offset-4 hover:underline"
                    >
                      {sub.stripeCustomerId}
                    </a>
                  </div>
                ) : null}
              </div>
            </Card>
          </section>

          <section>
            <SectionHeading>Grants</SectionHeading>
            {billing.grants.length === 0 ? (
              <Card>
                <span className="text-sm text-muted-foreground">No grants — no trial, code, gift or reward, ever.</span>
              </Card>
            ) : (
              <TableShell>
                <Table>
                  <THead>
                    <TR static>
                      <TH>Kind</TH>
                      <TH>Plan</TH>
                      <TH>Window</TH>
                      <TH>State</TH>
                      <TH>Note</TH>
                      <TH />
                    </TR>
                  </THead>
                  <TBody>
                    {billing.grants.map((g) => {
                      const state = grantState(g, now);
                      const live = state.label === "active" || state.label === "upcoming";
                      return (
                        <TR key={g.id} static>
                          <TD>
                            {g.kind}
                            {g.code ? <span className="ml-1 font-mono text-xs text-muted-foreground">{g.code}</span> : null}
                            {g.referralRung ? <span className="ml-1 text-xs text-muted-foreground">rung {g.referralRung}</span> : null}
                          </TD>
                          <TD>{isPaidPlan(g.plan) ? PLANS[g.plan].name : g.plan}</TD>
                          <TD className="whitespace-nowrap tabular-nums">
                            {day(g.startsAt)} → {g.endsAt ? day(g.endsAt) : "for life"}
                          </TD>
                          <TD>
                            <StatusPill tone={state.tone}>{state.label}</StatusPill>
                          </TD>
                          <TD className="max-w-60 truncate text-xs text-muted-foreground" title={g.note ?? undefined}>
                            {g.note ?? ""}
                          </TD>
                          <TD>
                            {live ? (
                              <form action={revokeGrantAction}>
                                <input type="hidden" name="orgId" value={orgId} />
                                <input type="hidden" name="grantId" value={g.id} />
                                <SubmitButton variant="ghost" size="sm" pendingLabel="Revoking…">
                                  Revoke
                                </SubmitButton>
                              </form>
                            ) : null}
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </TableShell>
            )}
          </section>

          <section>
            <SectionHeading>Grant a plan</SectionHeading>
            <Card>
              <form action={grantPlanAction} className="grid gap-4 sm:grid-cols-2">
                <input type="hidden" name="orgId" value={orgId} />
                <div>
                  <FieldLabel htmlFor="plan">Plan</FieldLabel>
                  <NativeSelect id="plan" name="plan" defaultValue="growth">
                    <option value="growth">Growth</option>
                    <option value="scale">Scale</option>
                  </NativeSelect>
                </div>
                <div>
                  <FieldLabel htmlFor="duration">For</FieldLabel>
                  <NativeSelect id="duration" name="duration" defaultValue="3">
                    <option value="1">1 month</option>
                    <option value="3">3 months</option>
                    <option value="6">6 months</option>
                    <option value="12">12 months</option>
                    <option value="24">24 months</option>
                    <option value="lifetime">For life</option>
                    <option value="until">Until a date…</option>
                  </NativeSelect>
                </div>
                <div>
                  <FieldLabel htmlFor="until">Date (for &ldquo;until a date&rdquo;)</FieldLabel>
                  <Input id="until" name="until" type="date" />
                </div>
                <div>
                  <FieldLabel htmlFor="note">Note (kept on the grant, not the log)</FieldLabel>
                  <Input id="note" name="note" placeholder="e.g. Podcast guest" maxLength={200} />
                </div>
                <div className="sm:col-span-2">
                  <SubmitButton pendingLabel="Granting…">Grant plan</SubmitButton>
                </div>
              </form>
            </Card>
          </section>
        </div>

        <aside className="flex flex-col gap-6">
          <WorkspaceCardView card={card} />
          <Card className="flex flex-col gap-1">
            <SectionHeading className="mb-1">Where it came from</SectionHeading>
            {acq && acq.source !== "direct" ? (
              <>
                <AdminRow label="Source" value={acq.source} />
                <AdminRow label="Medium" value={acq.medium} />
                {acq.campaign ? <AdminRow label="Campaign" value={acq.campaign} /> : null}
                <div className="flex items-baseline justify-between gap-4 py-1">
                  <span className="text-xs text-muted-foreground">Clicked</span>
                  <span className="text-sm">
                    <When at={acq.clickedAt} />
                  </span>
                </div>
                {acq.linkId ? (
                  <Link href="/admin/links" className="mt-1 text-xs text-muted-foreground underline-offset-4 hover:underline">
                    See the link&rsquo;s funnel
                  </Link>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{acq ? "Direct — no tracking link." : "Not recorded (made before tracking links)."}</p>
            )}
            <div className="mt-2 border-t border-border pt-2">
              <AdminRow label="People the owner referred" value={String(billing.referrals)} />
            </div>
          </Card>
        </aside>
      </div>
    </PageContainer>
  );
}
