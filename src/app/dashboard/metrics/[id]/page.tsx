import Link from "next/link";
import { notFound } from "next/navigation";
import { Inbox } from "lucide-react";
import { requireOrg, requestAccess } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { FunnelView } from "@/components/funnel-view";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer, PageHeader, SectionHeading } from "@/components/ui/page";
import { Table, TableShell, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { getDb } from "@/db/client";
import { getMetric } from "@/lib/metrics/store";
import { parseDefinition } from "@/lib/metrics/types";
import { computeAggregate, computeFunnel, queryEvents } from "@/lib/metrics/compute";
import { resolveRange, RANGE_OPTIONS } from "@/lib/metrics/range";
import { catalogEntry, eventTypeLabel } from "@/connectors/catalog";
import { formatDateTime, formatMetricValue } from "@/lib/format";
import { deleteMetricAction } from "@/app/dashboard/metrics/actions";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : (v ?? ""));

export default async function MetricDrillPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SP>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { orgId, userId, role, auth } = await requireOrg();

  const metric = await getMetric(orgId, id);
  if (!metric) notFound();
  // A hidden metric's drill-in is its name, headline and 100 raw rows — the
  // exact data the hidden tile hides. Same 404 as a missing metric: a 403
  // would confirm existence, and URL secrecy is not a control.
  const access = await requestAccess(orgId, userId, role);
  if (!access.canSeeMetric(`metric:${id}`)) notFound();

  const { key: rangeKey, range } = resolveRange(one(sp.range) || "30d");
  // The lede states the window the numbers actually cover — resolveRange has
  // its own fallback for unknown keys, so the label follows its answer.
  const rangeLabel = (RANGE_OPTIONS.find((r) => r.key === rangeKey)?.label ?? "Last 30 days").toLowerCase();
  const def = parseDefinition(metric.definition);

  // Deleting is a two-step ceremony without client JS: the first click only
  // adds ?confirmDelete=1 and the re-render offers Cancel beside the real
  // destructive submit.
  const confirmingDelete = one(sp.confirmDelete) === "1";
  const selfHref = (confirm: boolean) => {
    const p = new URLSearchParams();
    const r = one(sp.range);
    if (r) p.set("range", r);
    if (confirm) p.set("confirmDelete", "1");
    const qs = p.toString();
    return qs ? `/dashboard/metrics/${id}?${qs}` : `/dashboard/metrics/${id}`;
  };

  let headline: number | null = null;
  let rows: Awaited<ReturnType<typeof queryEvents>> = [];
  let funnel: Awaited<ReturnType<typeof computeFunnel>> | null = null;
  let error: string | null = null;

  try {
    if (def.kind === "aggregate") {
      const res = await computeAggregate(getDb(), orgId, def, range);
      headline = res.kind === "scalar" ? res.value : res.series.reduce((a, b) => a + b.value, 0);
      rows = await queryEvents(getDb(), orgId, {
        source: def.source,
        eventType: def.eventType,
        filters: def.filters,
        range,
        limit: 100,
      });
    } else {
      funnel = await computeFunnel(getDb(), orgId, def, range);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <AppShell userId={userId} orgId={orgId} userEmail={auth.user.email}>
      <PageContainer width="narrow">
        <PageHeader
          back={{ href: "/dashboard", label: "Dashboard" }}
          title={metric.name}
          lede={`${def.kind === "aggregate" ? "Metric" : "Funnel"} · ${rangeLabel}`}
          actions={
            confirmingDelete ? (
              <>
                <Link href={selfHref(false)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
                  Cancel
                </Link>
                <form action={deleteMetricAction}>
                  <input type="hidden" name="id" value={metric.id} />
                  <Button type="submit" variant="destructive" size="sm">
                    Delete metric
                  </Button>
                </form>
              </>
            ) : (
              <Link href={selfHref(true)} className={cn(buttonVariants({ variant: "destructiveOutline", size: "sm" }))}>
                Delete
              </Link>
            )
          }
        />

        {error && (
          <div className="mt-4 rounded-card border border-warn-soft bg-warn-soft/50 p-4 text-base text-warn-ink">
            {error}
          </div>
        )}

        {def.kind === "aggregate" && (
          <>
            {/* Same formatter as the dashboard tile — the drill-in must read
                the exact number the tile promised. A legacy metric stores no
                precision, so an integer keeps none and a real decimal keeps
                two rather than being silently rounded away. */}
            {/* IN A TILE, like the one that was clicked to get here. The
                number used to sit flat on the page — which read as a heading
                on white and reads as an unhoused number on the canvas. Same
                surface, same numeral, so the drill-in visibly continues the
                tile rather than restating it. */}
            <Card variant="surface" className="mt-6">
              <p className="stat-numeral text-stat leading-none">
                {formatMetricValue(headline, {
                  format: "number",
                  precision: headline != null && Number.isInteger(headline) ? 0 : 2,
                })}
                {metric.unit && <span className="ml-2 text-base font-normal text-muted-foreground">{metric.unit}</span>}
              </p>
              <p className="mt-2 text-tiny text-muted-foreground">{rangeLabel}</p>
            </Card>
            <SectionHeading className="mt-8">Underlying events ({rows.length})</SectionHeading>
            {rows.length === 0 ? (
              <EmptyState
                icon={<Inbox />}
                title="No matching events"
                description="No events matched this metric in this window."
              />
            ) : (
              <TableShell>
                <Table>
                  <THead>
                    <TR static>
                      <TH>Source</TH>
                      <TH>Type</TH>
                      <TH>Subject</TH>
                      <TH>Value</TH>
                      <TH>Occurred</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {/* Humanised the way the dashboard feed does it — "Close
                        CRM · Lead created", not "close · lead_created". The
                        raw type rides along in the title attribute, because
                        it IS what the metric's filter matches on. */}
                    {rows.map((e) => (
                      <TR key={e.id}>
                        <TD>{catalogEntry(e.source)?.name ?? e.source}</TD>
                        <TD title={e.eventType}>{eventTypeLabel(e.source, e.eventType)}</TD>
                        <TD>{e.subject ?? "—"}</TD>
                        <TD className="tnum">{e.value ?? "—"}</TD>
                        <TD className="text-muted-foreground">{formatDateTime(new Date(e.occurredAt))}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableShell>
            )}
          </>
        )}

        {def.kind === "funnel" && funnel && (
          // Same housing as the aggregate's number above: a funnel is the other
          // half of "what this metric says", and it was the one reading in the
          // product still drawn straight onto the page.
          <Card variant="surface" className="mt-6">
            <FunnelView result={funnel} />
          </Card>
        )}
      </PageContainer>
    </AppShell>
  );
}
