"use server";

import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { createMetric, deleteMetric } from "@/lib/metrics/store";
import { MetricDefinitionSchema } from "@/lib/metrics/types";

function s(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}
function numOrNull(v: string): number | null {
  return v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
}

/** Create an aggregate metric (count / sum / distinct, optional filters + trend). */
export async function createAggregateMetricAction(fd: FormData): Promise<void> {
  const { orgId } = await requireOrg();

  const rules: Array<{ field: string; op: string; value: string }> = [];
  for (let i = 0; i < 2; i++) {
    const field = s(fd, `filter${i}_field`);
    const op = s(fd, `filter${i}_op`);
    if (field && op) rules.push({ field, op, value: s(fd, `filter${i}_value`) });
  }
  const timeBucket = ["day", "week", "month"].includes(s(fd, "timeBucket")) ? s(fd, "timeBucket") : null;

  const definition = MetricDefinitionSchema.parse({
    kind: "aggregate",
    source: s(fd, "source") || null,
    eventType: s(fd, "eventType") || null,
    aggregation: ["count", "sum", "count_distinct"].includes(s(fd, "aggregation")) ? s(fd, "aggregation") : "count",
    valueField: s(fd, "valueField") || "value",
    distinctField: s(fd, "distinctField") || "subject",
    timeBucket,
    filters: { combinator: s(fd, "combinator") === "or" ? "or" : "and", rules },
  });

  await createMetric(orgId, {
    name: s(fd, "name") || "Untitled metric",
    display: timeBucket ? "trend" : "number",
    unit: s(fd, "unit") || null,
    target: numOrNull(s(fd, "target")),
    definition,
  });
  redirect("/dashboard");
}

/** Create a funnel metric from ordered stages. */
export async function createFunnelMetricAction(fd: FormData): Promise<void> {
  const { orgId } = await requireOrg();

  const stages: Array<{ label: string; eventType: string; source: string | null; filters: unknown }> = [];
  for (let i = 0; i < 6; i++) {
    const label = s(fd, `stage${i}_label`);
    const eventType = s(fd, `stage${i}_eventType`);
    if (!label || !eventType) continue;
    stages.push({ label, eventType, source: s(fd, `stage${i}_source`) || null, filters: { combinator: "and", rules: [] } });
  }
  if (stages.length < 2) {
    redirect("/dashboard/funnels/new?error=need_two_stages");
  }

  const definition = MetricDefinitionSchema.parse({ kind: "funnel", stages });
  await createMetric(orgId, { name: s(fd, "name") || "Funnel", display: "funnel", definition });
  redirect("/dashboard");
}

export async function deleteMetricAction(fd: FormData): Promise<void> {
  const { orgId } = await requireOrg();
  const id = s(fd, "id");
  if (id) await deleteMetric(orgId, id);
  redirect("/dashboard");
}
