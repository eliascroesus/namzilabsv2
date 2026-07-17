import { and, or, desc, sql, type SQL } from "drizzle-orm";
import { events } from "@/db/schema";
import type { DB } from "@/db/types";
import type { AggregateDefinition, FunnelDefinition, Filters, Filter } from "./types";

export type DateRange = { from: Date; to: Date };

export type AggregateResult =
  | { kind: "scalar"; value: number }
  | { kind: "series"; series: Array<{ bucket: string; value: number }> };

export type FunnelResult = {
  stages: Array<{ label: string; count: number; conversionFromFirst: number; conversionFromPrev: number }>;
  /** Stage index with the largest absolute drop from the previous stage. */
  bottleneckIndex: number | null;
};

/** Map a filter field name to its SQL expression over the events table. */
function fieldExpr(field: string): SQL {
  switch (field) {
    case "subject":
      return sql`${events.subject}`;
    case "source":
      return sql`${events.source}`;
    case "eventType":
      return sql`${events.eventType}`;
    case "value":
      return sql`${events.value}`;
    default: {
      const key = field.startsWith("properties.") ? field.slice("properties.".length) : field;
      return sql`(${events.properties} ->> ${key})`;
    }
  }
}

function ruleCondition(rule: Filter): SQL {
  const f = fieldExpr(rule.field);
  const v = rule.value;
  switch (rule.op) {
    case "equals":
      return sql`${f} = ${v}`;
    case "not_equals":
      return sql`${f} <> ${v}`;
    case "contains":
      return sql`${f} ILIKE ${`%${v}%`}`;
    case "gt":
      return sql`(${f})::numeric > ${Number(v)}`;
    case "lt":
      return sql`(${f})::numeric < ${Number(v)}`;
    case "gte":
      return sql`(${f})::numeric >= ${Number(v)}`;
    case "lte":
      return sql`(${f})::numeric <= ${Number(v)}`;
    case "in": {
      const vals = v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (vals.length === 0) return sql`false`;
      return sql`${f} IN (${sql.join(
        vals.map((x) => sql`${x}`),
        sql`, `,
      )})`;
    }
  }
}

function filtersCondition(filters?: Filters): SQL | undefined {
  if (!filters || filters.rules.length === 0) return undefined;
  const conds = filters.rules.map(ruleCondition);
  return filters.combinator === "or" ? or(...conds) : and(...conds);
}

function baseWhere(
  orgId: string,
  range: DateRange,
  source: string | null,
  eventType: string | null,
  filters?: Filters,
  boardSource?: string | null,
): SQL {
  const conds: SQL[] = [
    sql`${events.orgId} = ${orgId}`,
    sql`${events.occurredAt} >= ${range.from}`,
    sql`${events.occurredAt} <= ${range.to}`,
  ];
  if (source) conds.push(sql`${events.source} = ${source}`);
  // Dashboard-wide source filter, intersected with the metric's own source.
  if (boardSource) conds.push(sql`${events.source} = ${boardSource}`);
  if (eventType) conds.push(sql`${events.eventType} = ${eventType}`);
  const fc = filtersCondition(filters);
  if (fc) conds.push(fc);
  return and(...conds) as SQL;
}

function aggregateExpr(def: AggregateDefinition): SQL {
  switch (def.aggregation) {
    case "count":
      return sql`count(*)::int`;
    case "sum":
      return sql`coalesce(sum((${fieldExpr(def.valueField)})::numeric), 0)`;
    case "count_distinct":
      return sql`count(distinct ${fieldExpr(def.distinctField)})::int`;
  }
}

/** Compute an aggregate metric (scalar, or a time-bucketed series for trends). */
export async function computeAggregate(
  db: DB,
  orgId: string,
  def: AggregateDefinition,
  range: DateRange,
  boardSource?: string | null,
): Promise<AggregateResult> {
  const where = baseWhere(orgId, range, def.source, def.eventType, def.filters, boardSource);
  const agg = aggregateExpr(def);

  if (def.timeBucket) {
    // The unit is a validated enum (day|week|month) — inline it so the SELECT and
    // GROUP BY expressions are byte-identical (a bound param would differ by
    // position and Postgres would reject the grouping). Group/order by ordinal.
    const bucket = sql<string>`to_char(date_trunc(${sql.raw(`'${def.timeBucket}'`)}, ${events.occurredAt}), 'YYYY-MM-DD')`;
    const rows = await db
      .select({ bucket, value: agg })
      .from(events)
      .where(where)
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    return {
      kind: "series",
      series: rows.map((r) => ({ bucket: String(r.bucket), value: Number(r.value) })),
    };
  }

  const rows = await db.select({ value: agg }).from(events).where(where);
  return { kind: "scalar", value: Number(rows[0]?.value ?? 0) };
}

/** Compute a funnel: distinct subjects reaching each ordered stage, + conversions. */
export async function computeFunnel(
  db: DB,
  orgId: string,
  def: FunnelDefinition,
  range: DateRange,
  boardSource?: string | null,
): Promise<FunnelResult> {
  const counts: number[] = [];
  for (const stage of def.stages) {
    const where = baseWhere(orgId, range, stage.source, stage.eventType, stage.filters, boardSource);
    const rows = await db
      .select({ value: sql<number>`count(distinct ${events.subject})::int` })
      .from(events)
      .where(where);
    counts.push(Number(rows[0]?.value ?? 0));
  }

  const first = counts[0] ?? 0;
  let bottleneckIndex: number | null = null;
  let worstDrop = -1;

  const stages = def.stages.map((s, i) => {
    const prev = i === 0 ? counts[i] : counts[i - 1];
    if (i > 0) {
      const drop = (counts[i - 1] ?? 0) - counts[i];
      if (drop > worstDrop) {
        worstDrop = drop;
        bottleneckIndex = i;
      }
    }
    return {
      label: s.label,
      count: counts[i],
      conversionFromFirst: first > 0 ? counts[i] / first : 0,
      conversionFromPrev: prev > 0 ? counts[i] / prev : 0,
    };
  });

  return { stages, bottleneckIndex };
}

/** Latest matching events — powers the builder's live sample and metric drill-down. */
export async function queryEvents(
  db: DB,
  orgId: string,
  opts: { source?: string | null; eventType?: string | null; filters?: Filters; range: DateRange; limit?: number },
) {
  const where = baseWhere(orgId, opts.range, opts.source ?? null, opts.eventType ?? null, opts.filters);
  return db
    .select()
    .from(events)
    .where(where)
    .orderBy(desc(events.occurredAt))
    .limit(opts.limit ?? 50);
}

/** Distinct sources present in a workspace (for builder dropdowns). */
export async function distinctSources(db: DB, orgId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ source: events.source })
    .from(events)
    .where(sql`${events.orgId} = ${orgId}`);
  return rows.map((r) => r.source).sort();
}

/** Distinct event types present (optionally within a source). */
export async function distinctEventTypes(db: DB, orgId: string, source?: string | null): Promise<string[]> {
  const conds: SQL[] = [sql`${events.orgId} = ${orgId}`];
  if (source) conds.push(sql`${events.source} = ${source}`);
  const rows = await db
    .selectDistinct({ eventType: events.eventType })
    .from(events)
    .where(and(...conds) as SQL);
  return rows.map((r) => r.eventType).sort();
}
