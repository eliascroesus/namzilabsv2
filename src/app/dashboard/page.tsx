import { Plus } from "lucide-react";
import Link from "next/link";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getReadDb } from "@/db/client";
import { connections, events, flows } from "@/db/schema";
import { unresolvedDeadLetterCountsByConnection } from "@/lib/dead-letter";
import { requireOrg } from "@/lib/auth";
import { effectiveAccess } from "@/lib/permissions";
import { AppShell } from "@/components/app-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageContainer, PageHeader, SectionHeading } from "@/components/ui/page";
import { Table, TableShell, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Sparkbars, TargetBar } from "@/components/charts";
import { FreshnessPoller } from "@/components/freshness-poller";
import { FunnelView } from "@/components/funnel-view";
import { FlowTile, type FlowResultRow } from "@/components/flow-tile";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import { importProgressByStreamRef } from "@/lib/backfill/jobs";
import { publishedFlowTiles } from "@/lib/flow/materialize";
import { refreshAllFlowsAction } from "@/app/dashboard/flows/actions";
import { listMetrics, type Metric } from "@/lib/metrics/store";
import { parseDefinition } from "@/lib/metrics/types";
import {
  computeAggregate,
  computeFunnel,
  distinctSources,
  type AggregateResult,
  type FunnelResult,
} from "@/lib/metrics/compute";
import { resolveRange, RANGE_OPTIONS } from "@/lib/metrics/range";
import { catalogEntry, eventTypeLabel } from "@/connectors/catalog";
import { formatDateTime, formatMetricValue } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ImportCoverage } from "@/connectors/types";

export const dynamic = "force-dynamic";

/**
 * Serverless duration budget: the tile "Refresh" button's server action runs
 * `materializeFlow` INLINE under this segment's config — a full flow compute
 * over up to APP_LOAD_CEILING rows — and the platform default (10s Hobby)
 * kills it mid-write. 60 is the Hobby ceiling; pinned by
 * tests/timeout-budgets.test.ts.
 */
export const maxDuration = 60;

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : (v ?? ""));

type Tile =
  | { metric: Metric; kind: "aggregate"; result: AggregateResult; error?: undefined }
  | { metric: Metric; kind: "funnel"; result: FunnelResult; error?: undefined }
  | { metric: Metric; kind: "error"; error: string };

/**
 * The stream keys `materializeFlow` recorded alongside a result.
 *
 * Defensive because `provenance` is untyped jsonb written by an older code
 * path for every row that predates this: a result materialized before the
 * mapping existed simply has no streams, and must read as "nothing importing"
 * rather than throw the dashboard.
 */
function streamRefsOfProvenance(provenance: unknown): Array<{ connectionId: string; configHash: string }> {
  const streams = (provenance as { streams?: unknown } | null)?.streams;
  if (!Array.isArray(streams)) return [];
  return streams.filter(
    (s): s is { connectionId: string; configHash: string } =>
      typeof (s as { connectionId?: unknown })?.connectionId === "string" &&
      typeof (s as { configHash?: unknown })?.configHash === "string",
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { orgId, userId, role, auth } = await requireOrg();
  const db = getReadDb(); // read-only surface: rides the DB_DRIVER_READ soak seam (B.3)

  // Rank-based metric visibility, resolved once for the whole page. Admins and
  // members with no rank short-circuit to allow-all inside effectiveAccess, so
  // the common case costs at most one assignment lookup.
  const access = await effectiveAccess(db, { orgId, userId, role });

  const rangeKey = one(sp.range) || "7d";
  const { range } = resolveRange(rangeKey);
  const boardSource = one(sp.source) || null;

  let metrics: Metric[] = [];
  let sources: string[] = [];
  let recentEvents: (typeof events.$inferSelect)[] = [];
  let dlqByConnection: Array<{ connectionId: string; name: string; count: number }> = [];
  let connCount = 0;
  let flowCount = 0;
  let loadError: string | null = null;

  try {
    [metrics, sources, recentEvents, dlqByConnection, connCount, flowCount] = await Promise.all([
      listMetrics(orgId),
      distinctSources(db, orgId),
      // Live rows only (query convention: every events read filters deleted_at,
      // src/db/schema.ts). receivedAt ordering is intentional for an activity
      // feed; the top-6 sort over one org's live rows is bounded and cheap.
      db.select().from(events).where(and(eq(events.orgId, orgId), isNull(events.deletedAt))).orderBy(desc(events.receivedAt)).limit(6),
      // Per-connection, not a scalar: the red number links to the page with
      // the Replay button instead of being a dead end.
      unresolvedDeadLetterCountsByConnection(db, orgId),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(connections)
        .where(eq(connections.orgId, orgId))
        .then((r) => Number(r[0]?.c ?? 0)),
      // Drives the onboarding checklist's "build your first flow" checkmark.
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(flows)
        .where(eq(flows.orgId, orgId))
        .then((r) => Number(r[0]?.c ?? 0)),
    ]);
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  // Filter the SOURCE list, not the rendering: every classic-metric surface on
  // this page (aggregate tiles, funnel tiles, drill-in links) derives from
  // `metrics`, so a hidden metric cannot leak through any section — and its
  // compute below is never even run.
  if (!access.admin) {
    metrics = metrics.filter((m) => access.canSeeMetric(`metric:${m.id}`));
  }

  const tiles: Tile[] = await Promise.all(
    metrics.map(async (metric): Promise<Tile> => {
      try {
        const def = parseDefinition(metric.definition);
        if (def.kind === "funnel") {
          return { metric, kind: "funnel", result: await computeFunnel(db, orgId, def, range, boardSource) };
        }
        return { metric, kind: "aggregate", result: await computeAggregate(db, orgId, def, range, boardSource) };
      } catch (err) {
        return { metric, kind: "error", error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  // Published-flow tiles come from stored (materialized) results — no live recompute.
  let flowTiles: FlowResultRow[] = [];
  try {
    const allRows = await publishedFlowTiles(db, orgId);
    // Same as the metrics filter above: drop hidden flows at the source, so
    // neither the tiles nor the import-badge join below ever see them.
    const rows = access.admin ? allRows : allRows.filter((r) => access.canSeeMetric(`flow:${r.flowId}`));

    /**
     * Phase 8 — import state is joined HERE, at read time, and deliberately not
     * baked into the stored tile.
     *
     * `materializeFlow` writes each flow's tiles in its own call, so a stored
     * note would freeze whatever the import had reached at that moment and two
     * flows on one backfilling stream would show different numbers for the same
     * import. Reading live gives the state exactly one home.
     *
     * One query for the whole dashboard, not one per tile.
     */
    // The TILES land first, and the import badge is decorated on afterwards.
    //
    // Assigning them only after the progress join meant a failure in that join
    // fell to the catch below with `flowTiles` still empty — so every published
    // number vanished from the dashboard and nothing said why. An import badge is
    // an annotation on a number; it must not be able to take the number with it.
    flowTiles = rows.map((r) => ({ ...r }));
    try {
      const refs = rows.flatMap((r) => streamRefsOfProvenance(r.provenance));
      const progress = await importProgressByStreamRef(db, orgId, refs);
      flowTiles = rows.map((r) => {
        const mine = streamRefsOfProvenance(r.provenance)
          .map((ref) => progress.get(`${ref.connectionId}:${ref.configHash}`))
          .filter((p): p is ImportCoverage => p != null);
        // A flow reading two streams shows the one with furthest still to go —
        // the number is only as settled as its least-settled input.
        const importing = mine.sort((a, b) => b.targetMs - b.coveredMs - (a.targetMs - a.coveredMs))[0];
        return { ...r, importing };
      });
    } catch {
      // No badge rather than no dashboard.
    }
  } catch (err) {
    // A failed tile read is a LOAD ERROR, never an empty state. The bare
    // catch that used to live here ("flow_results may not exist before
    // migration 0002") outlived its rationale by nineteen migrations and
    // spent that time converting transient DB failures into "No metrics
    // yet." over a customer's real published tiles. `??=` keeps the first
    // failure's message when the earlier Promise.all already set one.
    loadError ??= err instanceof Error ? err.message : String(err);
  }
  const hasTiles = tiles.length > 0 || flowTiles.length > 0;

  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    p.set("range", over.range ?? rangeKey);
    if (over.source ?? boardSource) p.set("source", over.source ?? boardSource ?? "");
    return `/dashboard?${p.toString()}`;
  };

  // One voice for every filter chip on the page — the Chip recipe, worn by
  // links. These chips navigate (range and source live in the URL), so they
  // stay anchors and take the Chip component's exact classes instead.
  const chip = (active: boolean) =>
    cn(
      "inline-flex shrink-0 items-center rounded-full px-3 py-1.5 text-small font-medium outline-none transition-colors focus-visible:ring-4 focus-visible:ring-ring/40",
      active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
    );

  return (
    <AppShell userId={userId} orgId={orgId} userEmail={auth.user.email}>
      {/* G.4: refresh the server-rendered tiles when the org's results move. */}
      <FreshnessPoller />
      <PageContainer>
        <PageHeader
          title="Dashboard"
          actions={
            <>
              {/* Every tile at once. The per-tile Refresh recomputes one flow,
                  which is the wrong unit when you have just changed something
                  upstream and want the whole board to agree with reality. */}
              <form action={refreshAllFlowsAction}>
                <Button type="submit" variant="secondary" title="Recompute every published metric now">
                  Refresh
                </Button>
              </form>
              {/* ONE way to build a metric. The retired form builder was still
                  advertised here as "Classic metric", and "classic" reads as
                  "the stable one" — so a first-time user took it, produced a
                  `metrics` row instead of a flow, and never saw the canvas.
                  The routes stay alive so existing metrics still open and edit
                  (their tiles link to them); they are simply no longer a door
                  anyone walks through by accident. */}
              {/* A Link wearing the Button's clothes: navigation, not a submit,
                  so it stays an <a> and takes the shared classes instead. */}
              <Link href="/dashboard/flows" className={cn(buttonVariants())}>
                <Plus size={16} />
                New flow
              </Link>
            </>
          }
        />

        {/* Filters */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {RANGE_OPTIONS.map((r) => (
            <Link key={r.key} href={qs({ range: r.key })} className={chip(rangeKey === r.key)}>
              {r.label}
            </Link>
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          <Link href={qs({ source: "" })} className={chip(!boardSource)}>
            All sources
          </Link>
          {/* The connector's own name, not its storage key: this row read
              "gsheets · close · webhook" while every other screen in the
              product says "Google Sheets", "Close CRM", "Custom Webhook". */}
          {sources.map((srcName) => (
            <Link key={srcName} href={qs({ source: srcName })} className={chip(boardSource === srcName)}>
              {catalogEntry(srcName)?.name ?? srcName}
            </Link>
          ))}
        </div>

        {loadError && (
          <div className="mt-6 rounded-card border border-warn-soft bg-warn-soft/50 p-4 text-base text-warn-ink">
            Some dashboard data could not be loaded ({loadError}). Refresh to retry — your data is intact.
          </div>
        )}

        {/* Metric tiles: materialized flow outputs + legacy metrics. The
            checklist renders only when the empty state is REAL — behind a
            load error the honest message is the banner above, never a
            "get started" card implying the workspace is empty. */}
        {!hasTiles && !loadError ? (
          <OnboardingChecklist hasConnection={connCount > 0} hasFlow={flowCount > 0} hasPublished={flowTiles.length > 0} />
        ) : !hasTiles ? null : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {flowTiles.map((row) => (
              <FlowTile key={`${row.flowId}:${row.outputNodeId}`} row={row} rangeKey={rangeKey} />
            ))}
            {tiles.map((tile) => (
              <MetricTile key={tile.metric.id} tile={tile} />
            ))}
          </div>
        )}

        {/* Condensed workspace activity */}
        <section className="mt-12">
          <div className="mb-3 flex items-center justify-between">
            <SectionHeading className="mb-0">Recent activity</SectionHeading>
            <span className="text-tiny text-muted-foreground">
              {connCount} connection{connCount === 1 ? "" : "s"} ·{" "}
              {dlqByConnection.length > 0 ? (
                // Each count links to the connection page that hosts the
                // Replay button — a red number with no door was the old shape.
                dlqByConnection.map((d, i) => (
                  <span key={d.connectionId}>
                    {i > 0 && ", "}
                    <Link href={`/connections/${d.connectionId}`} className="text-danger-ink hover:underline">
                      {d.count} in dead-letter on {d.name}
                    </Link>
                  </span>
                ))
              ) : (
                "no failures"
              )}
            </span>
          </div>
          {recentEvents.length === 0 ? (
            <Card variant="card" padding="compact" className="text-base text-muted-foreground">
              No events ingested yet. <Link href="/integrations" className="text-primary hover:underline">Connect a source</Link>.
            </Card>
          ) : (
            <TableShell>
              <Table>
                <THead>
                  <tr>
                    <TH>Source</TH>
                    <TH>Type</TH>
                    <TH>Subject</TH>
                    <TH>Occurred</TH>
                  </tr>
                </THead>
                <TBody>
                  {/* Humanised the way the builder's own pickers do it —
                      "Close CRM · Lead created", not "close · lead_created".
                      The raw type rides along in the title attribute, because
                      it IS what a Filter step matches on. */}
                  {recentEvents.map((e) => (
                    <TR key={e.id} static>
                      <TD>{catalogEntry(e.source)?.name ?? e.source}</TD>
                      <TD title={e.eventType}>{eventTypeLabel(e.source, e.eventType)}</TD>
                      <TD>{e.subject ?? "—"}</TD>
                      <TD className="text-muted-foreground">{formatDateTime(new Date(e.occurredAt))}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableShell>
          )}
        </section>
      </PageContainer>
    </AppShell>
  );
}

function MetricTile({ tile }: { tile: Tile }) {
  const { metric } = tile;
  return (
    <Card variant="card" className="lift">
      <div className="flex items-start justify-between">
        <h3 className="text-base font-semibold text-foreground">{metric.name}</h3>
        {tile.kind === "aggregate" && (
          <Link href={`/dashboard/metrics/${metric.id}`} className="text-tiny text-primary hover:underline">
            Drill in
          </Link>
        )}
      </div>

      {tile.kind === "error" && <p className="mt-3 text-base text-warn-ink">{tile.error}</p>}

      {tile.kind === "aggregate" && tile.result.kind === "scalar" && (
        <>
          {/* Through the same formatter the flow tiles use. A legacy metric
              printed its raw number, so one board could show "1234.5" beside
              a flow tile reading "1,234.5" — the same quantity, two
              renderings, side by side. A legacy metric stores no precision,
              so an integer keeps none and a real decimal keeps two rather
              than losing its fraction on the way to the tile. */}
          <p className="tnum mt-2 text-stat font-semibold">
            {formatMetricValue(tile.result.value, { format: "number", precision: Number.isInteger(tile.result.value) ? 0 : 2 })}
            {metric.unit && <span className="ml-2 text-base font-normal text-muted-foreground">{metric.unit}</span>}
          </p>
          {metric.target != null && (
            <TargetBar
              value={tile.result.value}
              target={Number(metric.target)}
              format={{ format: "number", precision: Number.isInteger(Number(metric.target)) ? 0 : 2 }}
            />
          )}
        </>
      )}

      {tile.kind === "aggregate" && tile.result.kind === "series" && <SeriesTile series={tile.result.series} />}

      {tile.kind === "funnel" && (
        <div className="mt-3">
          <FunnelView result={tile.result} />
        </div>
      )}
    </Card>
  );
}

function SeriesTile({ series }: { series: Array<{ bucket: string; value: number }> }) {
  // The headline is a sum over the window, through the same formatter as
  // everywhere else — it can reach the thousands where a raw print loses its
  // separators. A legacy metric stores no precision, so tooltips keep up to
  // two decimals rather than silently rounding a real decimal away.
  const total = series.reduce((a, b) => a + b.value, 0);
  return (
    <Sparkbars
      series={series}
      label={formatMetricValue(total, { format: "number", precision: Number.isInteger(total) ? 0 : 2 })}
      format={{ format: "number", precision: 2 }}
    />
  );
}
