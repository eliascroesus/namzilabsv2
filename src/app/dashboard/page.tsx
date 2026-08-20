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
import { formatMetricValue } from "@/lib/format";
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

  // One voice for every filter chip on the page. Selected is the kit's accent
  // — the old black pill was the only black element on a violet-accented app,
  // so "selected" and "primary" disagreed about what the brand colour is.
  const chipOn = "rounded-full px-3 py-1 text-small font-medium bg-primary text-primary-foreground";
  const chipOff = "rounded-full px-3 py-1 text-small font-medium border border-border bg-card text-foreground hover:bg-muted";

  return (
    <AppShell userId={userId} orgId={orgId} userEmail={auth.user.email}>
      {/* G.4: refresh the server-rendered tiles when the org's results move. */}
      <FreshnessPoller />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-display font-semibold tracking-tight text-foreground">Dashboard</h1>
          <div className="flex gap-2">
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
            <Link href="/dashboard/flows" className={buttonVariants()}>
              <Plus size={16} strokeWidth={2.4} />
              New flow
            </Link>
          </div>
        </div>

        {/* Filters */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {RANGE_OPTIONS.map((r) => (
            <Link key={r.key} href={qs({ range: r.key })} className={rangeKey === r.key ? chipOn : chipOff}>
              {r.label}
            </Link>
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          <Link href={qs({ source: "" })} className={!boardSource ? chipOn : chipOff}>
            All sources
          </Link>
          {/* The connector's own name, not its storage key: this row read
              "gsheets · close · webhook" while every other screen in the
              product says "Google Sheets", "Close CRM", "Custom Webhook". */}
          {sources.map((srcName) => (
            <Link key={srcName} href={qs({ source: srcName })} className={boardSource === srcName ? chipOn : chipOff}>
              {catalogEntry(srcName)?.name ?? srcName}
            </Link>
          ))}
        </div>

        {loadError && (
          <div className="mt-6 rounded-card border border-amber-300 bg-amber-50 p-4 text-base text-amber-800">
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
            <h2 className="text-micro font-semibold uppercase tracking-wide text-neutral-400">Recent activity</h2>
            <span className="text-tiny text-muted-foreground">
              {connCount} connection{connCount === 1 ? "" : "s"} ·{" "}
              {dlqByConnection.length > 0 ? (
                // Each count links to the connection page that hosts the
                // Replay button — a red number with no door was the old shape.
                dlqByConnection.map((d, i) => (
                  <span key={d.connectionId}>
                    {i > 0 && ", "}
                    <Link href={`/connections/${d.connectionId}`} className="text-destructive hover:underline">
                      {d.count} in dead-letter on {d.name} →
                    </Link>
                  </span>
                ))
              ) : (
                "no failures"
              )}
            </span>
          </div>
          {recentEvents.length === 0 ? (
            <p className="rounded-card border border-border bg-neutral-50 p-4 text-base text-muted-foreground">
              No events ingested yet. <Link href="/integrations" className="text-primary hover:underline">Connect a source</Link>.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-card border border-border bg-card shadow-card">
              <table className="w-full text-left text-base">
                <thead className="bg-neutral-50 text-micro uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Source</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Subject</th>
                    <th className="px-3 py-2 font-medium">Occurred</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Humanised the way the builder's own pickers do it —
                      "Close CRM · Lead created", not "close · lead_created".
                      The raw type rides along in the title attribute, because
                      it IS what a Filter step matches on. */}
                  {recentEvents.map((e) => (
                    <tr key={e.id} className="border-t border-border">
                      <td className="px-3 py-2">{catalogEntry(e.source)?.name ?? e.source}</td>
                      <td className="px-3 py-2" title={e.eventType}>{eventTypeLabel(e.source, e.eventType)}</td>
                      <td className="px-3 py-2 text-neutral-700">{e.subject ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{new Date(e.occurredAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </AppShell>
  );
}

function MetricTile({ tile }: { tile: Tile }) {
  const { metric } = tile;
  return (
    <div className="rounded-card border border-border bg-card p-5 shadow-card">
      <div className="flex items-start justify-between">
        <h3 className="text-base font-semibold text-foreground">{metric.name}</h3>
        {tile.kind === "aggregate" && (
          <Link href={`/dashboard/metrics/${metric.id}`} className="text-tiny text-primary hover:underline">
            Drill in →
          </Link>
        )}
      </div>

      {tile.kind === "error" && <p className="mt-3 text-base text-amber-700">{tile.error}</p>}

      {tile.kind === "aggregate" && tile.result.kind === "scalar" && (
        <>
          {/* Through the same formatter the flow tiles use. A legacy metric
              printed its raw number, so one board could show "1234.5" beside
              a flow tile reading "1,234.5" — the same quantity, two
              renderings, side by side. A legacy metric stores no precision,
              so an integer keeps none and a real decimal keeps two rather
              than being silently rounded away. */}
          <p className="tnum mt-2 text-stat font-semibold">
            {formatMetricValue(tile.result.value, { format: "number", precision: Number.isInteger(tile.result.value) ? 0 : 2 })}
            {metric.unit && <span className="ml-2 text-base font-normal text-muted-foreground">{metric.unit}</span>}
          </p>
          {metric.target != null && <TargetBar value={tile.result.value} target={Number(metric.target)} />}
        </>
      )}

      {tile.kind === "aggregate" && tile.result.kind === "series" && <Sparkbars series={tile.result.series} />}

      {tile.kind === "funnel" && (
        <div className="mt-3">
          <FunnelView result={tile.result} />
        </div>
      )}
    </div>
  );
}

function TargetBar({ value, target }: { value: number; target: number }) {
  const pct = target > 0 ? Math.min(Math.round((value / target) * 100), 100) : 0;
  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-tiny text-muted-foreground">
        <span className="tnum">Goal: {target}</span>
        <span className="tnum">{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded bg-muted">
        <div className={`h-full ${pct >= 100 ? "bg-green-500" : "bg-neutral-800"}`} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
    </div>
  );
}

function Sparkbars({ series }: { series: Array<{ bucket: string; value: number }> }) {
  const max = Math.max(1, ...series.map((s) => s.value));
  const total = series.reduce((a, b) => a + b.value, 0);
  return (
    <>
      {/* Same formatter as everywhere else — this headline is a sum, so it can
          reach the thousands where the raw print loses its separators. */}
      <p className="tnum mt-2 text-display font-semibold">{formatMetricValue(total, { format: "number", precision: Number.isInteger(total) ? 0 : 2 })}</p>
      <div className="mt-3 flex h-16 items-end gap-1">
        {series.map((s) => (
          <div
            key={s.bucket}
            title={`${s.bucket}: ${s.value}`}
            className="flex-1 rounded-t bg-neutral-800"
            style={{ height: `${Math.max((s.value / max) * 100, 4)}%` }}
          />
        ))}
      </div>
    </>
  );
}
