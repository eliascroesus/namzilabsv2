import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { catalogEntry, eventTypeLabel, eventTypeOptions } from "@/connectors/catalog";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldLabel } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { PageContainer, PageHeader, SectionHeading } from "@/components/ui/page";
import { formatDateTime, formatMetricValue } from "@/lib/format";
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
    <AppShell userId={userId} orgId={orgId} userEmail={auth.user.email}>
      <PageContainer width="narrow">
        <PageHeader
          back={{ href: "/dashboard", label: "Dashboard" }}
          title="New metric"
          lede="Pick what to measure. Preview updates with your live data; save when it looks right."
          actions={
            <Link href="/dashboard/funnels/new" className="text-base text-primary hover:underline">
              Build a funnel instead
            </Link>
          }
        />

        {/* Builder: GET form updates the live preview */}
        <Card variant="surface" padding="default" className="mt-8">
          <form method="get" className="space-y-4">
            <Row htmlFor="name" label="Name">
              <Input id="name" name="name" defaultValue={one(sp.name)} placeholder="Booked leads this week" />
            </Row>
            <div className="grid gap-4 sm:grid-cols-2">
              <Row htmlFor="source" label="Source">
                {/* Storage keys stay the VALUES (the definition matches on
                    them); only the reading is humanized, exactly as the
                    event-type select and the sample list below already do. */}
                <Select
                  name="source"
                  value={one(sp.source)}
                  options={["", ...sources]}
                  labels={{
                    "": "All sources",
                    ...Object.fromEntries(sources.map((s) => [s, catalogEntry(s)?.name ?? s])),
                  }}
                />
              </Row>
              <Row htmlFor="eventType" label="Event type">
                {/* Values stay the stored strings (the definition matches them
                    with `=`); eventTypeOptions curates: hidden noise dropped,
                    a saved value kept, labels humanized, sorted by label. */}
                {(() => {
                  const opts = eventTypeOptions(one(sp.source) || null, eventTypes, one(sp.eventType) || null);
                  return (
                    <Select
                      name="eventType"
                      value={one(sp.eventType)}
                      options={["", ...opts.map((o) => o.value)]}
                      labels={{ "": "Any", ...Object.fromEntries(opts.map((o) => [o.value, o.label])) }}
                    />
                  );
                })()}
              </Row>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Row htmlFor="aggregation" label="Aggregation">
                <Select name="aggregation" value={one(sp.aggregation) || "count"}
                  options={["count", "sum", "count_distinct"]}
                  labels={{ count: "Count", sum: "Sum of value", count_distinct: "Count distinct" }} />
              </Row>
              <Row htmlFor="timeBucket" label="Trend by">
                <Select name="timeBucket" value={one(sp.timeBucket)} options={["", "day", "week", "month"]}
                  labels={{ "": "No trend (single number)", day: "Day", week: "Week", month: "Month" }} />
              </Row>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Row htmlFor="valueField" label="Sum field (for Sum)">
                <Input id="valueField" name="valueField" defaultValue={one(sp.valueField) || "value"} />
              </Row>
              <Row htmlFor="distinctField" label="Distinct field (for Count distinct)">
                <Input id="distinctField" name="distinctField" defaultValue={one(sp.distinctField) || "subject"} />
              </Row>
            </div>

            <fieldset className="rounded-card border border-border p-3">
              <legend className="px-1 text-tiny font-medium text-muted-foreground">Filters (optional)</legend>
              <Row htmlFor="combinator" label="Combine with">
                <Select name="combinator" value={one(sp.combinator) || "and"} options={["and", "or"]}
                  labels={{ and: "AND", or: "OR" }} />
              </Row>
              {[0, 1].map((i) => (
                <div key={i} className="mt-2 grid gap-2 sm:grid-cols-3">
                  <Input name={`filter${i}_field`} defaultValue={one(sp[`filter${i}_field`])}
                    placeholder="field (e.g. subject or properties.plan)" className="h-8 px-2 text-small" />
                  <Select name={`filter${i}_op`} value={one(sp[`filter${i}_op`])} options={["", ...FILTER_OPS]} labels={{ "": "op" }} />
                  <Input name={`filter${i}_value`} defaultValue={one(sp[`filter${i}_value`])} placeholder="value"
                    className="h-8 px-2 text-small" />
                </div>
              ))}
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <Row htmlFor="unit" label="Unit (optional)">
                <Input id="unit" name="unit" defaultValue={one(sp.unit)} placeholder="leads" />
              </Row>
              <Row htmlFor="target" label="Goal / target (optional)">
                <Input id="target" name="target" type="number" defaultValue={one(sp.target)} placeholder="100" />
              </Row>
            </div>

            <Button type="submit" variant="secondary">
              Preview
            </Button>
          </form>
        </Card>

        {/* Live preview + Save */}
        {previewed && (
          <Card variant="surface" padding="default" className="mt-6">
            <SectionHeading>Live preview (last 90 days)</SectionHeading>
            {previewError ? (
              <p className="rounded-card border border-warn-soft bg-warn-soft/50 p-4 text-base text-warn-ink">
                {previewError}
              </p>
            ) : (
              <>
                {/* Same formatter and recipe as the dashboard tile this metric
                    will become — the preview must not print "1234.5" for a
                    number the board will render as "1,234.5". */}
                <p className="stat-numeral text-stat">
                  {formatMetricValue(previewValue, { format: "number", precision: Number.isInteger(previewValue) ? 0 : 2 })}
                  {one(sp.unit) && <span className="ml-2 text-base font-normal text-muted-foreground">{one(sp.unit)}</span>}
                </p>
                <p className="mt-4 text-tiny font-medium uppercase tracking-wide text-muted-foreground">
                  Latest matching records
                </p>
                {sample.length === 0 ? (
                  <p className="mt-1 text-base text-muted-foreground">No matching records yet.</p>
                ) : (
                  <ul className="mt-1 divide-y divide-border text-base">
                    {sample.map((e) => (
                      <li key={e.eventId} className="flex justify-between py-1.5">
                        <span title={e.eventType}>
                          {catalogEntry(e.source)?.name ?? e.source} · {eventTypeLabel(e.source, e.eventType)}
                          {e.subject ? ` · ${e.subject}` : ""}
                        </span>
                        <span className="text-muted-foreground">{formatDateTime(new Date(e.occurredAt))}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <form action={createAggregateMetricAction} className="mt-5">
                  {hiddenKeys.map((k) => (
                    <input key={k} type="hidden" name={k} value={one(sp[k])} />
                  ))}
                  <Button type="submit">Save metric</Button>
                </form>
              </>
            )}
          </Card>
        )}
      </PageContainer>
    </AppShell>
  );
}

/**
 * A labelled field. `htmlFor` is the control's `name`, which is unique per
 * form — so the pair cannot drift, and `Select` below derives its own `id`
 * from the same string rather than being told twice.
 *
 * It matters that this is a real association and not just text above a box:
 * this helper used to be a `<label>` WRAPPING its control, which labelled it
 * implicitly. Splitting the label out to style it lost that, and a select
 * with no accessible name is announced as an unnamed combo box.
 */
function Row({ htmlFor, label, children }: { htmlFor: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      {children}
    </div>
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
    <NativeSelect id={name} name={name} defaultValue={value}>
      {options.map((o) => (
        <option key={o} value={o}>
          {labels[o] ?? o}
        </option>
      ))}
    </NativeSelect>
  );
}
