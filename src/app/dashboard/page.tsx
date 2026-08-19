import Link from "next/link";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getReadDb } from "@/db/client";
import { connections, events, flows } from "@/db/schema";
import { unresolvedDeadLetterCountsByConnection } from "@/lib/dead-letter";
import { requireOrg } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
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
  const { orgId, userId, auth } = await requireOrg();
  const db = getReadDb(); // read-only surface: rides the DB_DRIVER_READ soak seam (B.3)

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
    const rows = await publishedFlowTiles(db, orgId);

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

  return (
    <AppShell userId={userId} orgId={orgId} userEmail={auth.user.email}>
      {/* G.4: refresh the server-rendered tiles when the org's results move. */}
      <FreshnessPoller />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <div className="flex gap-2">
            {/* Every tile at once. The per-tile Refresh recomputes one flow,
                which is the wrong unit when you have just changed something
                upstream and want the whole board to agree with reality. */}
            <form action={refreshAllFlowsAction}>
              <button
                type="submit"
                className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
                title="Recompute every published metric now"
              >
                Refresh
              </button>
            </form>
            {/* ONE way to build a metric. The retired form builder was still
                advertised here as "Classic metric", and "classic" reads as
                "the stable one" — so a first-time user took it, produced a
                `metrics` row instead of a flow, and never saw the canvas.
                The routes stay alive so existing metrics still open and edit
                (their tiles link to them); they are simply no longer a door
                anyone walks through by accident. */}
            <Link href="/dashboard/flows" className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800">
              New flow
            </Link>
          </div>
        </div>

        {/* Filters */}
        <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
          {RANGE_OPTIONS.map((r) => (
            <Link
              key={r.key}
              href={qs({ range: r.key })}
              className={`rounded-full px-3 py-1 ${rangeKey === r.key ? "bg-neutral-900 text-white" : "border border-neutral-300 hover:bg-neutral-50"}`}
            >
              {r.label}
            </Link>
          ))}
          <span className="mx-1 h-4 w-px bg-neutral-200" />
          <Link href={qs({ source: "" })} className={`rounded-full px-3 py-1 ${!boardSource ? "bg-neutral-900 text-white" : "border border-neutral-300 hover:bg-neutral-50"}`}>
            All sources
          </Link>
          {/* The connector's own name, not its storage key: this row read
              "gsheets · close · webhook" while every other screen in the
              product says "Google Sheets", "Close CRM", "Custom Webhook". */}
          {sources.map((srcName) => (
            <Link
              key={srcName}
              href={qs({ source: srcName })}
              className={`rounded-full px-3 py-1 ${boardSource === srcName ? "bg-neutral-900 text-white" : "border border-neutral-300 hover:bg-neutral-50"}`}
            >
              {catalogEntry(srcName)?.name ?? srcName}
            </Link>
          ))}
        </div>

        {loadError && (
          <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
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
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Recent activity</h2>
            <span className="text-xs text-neutral-500">
              {connCount} connection{connCount === 1 ? "" : "s"} ·{" "}
              {dlqByConnection.length > 0 ? (
                // Each count links to the connection page that hosts the
                // Replay button — a red number with no door was the old shape.
                dlqByConnection.map((d, i) => (
                  <span key={d.connectionId}>
                    {i > 0 && ", "}
                    <Link href={`/connections/${d.connectionId}`} className="text-red-600 hover:underline">
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
            <p className="rounded-md border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-500">
              No events ingested yet. <Link href="/integrations" className="text-blue-600 hover:underline">Connect a source</Link>.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-neutral-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
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
                    <tr key={e.id} className="border-t border-neutral-100">
                      <td className="px-3 py-2">{catalogEntry(e.source)?.name ?? e.source}</td>
                      <td className="px-3 py-2" title={e.eventType}>{eventTypeLabel(e.source, e.eventType)}</td>
                      <td className="px-3 py-2 text-neutral-700">{e.subject ?? "—"}</td>
                      <td className="px-3 py-2 text-neutral-500">{new Date(e.occurredAt).toLocaleString()}</td>
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
    <div className="rounded-lg border border-neutral-200 p-5">
      <div className="flex items-start justify-between">
        <h3 className="font-medium text-neutral-800">{metric.name}</h3>
        {tile.kind === "aggregate" && (
          <Link href={`/dashboard/metrics/${metric.id}`} className="text-xs text-blue-600 hover:underline">
            Drill in →
          </Link>
        )}
      </div>

      {tile.kind === "error" && <p className="mt-3 text-sm text-amber-700">{tile.error}</p>}

      {tile.kind === "aggregate" && tile.result.kind === "scalar" && (
        <>
          {/* Through the same formatter the flow tiles use. A legacy metric
              printed its raw number, so one board could show "1234.5" beside
              a flow tile reading "1,234.5" — the same quantity, two
              renderings, side by side. A legacy metric stores no precision,
              so an integer keeps none and a real decimal keeps two rather
              than being silently rounded away. */}
          <p className="mt-2 text-4xl font-semibold">
            {formatMetricValue(tile.result.value, { format: "number", precision: Number.isInteger(tile.result.value) ? 0 : 2 })}
            {metric.unit && <span className="ml-2 text-base font-normal text-neutral-500">{metric.unit}</span>}
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
      <div className="mb-1 flex justify-between text-xs text-neutral-500">
        <span>Goal: {target}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded bg-neutral-100">
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
      <p className="mt-2 text-2xl font-semibold">{formatMetricValue(total, { format: "number", precision: Number.isInteger(total) ? 0 : 2 })}</p>
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
