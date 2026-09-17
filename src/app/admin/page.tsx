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

export default async function AdminOverviewPage() {
  const fleet = await fleetOverview();
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
