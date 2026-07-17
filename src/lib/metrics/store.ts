import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { metrics } from "@/db/schema";
import { MetricDefinitionSchema, type MetricDefinition } from "./types";

export type Metric = typeof metrics.$inferSelect;

export type CreateMetricInput = {
  name: string;
  display: string;
  unit?: string | null;
  target?: number | null;
  definition: MetricDefinition;
};

export async function createMetric(orgId: string, input: CreateMetricInput): Promise<Metric> {
  const def = MetricDefinitionSchema.parse(input.definition);
  const [row] = await getDb()
    .insert(metrics)
    .values({
      orgId,
      name: input.name,
      kind: def.kind,
      display: input.display,
      unit: input.unit ?? null,
      target: input.target != null ? String(input.target) : null,
      definition: def as unknown as Record<string, unknown>,
    })
    .returning();
  return row;
}

export async function listMetrics(orgId: string): Promise<Metric[]> {
  return getDb().select().from(metrics).where(eq(metrics.orgId, orgId)).orderBy(desc(metrics.createdAt));
}

/** Always org-scoped. */
export async function getMetric(orgId: string, id: string): Promise<Metric | null> {
  const [row] = await getDb()
    .select()
    .from(metrics)
    .where(and(eq(metrics.id, id), eq(metrics.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

export async function deleteMetric(orgId: string, id: string): Promise<void> {
  await getDb().delete(metrics).where(and(eq(metrics.id, id), eq(metrics.orgId, orgId)));
}
