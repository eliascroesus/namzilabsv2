import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { FunnelView } from "@/components/funnel-view";
import { getDb } from "@/db/client";
import { getMetric } from "@/lib/metrics/store";
import { parseDefinition } from "@/lib/metrics/types";
import { computeAggregate, computeFunnel, queryEvents } from "@/lib/metrics/compute";
import { resolveRange } from "@/lib/metrics/range";
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
  const { orgId, userId, auth } = await requireOrg();

  const metric = await getMetric(orgId, id);
  if (!metric) notFound();

  const { range } = resolveRange(one(sp.range) || "30d");
  const def = parseDefinition(metric.definition);

  let headline = "";
  let rows: Awaited<ReturnType<typeof queryEvents>> = [];
  let funnel: Awaited<ReturnType<typeof computeFunnel>> | null = null;
  let error: string | null = null;

  try {
    if (def.kind === "aggregate") {
      const res = await computeAggregate(getDb(), orgId, def, range);
      headline = String(res.kind === "scalar" ? res.value : res.series.reduce((a, b) => a + b.value, 0));
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
      <main className="mx-auto max-w-4xl px-6 py-10">
        <Link href="/dashboard" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Dashboard
        </Link>
        <div className="mt-3 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{metric.name}</h1>
            <p className="text-sm text-neutral-500">
              {def.kind === "aggregate" ? "Metric" : "Funnel"} · last 30 days
            </p>
          </div>
          <form action={deleteMetricAction}>
            <input type="hidden" name="id" value={metric.id} />
            <button className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50">
              Delete
            </button>
          </form>
        </div>

        {error && (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{error}</p>
        )}

        {def.kind === "aggregate" && (
          <>
            <p className="mt-6 text-5xl font-semibold">
              {headline}
              {metric.unit && <span className="ml-2 text-lg font-normal text-neutral-500">{metric.unit}</span>}
            </p>
            <h2 className="mt-8 mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Underlying events ({rows.length})
            </h2>
            {rows.length === 0 ? (
              <p className="rounded-md border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-500">
                No matching events in this window.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-neutral-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Source</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Subject</th>
                      <th className="px-3 py-2 font-medium">Value</th>
                      <th className="px-3 py-2 font-medium">Occurred</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((e) => (
                      <tr key={e.id} className="border-t border-neutral-100">
                        <td className="px-3 py-2">{e.source}</td>
                        <td className="px-3 py-2">{e.eventType}</td>
                        <td className="px-3 py-2 text-neutral-700">{e.subject ?? "—"}</td>
                        <td className="px-3 py-2 text-neutral-700">{e.value ?? "—"}</td>
                        <td className="px-3 py-2 text-neutral-500">{new Date(e.occurredAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {def.kind === "funnel" && funnel && (
          <div className="mt-6">
            <FunnelView result={funnel} />
          </div>
        )}
      </main>
    </AppShell>
  );
}
