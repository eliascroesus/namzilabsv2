import { z } from "zod";

export const FILTER_OPS = ["equals", "not_equals", "contains", "gt", "lt", "gte", "lte", "in"] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

/**
 * A single filter rule. `field` is one of the canonical columns (subject,
 * source, eventType, value) or a properties key via "properties.<key>".
 */
export const FilterSchema = z.object({
  field: z.string().min(1),
  op: z.enum(FILTER_OPS),
  value: z.string(),
});
export type Filter = z.infer<typeof FilterSchema>;

export const FiltersSchema = z.object({
  combinator: z.enum(["and", "or"]).default("and"),
  rules: z.array(FilterSchema).default([]),
});
export type Filters = z.infer<typeof FiltersSchema>;

export const AGGREGATIONS = ["count", "sum", "count_distinct"] as const;
export const TIME_BUCKETS = ["day", "week", "month"] as const;

export const AggregateSchema = z.object({
  kind: z.literal("aggregate"),
  source: z.string().nullable().default(null),
  eventType: z.string().nullable().default(null),
  filters: FiltersSchema.default({ combinator: "and", rules: [] }),
  aggregation: z.enum(AGGREGATIONS).default("count"),
  valueField: z.string().default("value"),
  distinctField: z.string().default("subject"),
  timeBucket: z.enum(TIME_BUCKETS).nullable().default(null),
});
export type AggregateDefinition = z.infer<typeof AggregateSchema>;

export const FunnelStageSchema = z.object({
  label: z.string().min(1),
  source: z.string().nullable().default(null),
  eventType: z.string().min(1),
  filters: FiltersSchema.default({ combinator: "and", rules: [] }),
});
export type FunnelStage = z.infer<typeof FunnelStageSchema>;

export const FunnelSchema = z.object({
  kind: z.literal("funnel"),
  stages: z.array(FunnelStageSchema).min(2),
});
export type FunnelDefinition = z.infer<typeof FunnelSchema>;

export const MetricDefinitionSchema = z.discriminatedUnion("kind", [AggregateSchema, FunnelSchema]);
export type MetricDefinition = z.infer<typeof MetricDefinitionSchema>;

export function parseDefinition(value: unknown): MetricDefinition {
  return MetricDefinitionSchema.parse(value);
}
