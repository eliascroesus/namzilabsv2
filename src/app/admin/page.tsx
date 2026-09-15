import { PageContainer, PageHeader, SectionHeading } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { StatusPill } from "@/components/ui/badge";
import { TableShell, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { brokenConnections, fleetOverview, recentWorkspaces } from "@/lib/admin/fleet";

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

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </Card>
  );
}

export default async function AdminOverviewPage() {
  const fleet = await fleetOverview();
  const [broken, newWorkspaces] = [await brokenConnections(), await recentWorkspaces()];

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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Workspaces" value={fmt.format(fleet.workspaces)} hint={`${fmt.format(newWorkspaces)} in the last 30 days`} />
        <Stat label="People" value={fmt.format(fleet.people)} hint="distinct workspace owners" />
        <Stat label="Connections" value={fmt.format(fleet.connections.total)} hint={errored > 0 ? `${errored} in error` : "all healthy"} />
        <Stat label="AI assistants" value={fmt.format(fleet.ai.grants)} hint="workspaces connected" />
        <Stat label="Flows" value={fmt.format(fleet.built.flows)} />
        <Stat label="Metrics" value={fmt.format(fleet.built.metrics)} />
        <Stat label="Board tiles" value={fmt.format(fleet.built.tiles)} />
        <Stat label="Referrals" value={fmt.format(fleet.referrals)} hint="signups attributed" />
      </div>

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
                        The id, not the name. Resolving ten names means ten
                        WorkOS calls on every page load for a leaderboard —
                        paste the id into Look up when one of them matters.
                      */}
                      <TD className="font-mono text-xs">{row.orgId}</TD>
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
                    <TD className="font-mono text-xs">{c.orgId}</TD>
                    <TD>{c.source}</TD>
                    <TD>
                      <StatusPill tone="danger">{c.status === "error" ? "connection" : "sync"}</StatusPill>
                    </TD>
                    <TD className="text-muted-foreground">
                      {c.lastEventAt ? c.lastEventAt.toISOString().slice(0, 10) : "never"}
                    </TD>
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
                      <TD className="font-mono text-xs text-muted-foreground">{row.orgId ?? "—"}</TD>
                      <TD className="text-muted-foreground">{row.at.toISOString().slice(0, 16).replace("T", " ")}</TD>
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
