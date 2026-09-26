import { PageContainer, PageHeader, SectionHeading } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { StatusPill } from "@/components/ui/badge";
import { TableShell, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { brokenConnections, fleetGrowth, fleetOverview, recentWorkspaces } from "@/lib/admin/fleet";
import { totalsFrom } from "@/lib/admin/growth";
import { resolveOrgNames } from "@/lib/admin/org-names";
import { MinorStats, PrimaryStat, Workspace, When } from "@/components/admin/bits";
import { GrowthSection } from "@/components/admin/growth-section";
import { FunnelTable } from "@/components/admin/funnel-table";
import { resumePlanPausesAction, startLaunchTrialsAction } from "@/app/admin/actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { billingOverview, growthFunnel } from "@/lib/admin/billing";
import { billingEnabled } from "@/lib/billing/state";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * THE FLEET AT A GLANCE.
 *
 * Every figure is either an exact count of a table bounded by human action, or
 * a planner estimate of one that grows with traffic — and the page says which,
 * because a number shown as exact when it is not is worse than a slower page.
 * The reasoning is in `src/lib/admin/fleet.ts`.
 *
 * NO WORKSPACE LIST. At a thousand customers that is a page nobody reads
 * backed by a query on every load. Drilling in is a search, on `/admin/search`.
 */

const fmt = new Intl.NumberFormat("en-GB");

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : (v ?? ""));
/** A count from the URL, or null — never the text itself, so a crafted link prints nothing here. */
const count = (v: string | string[] | undefined): number | null => (/^\d{1,7}$/.test(one(v)) ? Number(one(v)) : null);
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default async function AdminOverviewPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const fleet = await fleetOverview();
  /**
   * THE NEW TABLES MAY NOT EXIST YET. This page is older than migration 0035,
   * and the deploy can land before the owner pastes it — so a failed read
   * here renders a note rather than taking the whole overview down. A Next
   * navigation error (the 404 for non-staff) is never swallowed.
   */
  const soft = async <T,>(p: Promise<T>): Promise<T | null> =>
    p.catch((e: unknown) => {
      unstable_rethrow(e);
      console.error("[admin] billing read failed", e);
      return null;
    });
  const [money, funnel] = [await soft(billingOverview()), await soft(growthFunnel())];
  const billingOn = billingEnabled();
  const launched = count(sp.launched);
  const rewarded = count(sp.rewarded);
  const resumed = count(sp.resumed);
  const [broken, newWorkspaces, growth] = [await brokenConnections(), await recentWorkspaces(), await fleetGrowth(30)];
  const totals = totalsFrom(growth);
  /**
   * ONE RESOLUTION FOR THE WHOLE PAGE. The leaderboard, the broken connections
   * and the governance log all print workspaces, and the same workspace usually
   * appears in more than one of them — so the ids are pooled and deduped once
   * rather than each table looking up its own.
   */
  const names = await resolveOrgNames([
    ...fleet.topByConnections.map((r) => r.orgId),
    ...broken.map((c) => c.orgId),
    ...fleet.recentGovernance.map((g) => g.orgId),
  ]);

  const errored = fleet.connections.byStatus.find((s) => s.status === "error")?.n ?? 0;

  return (
    <PageContainer>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            Overview
            <InfoTip label="how these numbers are produced">
              Counts of things people create — workspaces, connections, flows, metrics — are always exact; those
              tables grow with deliberate action, so they stay small. Tables that grow with traffic are counted when
              they are small enough to scan cheaply and estimated when they are not, decided per table from its size
              on disk. An estimate is marked with a ~ and never shown as a fact. Nothing is cached, so these are the
              numbers as of the moment the page loaded.
            </InfoTip>
          </span>
        }
      />

      {/* FOUR, THEN THE REST. Eight identical tiles is a wall rather than a
          hierarchy: every figure at the same volume means the reader takes
          whichever is left-most. These four are the health of the business. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <PrimaryStat label="Workspaces" value={fleet.workspaces} hint={`${fmt.format(newWorkspaces)} created in 30 days`} />
        <PrimaryStat label="People" value={fleet.people} hint="workspace owners — a floor, not a headcount" />
        <PrimaryStat
          label="Connections"
          value={fleet.connections.total}
          hint={errored > 0 ? `${errored} in error` : "all healthy"}
          /* The one figure on the page that can demand action, so it is the one
             allowed to change colour when it does. */
          tone={errored > 0 ? "warn" : undefined}
        />
        <PrimaryStat label="Flows" value={fleet.built.flows} hint="the act the product exists for" />
      </div>

      <div className="mt-3">
        <MinorStats
          items={[
            { label: "board tiles", value: fleet.built.tiles },
            { label: "classic metrics", value: fleet.built.metrics },
            { label: "AI assistants", value: fleet.ai.grants },
            { label: "referred signups", value: fleet.referrals },
          ]}
        />
      </div>

      {/* ── MONEY AND WHERE IT COMES FROM ─────────────────────────────────
          MRR is list price: a yearly plan counts a twelfth a month, and
          discounts or referral credits are not netted off. Stripe's own
          dashboard is the ledger; this is the pulse. */}
      {launched !== null && (
        <p role="status" className="mt-6 rounded-card border border-success-soft bg-success-soft/50 p-4 text-sm text-success-ink">
          Launch trials: {launched} {launched === 1 ? "workspace" : "workspaces"} got 30 days of Growth
          {rewarded ? `, and ${rewarded} referral ${rewarded === 1 ? "reward was" : "rewards were"} paid` : ""}.
          {billingOn ? "" : " Now switch BILLING_ENABLED on, then press it once more to catch any workspace made in between."}
        </p>
      )}
      {resumed !== null && (
        <p role="status" className="mt-6 rounded-card border border-success-soft bg-success-soft/50 p-4 text-sm text-success-ink">
          {resumed} {resumed === 1 ? "app" : "apps"} paused by a plan {resumed === 1 ? "is" : "are"} syncing again.
        </p>
      )}
      {one(sp.error) === "billing_on" && (
        <p role="alert" className="mt-6 rounded-card border border-danger-soft bg-danger-soft/50 p-4 text-sm text-danger-ink">
          While billing is on, plan pauses follow each workspace&rsquo;s plan — switch BILLING_ENABLED off first.
        </p>
      )}
      {!money || !funnel ? (
        <p role="alert" className="mt-6 rounded-card border border-warn/25 bg-warn-soft p-4 text-sm text-warn-ink">
          Revenue, trials and links need migration 0035 — paste it (see drizzle/HAND_APPLY.md) and this fills in.
        </p>
      ) : null}
      {money && (
      <section className="mt-8">
        <SectionHeading>Revenue</SectionHeading>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <PrimaryStat label="Paying" value={money.paying} hint={money.byPlan.map((p) => `${p.n} ${p.plan}`).join(" · ") || "none yet"} />
          <Card className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">MRR</span>
            <span className="stat-numeral text-display-sm font-semibold leading-none tabular-nums">{usd.format(money.mrr)}</span>
            <span className="text-xs text-muted-foreground">list price, a month</span>
          </Card>
          <PrimaryStat label="On a trial" value={money.trialsActive} hint="in-app, launch and card trials" />
          {/* PRESS BEFORE THE FLIP, AND ONCE AFTER. Granting first means no
              workspace is ever on Free at the moment billing comes on (members
              past one seat would be sent to /seat, metrics past five locked);
              the second press catches any workspace made in between. Each
              workspace only ever gets one launch trial, so pressing again is safe. */}
          <Card className="flex flex-col justify-between gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Launch trials</span>
            {money.launchStartedAt ? <span className="text-sm">First run {money.launchStartedAt.toISOString().slice(0, 10)}</span> : null}
            <form action={startLaunchTrialsAction}>
              <SubmitButton size="sm" pendingLabel="Starting…">
                {money.launchStartedAt ? "Run launch trials again" : "Start launch trials"}
              </SubmitButton>
            </form>
            <span className="text-xs text-muted-foreground">
              30 days of Growth for every workspace without a plan, once each. Press it before switching billing on, and once after.
            </span>
          </Card>
          {/* THE KILL SWITCH'S OTHER HALF. Turning billing off stops every limit,
              but an app a plan already paused stays paused — its pause never
              falls due. This lifts them all. */}
          {!billingOn && money.planPaused > 0 ? (
            <Card className="flex flex-col justify-between gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Paused by a plan</span>
              <span className="text-sm">
                {money.planPaused} {money.planPaused === 1 ? "app" : "apps"} still paused
              </span>
              <form action={resumePlanPausesAction}>
                <SubmitButton size="sm" variant="default" pendingLabel="Resuming…">
                  Resume them all
                </SubmitButton>
              </form>
            </Card>
          ) : null}
        </div>
      </section>
      )}

      {funnel && (
      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-4">
          <SectionHeading>Where customers come from</SectionHeading>
          <Link href="/admin/links" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
            Links and their funnels
          </Link>
        </div>
        <FunnelTable
          rows={funnel.sources.map((r) => ({ key: r.source, name: r.source === "direct" ? "Direct (no link)" : r.source, ...r }))}
          empty="No sign-ups recorded yet. Make a tracking link to see where they come from."
        />
      </section>
      )}

      <GrowthSection series={growth} totals={totals} />

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <SectionHeading>Most connections on one workspace</SectionHeading>
          <TableShell>
            <Table>
              <THead>
                <TR static>
                  <TH>Workspace</TH>
                  <TH>Apps</TH>
                </TR>
              </THead>
              <TBody>
                {fleet.topByConnections.length === 0 ? (
                  <TR static>
                    <TD colSpan={2}>No connections yet.</TD>
                  </TR>
                ) : (
                  fleet.topByConnections.map((row) => (
                    <TR key={row.orgId} static>
                      {/*
                        THE NAME NOW, not the id. The old note here — "resolving
                        ten names means ten WorkOS calls on every page load" —
                        was defending against a cost this page explicitly
                        accepts ("even if it takes 10 seconds to load in doesn't
                        matter"). Ten parallel lookups is under a second, and it
                        is the difference between a leaderboard and a column of
                        hex nobody can act on. Bounded in `org-names.ts`.
                      */}
                      <TD><Workspace orgId={row.orgId} names={names} /></TD>
                      <TD className="tabular-nums">{row.n}</TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </TableShell>
        </div>

        <div>
          <SectionHeading>Which apps people connect</SectionHeading>
          <TableShell>
            <Table>
              <THead>
                <TR static>
                  <TH>Source</TH>
                  <TH>Connections</TH>
                </TR>
              </THead>
              <TBody>
                {fleet.connections.bySource.map((row) => (
                  <TR key={row.source} static>
                    <TD>{row.source}</TD>
                    <TD className="tabular-nums">{row.n}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableShell>
        </div>
      </section>

      <section className="mt-8">
        <SectionHeading>
          Needs attention
        </SectionHeading>
        {broken.length === 0 ? (
          <Card>
            <span className="text-sm text-muted-foreground">No connection is in an error state.</span>
          </Card>
        ) : (
          <TableShell>
            <Table>
              <THead>
                <TR static>
                  <TH>Workspace</TH>
                  <TH>Source</TH>
                  <TH>Status</TH>
                  <TH>Last event</TH>
                </TR>
              </THead>
              <TBody>
                {broken.map((c, i) => (
                  <TR key={`${c.orgId}-${c.source}-${i}`} static>
                    <TD><Workspace orgId={c.orgId} names={names} /></TD>
                    <TD>{c.source}</TD>
                    <TD>
                      <StatusPill tone="danger">{c.status === "error" ? "connection" : "sync"}</StatusPill>
                    </TD>
                    <TD className="text-muted-foreground"><When at={c.lastEventAt} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableShell>
        )}
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <SectionHeading>Volume</SectionHeading>
          <TableShell>
            <Table>
              <THead>
                <TR static>
                  <TH>Table</TH>
                  <TH>Rows</TH>
                </TR>
              </THead>
              <TBody>
                {fleet.approx.map((row) => (
                  <TR key={row.table} static>
                    <TD className="font-mono text-xs">{row.table}</TD>
                    {/*
                      Three states, and the tilde carries the meaning. A table
                      small enough to scan was COUNTED and reads exactly; a
                      large one is the planner's estimate and reads `~`; a large
                      one never analysed has no honest answer and reads unknown
                      rather than a confident zero. Showing an estimate as a
                      fact is the reading that would actually mislead.
                    */}
                    <TD className="tabular-nums">
                      {row.rows === null ? "unknown" : row.exact ? fmt.format(row.rows) : `~${fmt.format(row.rows)}`}
                    </TD>
                  </TR>
                ))}
                <TR static>
                  <TD className="font-mono text-xs">dead_letter (unresolved)</TD>
                  <TD className="tabular-nums">{fmt.format(fleet.unresolvedDeadLetter)}</TD>
                </TR>
                <TR static>
                  <TD colSpan={2} className="text-xs text-muted-foreground">
                    A ~ marks the database&rsquo;s own estimate, used only where the table is too large to count
                    cheaply.
                  </TD>
                </TR>
              </TBody>
            </Table>
          </TableShell>
        </div>

        <div>
          <SectionHeading>Latest governance</SectionHeading>
          <TableShell>
            <Table>
              <THead>
                <TR static>
                  <TH>Act</TH>
                  <TH>Workspace</TH>
                  <TH>When</TH>
                </TR>
              </THead>
              <TBody>
                {fleet.recentGovernance.length === 0 ? (
                  <TR static>
                    <TD colSpan={3}>Nothing recorded yet.</TD>
                  </TR>
                ) : (
                  fleet.recentGovernance.map((row, i) => (
                    <TR key={`${row.action}-${i}`} static>
                      <TD className="font-mono text-xs">{row.action}</TD>
                      <TD><Workspace orgId={row.orgId} names={names} /></TD>
                      {/* "how long ago", with the exact instant on hover. The
                          ISO string wrapped onto three lines in this column and
                          still needed arithmetic to be useful. */}
                      <TD className="text-muted-foreground"><When at={row.at} /></TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </TableShell>
        </div>
      </section>
    </PageContainer>
  );
}
