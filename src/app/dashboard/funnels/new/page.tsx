import { requireOrg } from "@/lib/auth";
import { catalogEntry, eventTypeOptions } from "@/connectors/catalog";
import { AppShell } from "@/components/app-shell";
import { getDb } from "@/db/client";
import { computeFunnel, distinctSources, distinctEventTypes } from "@/lib/metrics/compute";
import { FunnelSchema } from "@/lib/metrics/types";
import { resolveRange } from "@/lib/metrics/range";
import { createFunnelMetricAction } from "@/app/dashboard/metrics/actions";
import { FunnelView } from "@/components/funnel-view";
import { PageContainer, PageHeader, SectionHeading } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : (v ?? ""));
const STAGES = [0, 1, 2, 3];

// The stage grid is placeholder-labelled, so the column meaning lives here.
const STAGE_COLUMNS = ["Stage name", "Event", "Source"];

export default async function NewFunnelPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { orgId, userId, auth } = await requireOrg();

  const [sources, eventTypes] = await Promise.all([
    distinctSources(getDb(), orgId).catch(() => []),
    distinctEventTypes(getDb(), orgId, null).catch(() => []),
  ]);

  const stages = STAGES.map((i) => ({
    label: one(sp[`stage${i}_label`]),
    source: one(sp[`stage${i}_source`]) || null,
    eventType: one(sp[`stage${i}_eventType`]),
  })).filter((s) => s.label && s.eventType);

  const previewed = stages.length >= 2;
  let funnel: Awaited<ReturnType<typeof computeFunnel>> | null = null;
  let previewError: string | null = null;
  if (previewed) {
    try {
      const def = FunnelSchema.parse({
        kind: "funnel",
        stages: stages.map((s) => ({ ...s, filters: { combinator: "and", rules: [] } })),
      });
      funnel = await computeFunnel(getDb(), orgId, def, resolveRange("90d").range);
    } catch (err) {
      previewError = err instanceof Error ? err.message : String(err);
    }
  }

  const hiddenKeys = ["name", ...STAGES.flatMap((i) => [`stage${i}_label`, `stage${i}_source`, `stage${i}_eventType`])];

  return (
    <AppShell userId={userId} orgId={orgId} userEmail={auth.user.email}>
      <PageContainer width="narrow">
        <PageHeader
          back={{ href: "/dashboard", label: "Dashboard" }}
          title="New funnel"
          lede="Order the stages a lead moves through. We count distinct people reaching each stage and surface the biggest drop-off."
        />
        {one(sp.error) === "need_two_stages" && (
          <p className="mt-4 rounded-card border border-warn-soft bg-warn-soft/50 p-4 text-sm text-warn-ink">
            A funnel needs at least two stages.
          </p>
        )}

        <Card variant="surface" className="mt-8">
          <form method="get" className="space-y-4">
            <div>
              <FieldLabel htmlFor="funnel-name">Funnel name</FieldLabel>
              <Input
                id="funnel-name"
                name="name"
                defaultValue={one(sp.name)}
                placeholder="SMS → Booked → Showed"
              />
            </div>
            <div className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-3">
                {STAGE_COLUMNS.map((col) => (
                  <span key={col} className="text-xs font-medium text-muted-foreground">
                    {col}
                  </span>
                ))}
              </div>
              {STAGES.map((i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-3">
                  <Input
                    name={`stage${i}_label`}
                    defaultValue={one(sp[`stage${i}_label`])}
                    placeholder={`Stage ${i + 1} name`}
                    className="h-8 px-2 text-sm"
                  />
                  <NativeSelect
                    name={`stage${i}_eventType`}
                    defaultValue={one(sp[`stage${i}_eventType`])}
                    className="[&_select]:h-8 [&_select]:pl-2 [&_select]:pr-7 [&_select]:text-sm"
                  >
                    <option value="">event type…</option>
                    {/* Bound to the stage's chosen source when one is picked —
                        per-source labels are exact; unbound they fall back to the
                        neutral humanizer on any cross-source disagreement. */}
                    {eventTypeOptions(one(sp[`stage${i}_source`]) || null, eventTypes, one(sp[`stage${i}_eventType`]) || null).map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </NativeSelect>
                  <NativeSelect
                    name={`stage${i}_source`}
                    defaultValue={one(sp[`stage${i}_source`])}
                    className="[&_select]:h-8 [&_select]:pl-2 [&_select]:pr-7 [&_select]:text-sm"
                  >
                    <option value="">any source</option>
                    {sources.map((srcName) => (
                      <option key={srcName} value={srcName}>
                        {catalogEntry(srcName)?.name ?? srcName}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              ))}
            </div>
            <Button variant="secondary">Preview</Button>
          </form>
        </Card>

        {previewed && (
          <section className="mt-8">
            <Card variant="surface">
              <SectionHeading>Live preview (last 90 days)</SectionHeading>
              {previewError ? (
                <p className="rounded-card border border-warn-soft bg-warn-soft/50 p-4 text-sm text-warn-ink">
                  {previewError}
                </p>
              ) : (
                funnel && (
                  <>
                    <FunnelView result={funnel} />
                    <form action={createFunnelMetricAction} className="mt-5">
                      {hiddenKeys.map((k) => (
                        <input key={k} type="hidden" name={k} value={one(sp[k])} />
                      ))}
                      <Button>Save funnel</Button>
                    </form>
                  </>
                )
              )}
            </Card>
          </section>
        )}
      </PageContainer>
    </AppShell>
  );
}
