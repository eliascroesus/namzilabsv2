import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { AppHeader } from "@/components/app-header";
import { getDb } from "@/db/client";
import { computeAggregate, queryEvents, distinctSources, distinctEventTypes } from "@/lib/metrics/compute";
import { AggregateSchema, FILTER_OPS, type AggregateDefinition } from "@/lib/metrics/types";
import { resolveRange } from "@/lib/metrics/range";
import { createAggregateMetricAction } from "@/app/dashboard/metrics/actions";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : (v ?? ""));

function buildDefinition(sp: SP): AggregateDefinition {
  const rules = [0, 1]
    .map((i) => ({
      field: one(sp[`filter${i}_field`]),
      op: one(sp[`filter${i}_op`]),
      value: one(sp[`filter${i}_value`]),
    }))
    .filter((r) => r.field && r.op);
  return AggregateSchema.parse({
    kind: "aggregate",
    source: one(sp.source) || null,
    eventType: one(sp.eventType) || null,
    aggregation: ["count", "sum", "count_distinct"].includes(one(sp.aggregation)) ? one(sp.aggregation) : "count",
    valueField: one(sp.valueField) || "value",
    distinctField: one(sp.distinctField) || "subject",
    timeBucket: ["day", "week", "month"].includes(one(sp.timeBucket)) ? one(sp.timeBucket) : null,
    filters: { combinator: one(sp.combinator) === "or" ? "or" : "and", rules },
  });
}

export default async function NewMetricPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { orgId, userId, auth } = await requireOrg();
  const db = getDb;

  const [sources, eventTypes] = await Promise.all([
    distinctSources(db(), orgId).catch(() => []),
    distinctEventTypes(db(), orgId, one(sp.source) || null).catch(() => []),
  ]);

  const previewed = sp.aggregation !== undefined;
  const range = resolveRange("90d").range;
  let previewValue: number | null = null;
  let sample: Awaited<ReturnType<typeof queryEvents>> = [];
  let previewError: string | null = null;

  if (previewed) {
    try {
      const def = buildDefinition(sp);
      const res = await computeAggregate(db(), orgId, def, range);
      previewValue = res.kind === "scalar" ? res.value : res.series.reduce((a, b) => a + b.value, 0);
      sample = await queryEvents(db(), orgId, {
        source: def.source,
        eventType: def.eventType,
        filters: def.filters,
        range,
        limit: 3,
      });
    } catch (err) {
      previewError = err instanceof Error ? err.message : String(err);
    }
  }

  const hiddenKeys = [
    "name",
    "source",
    "eventType",
    "aggregation",
    "valueField",
    "distinctField",
    "timeBucket",
    "combinator",
    "filter0_field",
    "filter0_op",
    "filter0_value",
    "filter1_field",
    "filter1_op",
    "filter1_value",
    "unit",
    "target",
  ];

  return (
    <>
      <AppHeader userId={userId} orgId={orgId} userEmail={auth.user.email} />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link href="/dashboard" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Dashboard
        </Link>
        <div className="mt-3 flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">New metric</h1>
          <Link href="/dashboard/funnels/new" className="text-sm text-blue-600 hover:underline">
            Build a funnel instead
          </Link>
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          Pick what to measure. Preview updates with your live data; save when it looks right.
        </p>

        {/* Builder: GET form updates the live preview */}
        <form method="get" className="mt-8 space-y-4 rounded-lg border border-neutral-200 p-5">
          <Row label="Name">
            <input name="name" defaultValue={one(sp.name)} placeholder="Booked leads this week"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
          </Row>
          <div className="grid grid-cols-2 gap-4">
            <Row label="Source">
              <Select name="source" value={one(sp.source)} options={["", ...sources]} labels={{ "": "All sources" }} />
            </Row>
            <Row label="Event type">
              <Select name="eventType" value={one(sp.eventType)} options={["", ...eventTypes]} labels={{ "": "Any" }} />
            </Row>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Row label="Aggregation">
              <Select name="aggregation" value={one(sp.aggregation) || "count"}
                options={["count", "sum", "count_distinct"]}
                labels={{ count: "Count", sum: "Sum of value", count_distinct: "Count distinct" }} />
            </Row>
            <Row label="Trend by">
              <Select name="timeBucket" value={one(sp.timeBucket)} options={["", "day", "week", "month"]}
                labels={{ "": "No trend (single number)", day: "Day", week: "Week", month: "Month" }} />
            </Row>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Row label="Sum field (for Sum)">
              <input name="valueField" defaultValue={one(sp.valueField) || "value"}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
            </Row>
            <Row label="Distinct field (for Count distinct)">
              <input name="distinctField" defaultValue={one(sp.distinctField) || "subject"}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
            </Row>
          </div>

          <fieldset className="rounded-md border border-neutral-200 p-3">
            <legend className="px-1 text-xs font-medium text-neutral-500">Filters (optional)</legend>
            <Row label="Combine with">
              <Select name="combinator" value={one(sp.combinator) || "and"} options={["and", "or"]}
                labels={{ and: "AND", or: "OR" }} />
            </Row>
            {[0, 1].map((i) => (
              <div key={i} className="mt-2 grid grid-cols-3 gap-2">
                <input name={`filter${i}_field`} defaultValue={one(sp[`filter${i}_field`])} placeholder="field (e.g. subject or properties.plan)"
                  className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
                <Select name={`filter${i}_op`} value={one(sp[`filter${i}_op`])} options={["", ...FILTER_OPS]} labels={{ "": "op" }} />
                <input name={`filter${i}_value`} defaultValue={one(sp[`filter${i}_value`])} placeholder="value"
                  className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
              </div>
            ))}
          </fieldset>

          <div className="grid grid-cols-2 gap-4">
            <Row label="Unit (optional)">
              <input name="unit" defaultValue={one(sp.unit)} placeholder="leads"
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
            </Row>
            <Row label="Goal / target (optional)">
              <input name="target" type="number" defaultValue={one(sp.target)} placeholder="100"
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
            </Row>
          </div>

          <button className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50">
            Preview
          </button>
        </form>

        {/* Live preview + Save */}
        {previewed && (
          <section className="mt-6 rounded-lg border border-neutral-200 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Live preview (last 90 days)
            </h2>
            {previewError ? (
              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {previewError}
              </p>
            ) : (
              <>
                <p className="mt-2 text-4xl font-semibold">
                  {previewValue}
                  {one(sp.unit) && <span className="ml-2 text-base font-normal text-neutral-500">{one(sp.unit)}</span>}
                </p>
                <p className="mt-4 text-xs font-medium uppercase tracking-wide text-neutral-400">
                  Latest matching records
                </p>
                {sample.length === 0 ? (
                  <p className="mt-1 text-sm text-neutral-500">No matching records yet.</p>
                ) : (
                  <ul className="mt-1 divide-y divide-neutral-100 text-sm">
                    {sample.map((e) => (
                      <li key={e.eventId} className="flex justify-between py-1.5">
                        <span>
                          {e.source} · {e.eventType} {e.subject ? `· ${e.subject}` : ""}
                        </span>
                        <span className="text-neutral-400">{new Date(e.occurredAt).toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <form action={createAggregateMetricAction} className="mt-5">
                  {hiddenKeys.map((k) => (
                    <input key={k} type="hidden" name={k} value={one(sp[k])} />
                  ))}
                  <button className="rounded-md bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-800">
                    Save metric
                  </button>
                </form>
              </>
            )}
          </section>
        )}
      </main>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-neutral-600">{label}</span>
      {children}
    </label>
  );
}

function Select({
  name,
  value,
  options,
  labels = {},
}: {
  name: string;
  value: string;
  options: string[];
  labels?: Record<string, string>;
}) {
  return (
    <select name={name} defaultValue={value} className="w-full rounded-md border border-neutral-300 px-2 py-2 text-sm">
      {options.map((o) => (
        <option key={o} value={o}>
          {labels[o] ?? o}
        </option>
      ))}
    </select>
  );
}
