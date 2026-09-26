import { FunnelTable } from "@/components/admin/funnel-table";
import { PlanBanner } from "@/components/billing/plan-banner";
import { PlanPicker, type PlanPickerProps } from "@/components/billing/plan-picker";
import { PlanStatus, type Usage } from "@/components/billing/plan-status";
import { CustomTile } from "@/components/custom-tile";
import { FlowTile } from "@/components/flow-tile";
import { BOARD_GRID, PageContainer, SectionHeading } from "@/components/ui/page";
import { describePlan } from "@/lib/billing/describe";
import { lockRow } from "@/lib/billing/locks";
import type { ResolvedPlan } from "@/lib/billing/resolve";

export const dynamic = "force-dynamic";

/**
 * PLANS AND BILLING, ON A PUBLIC ROUTE — the real picker and the real status
 * card in every state that changes what they say, drawn from fixtures.
 *
 * `/onboarding/plan` and `/dashboard/settings/billing` need a session and a
 * workspace, so nothing outside one could look at them; this is how their
 * layout gets seen in a browser before a customer sees it (see
 * [[source-tests-cannot-see-layout]] in the project notes).
 */

const NOW = new Date();
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const plan = (over: Partial<ResolvedPlan>): ResolvedPlan => ({ plan: "free", source: "free", state: "free", endsAt: null, lifetime: false, ...over });

const usage = (apps: number, metrics: number, members: number, limits: [number, number, number], unlimited = false): Usage[] => [
  { label: "Apps", used: apps, limit: limits[0], unlimited, overNote: "Apps past the limit are paused — nothing is deleted" },
  { label: "Metrics", used: metrics, limit: limits[1], unlimited, overNote: "Metrics past the limit are locked — nothing is deleted" },
  { label: "Members", used: members, limit: limits[2], overNote: "Members past the limit can't open the workspace until you upgrade" },
];

const STATUSES: Array<{ name: string; plan: ResolvedPlan; usage: Usage[] }> = [
  { name: "Free, over its limits after a trial", plan: plan({}), usage: usage(4, 9, 1, [3, 5, 1]) },
  { name: "Growth trial, 23 days left", plan: plan({ plan: "growth", source: "trial", state: "trialing", endsAt: days(23) }), usage: usage(4, 12, 2, [10, 50, 5]) },
  { name: "Growth trial, 3 days left", plan: plan({ plan: "growth", source: "trial", state: "trialing", endsAt: days(3) }), usage: usage(4, 12, 2, [10, 50, 5]) },
  { name: "Scale, paying", plan: plan({ plan: "scale", source: "subscription", state: "active" }), usage: usage(14, 120, 9, [50, 500, 20], true) },
  { name: "Growth, payment failing", plan: plan({ plan: "growth", source: "subscription", state: "past_due" }), usage: usage(6, 30, 3, [10, 50, 5]) },
  { name: "Growth, cancelled", plan: plan({ plan: "growth", source: "subscription", state: "canceling", endsAt: days(12) }), usage: usage(6, 30, 3, [10, 50, 5]) },
  { name: "Growth from a code", plan: plan({ plan: "growth", source: "code", state: "granted", endsAt: days(80) }), usage: usage(2, 7, 1, [10, 50, 5]) },
];

/** One live metric beside two locked ones — the locked cards must sit in the grid like any other. */
const flowRow = (id: string, name: string, value: number) => ({
  flowId: id,
  outputNodeId: "n1",
  tile: { name, viz: "number", format: "number", precision: 0, value } as Record<string, unknown>,
  status: "fresh",
  error: null,
  computedAt: new Date(NOW.getTime() - 3_600_000),
});
const LIVE = flowRow("f-live", "Booked calls", 42);
const LOCKED = [lockRow(flowRow("f-l1", "Cash collected", 18250)), lockRow(flowRow("f-l2", "Show rate", 71))];

const BANNERS: Array<{ name: string; plan: ResolvedPlan; lockedCount?: number; welcome?: string }> = [
  { name: "Welcome to a trial", plan: plan({ plan: "growth", source: "trial", state: "trialing", endsAt: days(30) }), welcome: "trial" },
  { name: "Trial, 3 days left", plan: plan({ plan: "growth", source: "trial", state: "trialing", endsAt: days(3) }) },
  { name: "Payment failing", plan: plan({ plan: "growth", source: "subscription", state: "past_due" }) },
  { name: "Downgraded, 4 locked", plan: plan({}), lockedCount: 4 },
];

const PICKERS: Array<{ name: string; props: PlanPickerProps }> = [
  { name: "Onboarding — trial available", props: { mode: "onboarding", current: "free", currentSource: "free", trialAvailable: true, next: "/dashboard" } },
  { name: "Onboarding — trial already used", props: { mode: "onboarding", current: "free", currentSource: "free", trialAvailable: false, next: "/dashboard" } },
  { name: "Settings — on a Growth trial", props: { mode: "settings", current: "growth", currentSource: "trial", trialAvailable: false } },
  { name: "Settings — paying for Growth", props: { mode: "settings", current: "growth", currentSource: "subscription", trialAvailable: false } },
  { name: "Settings — Scale for life", props: { mode: "settings", current: "scale", currentSource: "manual", trialAvailable: false, lifetime: true } },
  { name: "Settings — a member who can't change the plan", props: { mode: "settings", current: "free", currentSource: "free", trialAvailable: true, readOnly: true } },
  { name: "Public pricing", props: { mode: "public", current: null, currentSource: null, trialAvailable: true } },
];

export default function DesignBillingPage() {
  return (
    <div className="min-h-screen bg-canvas-bg py-10">
      <PageContainer>
        <SectionHeading>Plan status</SectionHeading>
        <div className="mt-4 flex flex-col gap-6">
          {STATUSES.map((s) => (
            <figure key={s.name} data-case={s.name}>
              <figcaption className="mb-2 text-xs text-muted-foreground">{s.name}</figcaption>
              <PlanStatus description={describePlan(s.plan, NOW)} usage={s.usage} />
            </figure>
          ))}
        </div>

        <SectionHeading className="mt-14">Locked metrics</SectionHeading>
        <figure data-case="Board with locked metrics" className="mt-4">
          <figcaption className="mb-2 text-xs text-muted-foreground">Board — one live metric, two past the plan</figcaption>
          <div className={BOARD_GRID}>
            <FlowTile row={LIVE} />
            {LOCKED.map((r) => (
              <FlowTile key={r.flowId} row={r} />
            ))}
          </div>
        </figure>
        <figure data-case="Custom view with a locked chart" className="mt-6">
          <figcaption className="mb-2 text-xs text-muted-foreground">Custom view — a locked line chart</figcaption>
          <div className="h-64 max-w-xl">
            <CustomTile chart="line" title="Cash collected" rangeKey="30d" source={{ kind: "flow", tile: LOCKED[0].tile, flowId: "f-l1", locked: true }} />
          </div>
        </figure>

        <SectionHeading className="mt-14">Banners</SectionHeading>
        <div className="mt-4 flex flex-col gap-2">
          {BANNERS.map((b) => (
            <figure key={b.name} data-case={b.name}>
              <figcaption className="mb-2 text-xs text-muted-foreground">{b.name}</figcaption>
              <PlanBanner plan={b.plan} lockedCount={b.lockedCount ?? 0} welcome={b.welcome} dismissHref="/design/billing" now={NOW} />
            </figure>
          ))}
        </div>

        <SectionHeading className="mt-14">Admin — where customers come from</SectionHeading>
        <figure data-case="Admin funnel" className="mt-4">
          <FunnelTable
            rows={[
              { key: "instagram", name: "instagram", clicks: 412, signups: 38, connected: 29, metric: 22, trials: 17, paying: 6 },
              { key: "facebook", name: "facebook", clicks: 980, signups: 41, connected: 20, metric: 12, trials: 9, paying: 2 },
              { key: "direct", name: "Direct (no link)", clicks: null, signups: 57, connected: 40, metric: 31, trials: 25, paying: 11 },
            ]}
          />
        </figure>

        <SectionHeading className="mt-14">Plan picker</SectionHeading>
        <div className="mt-4 flex flex-col gap-14">
          {PICKERS.map((p) => (
            <figure key={p.name} data-case={p.name}>
              <figcaption className="mb-3 text-xs text-muted-foreground">{p.name}</figcaption>
              <PlanPicker {...p.props} />
            </figure>
          ))}
        </div>
      </PageContainer>
    </div>
  );
}
