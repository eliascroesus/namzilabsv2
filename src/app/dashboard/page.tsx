import Link from "next/link";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { connections, deadLetter, events, flowResults, flows } from "@/db/schema";
import { requireOrg } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { FunnelView } from "@/components/funnel-view";
import { FlowTile, type FlowResultRow } from "@/components/flow-tile";
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

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : (v ?? ""));

type Tile =
  | { metric: Metric; kind: "aggregate"; result: AggregateResult; error?: undefined }
  | { metric: Metric; kind: "funnel"; result: FunnelResult; error?: undefined }
  | { metric: Metric; kind: "error"; error: string };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { orgId, userId, auth } = await requireOrg();
  const db = getDb();

  const rangeKey = one(sp.range) || "7d";
  const { range } = resolveRange(rangeKey);
  const boardSource = one(sp.source) || null;

  let metrics: Metric[] = [];
  let sources: string[] = [];
  let recentEvents: (typeof events.$inferSelect)[] = [];
  let dlqCount = 0;
  let connCount = 0;
  let loadError: string | null = null;

  try {
    [metrics, sources, recentEvents, dlqCount, connCount] = await Promise.all([
      listMetrics(orgId),
      distinctSources(db, orgId),
      db.select().from(events).where(eq(events.orgId, orgId)).orderBy(desc(events.receivedAt)).limit(6),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(deadLetter)
        .where(and(eq(deadLetter.orgId, orgId), isNull(deadLetter.resolvedAt)))
        .then((r) => Number(r[0]?.c ?? 0)),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(connections)
        .where(eq(connections.orgId, orgId))
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
    flowTiles = await db
      .select({
        flowId: flowResults.flowId,
        outputNodeId: flowResults.outputNodeId,
        tile: flowResults.tile,
        status: flowResults.status,
        computedAt: flowResults.computedAt,
      })
      .from(flowResults)
      // Only render results for flows that are still published (guards orphans).
      .innerJoin(flows, eq(flows.id, flowResults.flowId))
      .where(and(eq(flowResults.orgId, orgId), eq(flows.status, "published")));
  } catch {
    // flow_results may not exist before migration 0002 is applied; ignore.
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
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <div className="flex gap-2">
            <Link href="/dashboard/flows" className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800">
              New flow
            </Link>
            <Link href="/dashboard/metrics/new" className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50">
              Classic metric
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
          {sources.map((srcName) => (
            <Link
              key={srcName}
              href={qs({ source: srcName })}
              className={`rounded-full px-3 py-1 ${boardSource === srcName ? "bg-neutral-900 text-white" : "border border-neutral-300 hover:bg-neutral-50"}`}
            >
              {srcName}
            </Link>
          ))}
        </div>

        {loadError && (
          <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
            Database not reachable ({loadError}). Set <code>DATABASE_URL</code> to view live data.
          </div>
        )}

        {/* Metric tiles: materialized flow outputs + legacy metrics */}
        {!hasTiles ? (
          <div className="mt-8 rounded-lg border border-dashed border-neutral-300 p-10 text-center">
            <p className="text-neutral-600">No metrics yet.</p>
            <p className="mt-1 text-sm text-neutral-500">
              {connCount === 0 ? (
                <>
                  First,{" "}
                  <Link href="/integrations" className="text-blue-600 hover:underline">
                    connect an integration
                  </Link>
                  . Then build your first metric.
                </>
              ) : (
                <>
                  Build your first metric visually, e.g. &ldquo;Booked leads this week&rdquo;.{" "}
                  <Link href="/dashboard/flows" className="text-blue-600 hover:underline">
                    New flow
                  </Link>
                </>
              )}
            </p>
          </div>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {flowTiles.map((row) => (
              <FlowTile key={`${row.flowId}:${row.outputNodeId}`} row={row} />
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
              {dlqCount > 0 ? <span className="text-red-600">{dlqCount} in dead-letter</span> : "no failures"}
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
                  {recentEvents.map((e) => (
                    <tr key={e.id} className="border-t border-neutral-100">
                      <td className="px-3 py-2">{e.source}</td>
                      <td className="px-3 py-2">{e.eventType}</td>
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
          <p className="mt-2 text-4xl font-semibold">
            {tile.result.value}
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
      <p className="mt-2 text-2xl font-semibold">{total}</p>
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
