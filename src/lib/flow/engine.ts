import { and, desc, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { connections, events } from "@/db/schema";
import type { DB } from "@/db/types";
import { eventToRecord, getField, toNumber, STANDARD_FIELDS, type FlowRecord } from "./records";
import { planPushdown } from "./compile/pushdown";
import { compileRule } from "./compile/operators";
import { inferSchema, buildFieldInfo, type FieldInfo } from "./schema-infer";
import { listRegisteredFields } from "@/lib/schema-registry/registry";
import { fieldAppliesToEventType, readFilterFields } from "@/connectors/catalog";
import { hasStreamConfig, streamConfigHash } from "@/lib/sync/stream-hash";
import {
  AppConfigSchema,
  FilterConfigSchema,
  OutputConfigSchema,
  type AppConfig,
  TimeConfigSchema,
  TimeBetweenConfigSchema,
  FormulaConfigSchema,
  GroupConfigSchema,
  CalculateConfigSchema,
  PathsConfigSchema,
  isDatasetFormulaOp,
  type FlowGraph,
  type FlowNode,
  type FilterConfig,
  type AggregateConfig,
  type GroupConfig,
  type Shape,
  type Dataset,
  type Scalar,
  type Series,
  type Grouped,
  type TileSpec,
} from "./types";

export type EngineCtx = {
  db: DB;
  orgId: string;
  /**
   * E.4 — per-flow cutover flag. When set, Get-data reads push their
   * downstream filter chain into SQL (E.1) instead of loading everything and
   * filtering in JS. Off by default: a flow only opts in once the golden
   * parity suite covers it.
   *
   * ORDERING CONSTRAINT (pinned in PRE_LAUNCH_CHECKLIST.md item 5, proven in
   * tests/engine-parity.test.ts): do NOT enable this for an org until the
   * legacy-row reconciliation AND a reprocessConnection replay have run for
   * that org. Pre-unification rows can store un-normalized date-shaped values;
   * the JS engine normalizes them on read while the compiled path compares the
   * stored string, so even `equals`/`contains` diverge on such rows until the
   * replay re-normalizes them.
   */
  compile?: boolean;
  /** Collects what the compiler actually did, for E.5 provenance. */
  provenance?: CompileProvenance[];
};

/**
 * E.5 — one record of HOW a Get-data step's rows were produced: the exact SQL
 * that ran, its bound parameters, which filters were folded into it, and how
 * many rows came back. Stored with the materialized result so any number can
 * be traced to the query behind it.
 */
export type CompileProvenance = {
  appNodeId: string;
  foldedFilterNodeIds: string[];
  rowsLoaded: number;
  sql: string;
  params: unknown[];
  truncated: boolean;
};

export type NodeExecOk = {
  status: "ok";
  nodeType: string;
  /** E.4: the read hit the safety ceiling — surfaced, never silent. */
  truncated?: boolean;
  shape: Shape;
  /** Extra outputs keyed by source-handle id (Paths uses this). */
  outputs?: Record<string, Shape>;
  recordsIn: number;
  recordsOut: number;
  sample: FlowRecord[];
  outputSchema: FieldInfo[];
  tile?: TileSpec;
};
export type NodeExecErr = {
  status: "error";
  nodeType: string;
  error: string;
  recordsIn: number;
  recordsOut: number;
  sample: FlowRecord[];
  outputSchema: FieldInfo[];
};
export type NodeExec = NodeExecOk | NodeExecErr;

type ResolvedInput = { shape: Shape; exec: NodeExecOk; targetHandle: string | null; sourceNodeId: string };

export type RunResult = {
  nodes: Map<string, NodeExec>;
  outputs: Array<{ nodeId: string; tile: TileSpec }>;
};

/**
 * E.4 — the guard rail that replaces the old silent 20k truncation.
 *
 * The previous `APP_LOAD_CAP = 20_000` quietly dropped every row past the
 * newest 20k, so a large source produced a confidently WRONG number. It is
 * gone. What remains is a very high ceiling that exists only to keep a runaway
 * read from exhausting memory — and crossing it is reported as a VISIBLE
 * truncation on the node, never silently swallowed.
 */
const APP_LOAD_CEILING = 500_000;

/**
 * Rows per read. The ceiling bounds MEMORY; this bounds one RESPONSE.
 *
 * A single 500k-row select returns every column of every row in one HTTP
 * response on the Neon driver, and a Close step reading "All record types"
 * pulls email-thread payloads carrying hundreds of fields each — enough for
 * one response to fail outright, which is exactly what a customer saw. Pages
 * keep each response small; the ceiling and the visible truncation are
 * unchanged.
 */
const APP_LOAD_BATCH = 2_000;

export async function runFlow(ctx: EngineCtx, graph: FlowGraph, opts: { untilNodeId?: string } = {}): Promise<RunResult> {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const incomingBy = new Map<string, FlowGraph["edges"]>();
  for (const e of graph.edges) {
    if (!incomingBy.has(e.target)) incomingBy.set(e.target, []);
    incomingBy.get(e.target)!.push(e);
  }

  const wanted = opts.untilNodeId ? ancestorsOf(opts.untilNodeId, incomingBy) : new Set(graph.nodes.map((n) => n.id));
  const order = topoSort(graph).filter((id) => wanted.has(id));

  const nodes = new Map<string, NodeExec>();
  const outputs: RunResult["outputs"] = [];

  for (const id of order) {
    const node = nodeById.get(id);
    if (!node) continue;

    const inputs: ResolvedInput[] = [];
    let inputError = false;
    for (const e of incomingBy.get(id) ?? []) {
      const se = nodes.get(e.source);
      if (!se || se.status !== "ok") {
        inputError = true;
        continue;
      }
      const shape = e.sourceHandle && se.outputs?.[e.sourceHandle] ? se.outputs[e.sourceHandle] : se.shape;
      inputs.push({ shape, exec: se, targetHandle: e.targetHandle ?? null, sourceNodeId: e.source });
    }

    const exec = await execNode(ctx, node, inputs, inputError, graph);
    nodes.set(id, exec);
    if (node.type === "output" && exec.status === "ok" && exec.tile) {
      outputs.push({ nodeId: id, tile: exec.tile });
    }
  }

  return { nodes, outputs };
}

async function execNode(ctx: EngineCtx, node: FlowNode, inputs: ResolvedInput[], inputError: boolean, graph: FlowGraph): Promise<NodeExec> {
  const err = (message: string): NodeExecErr => ({
    status: "error",
    nodeType: node.type,
    error: message,
    recordsIn: 0,
    recordsOut: 0,
    sample: [],
    outputSchema: [],
  });

  if (node.type !== "app" && inputError) return err("An input node has an error — fix it first.");

  try {
    switch (node.type) {
      case "app":
        return await execApp(ctx, node, graph);
      case "filter":
        return execFilter(node, inputs);
      case "time":
        return execTime(node, inputs);
      case "time_between":
        return execTimeBetween(node, inputs);
      case "unite":
        return execUnite(node, inputs);
      case "paths":
        return execPaths(node, inputs, graph);
      case "group":
        return execGroup(node, inputs);
      case "formula":
        return execFormula(node, inputs);
      case "calculate":
        return execCalculate(node, inputs);
      case "output":
        return execOutput(node, inputs);
      default:
        return err(`The "${node.type}" node isn't available yet.`);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

// ---------- App ----------
/**
 * The source this step reads.
 *
 * Almost always on the config; resolved from the connection when it is not,
 * because the source now decides BOTH which rows belong to the step's stream and
 * which of its settings are read filters rather than stream identity. Getting it
 * wrong points the read at a stream hash nothing was ever written under, which
 * renders as an empty step rather than an error.
 */
async function appSource(ctx: EngineCtx, cfg: AppConfig): Promise<string | null> {
  if (cfg.source) return cfg.source;
  if (!cfg.connectionId) return null;
  const [c] = await ctx.db.select({ source: connections.source }).from(connections).where(eq(connections.id, cfg.connectionId)).limit(1);
  return c?.source ?? null;
}

/** The org-scoped WHERE for a Get data step (shared by the executor and field sampling). */
function appConds(orgId: string, cfg: AppConfig, source: string | null): SQL[] {
  const conds: SQL[] = [sql`${events.orgId} = ${orgId}`, isNull(events.deletedAt)];
  if (cfg.connectionId) conds.push(eq(events.connectionId, cfg.connectionId));
  if (cfg.source) conds.push(eq(events.source, cfg.source));
  if (cfg.eventType) conds.push(eq(events.eventType, cfg.eventType));
  // A flow-level resource selection reads exactly its own stream's events.
  if (hasStreamConfig(cfg.sourceConfig, source)) conds.push(eq(events.streamHash, streamConfigHash(cfg.sourceConfig, source)));
  conds.push(...readFilterConds(cfg, source));
  return conds;
}

/**
 * The step's read filters (FlowConfigField.readFilter) as WHERE clauses.
 *
 * These settings deliberately do NOT shape the sync — every flow on the
 * connection shares one stream — so they have to be applied here or not at all.
 * Applying them here is also what makes changing one instant: no new cursor, no
 * re-scan, no window to wait out.
 *
 * A field may name several paths, OR'd, so a value whose meaning changed still
 * matches (Calendly's is an event-type URI now and was the type's name before).
 * An unset field adds nothing — the step reads the whole stream, which is the
 * safe direction to be wrong in.
 */
function readFilterConds(cfg: AppConfig, source: string | null): SQL[] {
  const out: SQL[] = [];
  for (const field of readFilterFields(source)) {
    // A filter that cannot apply to this step's record kind is IGNORED, not
    // applied — a published flow whose Record type changed away from
    // opportunities still carries its old pipelineId, and honouring it would
    // hide every row while looking correctly configured.
    if (!fieldAppliesToEventType(field, cfg.eventType)) continue;
    const raw = (cfg.sourceConfig as Record<string, unknown> | undefined)?.[field.key];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) continue;
    const paths = field.readFilter?.paths ?? [];
    const anyPath = paths.map((path) => compileRule({ field: path, op: "equals", value, valueKind: "fixed" }));
    if (anyPath.length === 1) out.push(anyPath[0]);
    else if (anyPath.length > 1) out.push(or(...anyPath)!);
  }
  return out;
}

/**
 * The fields a Get data step's records actually carry, inferred from a small
 * sample of its own synced events. Powers pickers that need the step's fields
 * BEFORE it has been tested (e.g. "Match duplicates by" listing the user's real
 * sheet columns), without loading the full record set.
 */
export async function sampleAppFields(ctx: EngineCtx, config: unknown, limit = 100): Promise<FieldInfo[]> {
  const cfg = AppConfigSchema.parse(config ?? {});

  // A.1: prefer the field registry the writer maintains. It knows the UNION of
  // fields across everything ever synced for the stream, which a 100-row scan
  // does not — a column that stopped being filled 200 rows ago is still a real
  // field of the sheet, and the scan would silently drop it from every picker.
  // It is also one indexed lookup instead of scanning rows and re-deriving the
  // schema on every request.
  const registered = await registeredAppFields(ctx, cfg);
  if (registered) return registered;

  // Fallback: whole-connection reads (no stream identity to key on) and streams
  // whose registry has not been populated yet — a connection synced before A.1,
  // or one whose first sweep has not landed. Correct, just costlier.
  const rows = await ctx.db
    .select()
    .from(events)
    .where(and(...appConds(ctx.orgId, cfg, await appSource(ctx, cfg))))
    .orderBy(desc(events.occurredAt))
    .limit(limit);
  return inferSchema(rows.map(eventToRecord));
}

/**
 * The registry's answer for this step's stream, or null when it cannot serve
 * the request (no connection chosen, or nothing registered yet) so the caller
 * falls back to the scan.
 */
async function registeredAppFields(ctx: EngineCtx, cfg: AppConfig): Promise<FieldInfo[] | null> {
  if (!cfg.connectionId) return null;
  try {
    const source = await appSource(ctx, cfg);
    const streamHash = hasStreamConfig(cfg.sourceConfig, source) ? streamConfigHash(cfg.sourceConfig, source) : null;
    const fields = await listRegisteredFields(ctx.db, {
      orgId: ctx.orgId,
      connectionId: cfg.connectionId,
      streamHash,
    });
    if (fields.length === 0) return null;
    // Standard spine fields are the same for every event and are not recorded
    // in the registry (it tracks `properties`), so they come from the same
    // constant the scan path uses.
    const out: FieldInfo[] = STANDARD_FIELDS.map((f) => buildFieldInfo(f, f, undefined));
    for (const f of [...fields].sort((a, b) => a.fieldPath.localeCompare(b.fieldPath))) {
      if (f.fieldPath.startsWith("__")) continue; // internal engine keys are never fields
      // The registry stores the example wrapped (`{ value: … }`) so a jsonb
      // column can hold a bare scalar; unwrap before inferring, or every field
      // types as "object" and the picker shows the wrong icon for all of them.
      const example = (f.sample as { value?: unknown } | null)?.value;
      out.push(buildFieldInfo(`properties.${f.fieldPath}`, f.fieldPath, example));
    }
    return out;
  } catch {
    // The picker must never fail because a diagnostic table is unavailable.
    return null;
  }
}

async function execApp(ctx: EngineCtx, node: FlowNode, graph?: FlowGraph): Promise<NodeExec> {
  const cfg = AppConfigSchema.parse(node.data.config ?? {});
  const conds = appConds(ctx.orgId, cfg, await appSource(ctx, cfg));

  // E.1: fold the downstream filter chain into this read when the flow has
  // opted in. The filters STILL run in JS afterwards, so the pre-filter can
  // only reduce work — never change the answer.
  let folded: string[] = [];
  if (ctx.compile && graph) {
    const plan = planPushdown(graph, node.id);
    if (plan.predicate) {
      conds.push(plan.predicate);
      folded = plan.foldedNodeIds;
    }
  }

  const rows: (typeof events.$inferSelect)[] = [];
  // The statement SHAPE is the same for every page (only the keyset bound
  // moves), so provenance records the first one — with the real total below.
  let statement = { sql: "", params: [] as unknown[] };
  let cursor: { occurredAt: Date; id: string } | null = null;

  while (rows.length < APP_LOAD_CEILING) {
    const take = Math.min(APP_LOAD_BATCH, APP_LOAD_CEILING - rows.length);
    // KEYSET, and the composite matters: `occurred_at < X` alone drops every
    // row that ties with the page's last timestamp, and `<=` repeats them.
    // Ties are common (bulk imports stamp identical seconds), so this is the
    // difference between a correct page boundary and silently wrong numbers.
    const page = cursor
      ? and(
          ...conds,
          sql`(${events.occurredAt} < ${cursor.occurredAt} or (${events.occurredAt} = ${cursor.occurredAt} and ${events.id} < ${cursor.id}))`,
        )
      : and(...conds);
    const query = ctx.db
      .select()
      .from(events)
      .where(page)
      // E.3: a deterministic TOTAL order — occurred_at alone leaves ties, and an
      // unstable order makes "the newest duplicate" (and any cap) arbitrary.
      .orderBy(desc(events.occurredAt), desc(events.id))
      .limit(take);

    if (!statement.sql) {
      try {
        const q = (query as unknown as { toSQL: () => { sql: string; params: unknown[] } }).toSQL();
        statement = { sql: q.sql, params: q.params };
      } catch {
        // Provenance is diagnostic; never fail a run to record it.
      }
    }

    let batch: (typeof events.$inferSelect)[];
    try {
      batch = await query;
    } catch (e) {
      // The driver's own text is a wall of SQL with no advice in it. Say what
      // to DO, then keep the cause — this wrapper exists because a customer
      // hit an unexplained failure loading every record type at once, and the
      // next occurrence has to name itself.
      const cause = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Couldn't load this step's records — the read failed partway through${rows.length > 0 ? ` (after ${rows.length.toLocaleString()} records)` : ""}. Narrowing the Record type usually fixes it. Cause: ${cause.slice(0, 200)}`,
      );
    }

    // A LOOP, not `push(...batch)`: a spread passes every element as its own
    // argument and blows the stack somewhere past ~125k (the same defect
    // documented above computeAgg's min/max). Pages are small today, but the
    // rule here is that no spread ever meets a collection whose size is
    // decided elsewhere — a stubbed reader that ignores our LIMIT is enough
    // to prove it.
    for (const r of batch) rows.push(r);
    if (batch.length < take) break; // short page = end of the result set
    const last = batch[batch.length - 1];
    cursor = { occurredAt: last.occurredAt instanceof Date ? last.occurredAt : new Date(last.occurredAt), id: last.id };
  }

  if (ctx.provenance) {
    ctx.provenance.push({
      appNodeId: node.id,
      foldedFilterNodeIds: folded,
      rowsLoaded: rows.length,
      sql: statement.sql,
      params: statement.params,
      truncated: rows.length >= APP_LOAD_CEILING,
    });
  }

  let records = rows.map(eventToRecord);
  // Remove duplicates at the source — the FIRST thing that happens, before any
  // later step runs, so a duplicate never costs downstream work. Records are
  // newest-first here, so "keep the first seen" keeps the most recent copy.
  if (cfg.dedupe) records = dedupeRecords(records, cfg.dedupeField || "subject");
  const exec = datasetExec("app", node.id, records, rows.length);
  // Never silently truncate: if the ceiling was actually hit, the node says so.
  if (rows.length >= APP_LOAD_CEILING && exec.status === "ok") {
    return { ...exec, truncated: true } as NodeExec;
  }
  return exec;
}

/** Keep one record per identity value (the newest); empty identities always pass. */
function dedupeRecords(records: FlowRecord[], field: string): FlowRecord[] {
  const seen = new Set<string>();
  const out: FlowRecord[] = [];
  for (const r of records) {
    const key = String(getField(r, field) ?? "").trim();
    if (key === "") {
      out.push(r);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// ---------- Filter ----------
function execFilter(node: FlowNode, inputs: ResolvedInput[]): NodeExec {
  const cfg = FilterConfigSchema.parse(node.data.config ?? {});
  const input = requireDataset(inputs, "Filter");
  let recs = input.records;
  // Optional prominent "Date range" quick section (reuses the Time window logic).
  const dr = cfg.dateRange;
  if (dr?.enabled) {
    const { start, end } = timeWindow({ mode: dr.mode, preset: dr.preset, from: dr.from, to: dr.to, days: dr.days });
    recs = recs.filter((r) => {
      const t = dateMs(getField(r, dr.dateField));
      return t != null && t >= start && t <= end;
    });
  }
  const passed = recs.filter((r) => evalRules(r, cfg));
  return datasetExec("filter", node.id, passed, input.records.length);
}

// ---------- Time ----------
function execTime(node: FlowNode, inputs: ResolvedInput[]): NodeExec {
  const cfg = TimeConfigSchema.parse(node.data.config ?? {});
  const input = requireDataset(inputs, "Time");
  const { start, end } = timeWindow(cfg);
  const passed = input.records.filter((r) => {
    const t = dateMs(getField(r, cfg.dateField));
    return t != null && t >= start && t <= end;
  });
  return datasetExec("time", node.id, passed, input.records.length);
}

// ---------- Time between ----------
const TIME_BETWEEN_UNIT_MS: Record<string, number> = {
  seconds: 1_000,
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

/**
 * The pairing primitive nothing else in the engine has: per distinct
 * `keyField` value, the earliest `fromType` record is matched with its
 * `toType` record (mode "first" = first at-or-after the from moment;
 * "last" = the latest one), and ONE record per match is emitted carrying
 * the gap as a plain number (`properties.duration`, in `unit`).
 *
 * Four load-bearing choices:
 * - Conditions, not record types: the start and end are `FilterConfig`s run
 *   through the same `evalRules` every other step uses, so "the first
 *   OUTBOUND call" is sayable and no raw column is addressed by name.
 * - The output IS the start record with the gap added — every dataset step
 *   preserves what flows through it.
 * - The duration is a NUMBER, not a date pair: the existing avg/median/min/
 *   max never learned to read timestamps, and they don't have to — a
 *   downstream Calculate over `properties.duration` just works.
 * - "First at-or-after": a call BEFORE the lead existed (a re-imported
 *   history overlap, a mismatched key) must never count as the response to
 *   it. Unmatched keys emit NOTHING — a lead never called has no duration,
 *   and emitting 0 would drag every average toward a lie.
 * - `occurredAt` = the FROM record's moment, so date-range filters and the
 *   dashboard's time reference read as "leads created in this window",
 *   which is the question speed-to-lead answers.
 */
function execTimeBetween(node: FlowNode, inputs: ResolvedInput[]): NodeExec {
  const cfg = TimeBetweenConfigSchema.parse(node.data.config ?? {});
  const input = requireDataset(inputs, "Time between");
  if (!cfg.keyField || cfg.start.rules.length === 0 || cfg.end.rules.length === 0) {
    throw new Error("Time between needs a matching field, plus a condition for the start and the end.");
  }
  const unitMs = TIME_BETWEEN_UNIT_MS[cfg.unit] ?? 60_000;

  type Pair = { start: FlowRecord | null; startAt: number | null; ends: Array<{ at: number; id: string }> };
  const byKey = new Map<string, Pair>();
  for (const r of input.records) {
    const keyRaw = getField(r, cfg.keyField);
    const key = typeof keyRaw === "string" ? keyRaw : keyRaw != null ? String(keyRaw) : "";
    if (!key) continue; // no key, no honest match
    const at = dateMs(getField(r, "occurredAt"));
    if (at == null) continue;
    let pair = byKey.get(key);
    if (!pair) {
      pair = { start: null, startAt: null, ends: [] };
      byKey.set(key, pair);
    }
    // The SAME predicate Filter, Paths and Group evaluate. A record can match
    // both conditions — legal, and it means "the gap to the next one".
    if (evalRules(r, cfg.start) && (pair.startAt == null || at < pair.startAt)) {
      pair.startAt = at;
      pair.start = r;
    }
    if (evalRules(r, cfg.end)) pair.ends.push({ at, id: r.id });
  }

  const out: FlowRecord[] = [];
  for (const [key, pair] of byKey) {
    if (pair.start == null || pair.startAt == null) continue;
    const from = pair.startAt;
    // Loop, not spread/filter chains — same stack-bound discipline as
    // computeAgg's min/max. Excluded by IDENTITY, not by type: the start
    // record can never be its own end, but a genuinely distinct record at
    // the same instant is a real zero-length gap.
    let toAt: number | null = null;
    for (const e of pair.ends) {
      if (e.id === pair.start.id || e.at < from) continue;
      if (toAt == null || (cfg.mode === "first" ? e.at < toAt : e.at > toAt)) toAt = e.at;
    }
    if (toAt == null) continue;
    out.push({
      // THE OUTPUT IS THE START RECORD, ANNOTATED — not a fabricated one.
      // Every other dataset step preserves the fields flowing through it;
      // this one used to emit {key, from_at, to_at, duration} and silently
      // destroy every lead and call field downstream. Now a later Filter can
      // still read properties.lead_id, and the step obeys the same law as
      // its peers.
      ...pair.start,
      properties: {
        ...pair.start.properties,
        key,
        from_at: new Date(from).toISOString(),
        to_at: new Date(toAt).toISOString(),
        // Named for the unit picked, so the field says what it measures.
        [`duration_${cfg.unit}`]: (toAt - from) / unitMs,
        // Stable alias: saved Calculate steps and templates point here.
        duration: (toAt - from) / unitMs,
      },
    });
  }
  return datasetExec("time_between", node.id, out, input.records.length);
}

// ---------- Unite ----------
/**
 * The opposite of Split into paths: joins every connected lane (branches, extra data
 * sources) back into one stream, so every later step can read all of their records
 * and fields. No options — it's pure flow shape.
 */
function execUnite(node: FlowNode, inputs: ResolvedInput[]): NodeExec {
  if (inputs.length === 0) throw new Error("Unite needs at least one connected input.");
  const datasets = inputs.map((i) => {
    if (i.shape.kind !== "dataset") throw new Error("Unite only accepts record inputs.");
    return i.shape.records;
  });
  const records = datasets.flat();
  return datasetExec("unite", node.id, records, records.length);
}

// ---------- Paths ----------
function execPaths(node: FlowNode, inputs: ResolvedInput[], graph: FlowGraph): NodeExec {
  const cfg = PathsConfigSchema.parse(node.data.config ?? {});
  const input = requireDataset(inputs, "Paths");
  const records = input.records;
  const outputs: Record<string, Shape> = {};

  // A branch's conditions come from one of two places, transparently:
  //  - Legacy hubs stored per-path filters directly on the hub (+ a fallbackId lane).
  //  - New hubs keep each branch's conditions in that branch's own first
  //    "Path conditions" (Filter) step, read from the graph here. The hub itself
  //    holds no rules — only each branch's mode (custom / always / fallback).
  const legacy = cfg.paths.some((p) => (p.filters?.rules?.length ?? 0) > 0);
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const condsOf = (p: { id: string; filters?: FilterConfig }): FilterConfig | null => {
    if (legacy) return p.filters ?? null;
    const edge = graph.edges.find((e) => e.source === node.id && e.sourceHandle === p.id);
    const first = edge ? nodeById.get(edge.target) : undefined;
    return first?.type === "filter" ? FilterConfigSchema.parse(first.data.config ?? {}) : null;
  };
  const hasConds = (c: FilterConfig | null): c is FilterConfig => !!c && c.rules.length > 0;

  // Does a record continue down at least one custom branch? (Fallback = the rest.)
  // A legacy path without hub filters never claimed records for fallback purposes; a new
  // custom branch with no conditions yet passes everything, so it claims everything.
  const customPaths = cfg.paths.filter((p) => p.mode === "custom");
  const matchedAny = (r: FlowRecord) =>
    customPaths.some((p) => {
      const c = condsOf(p);
      return legacy ? hasConds(c) && evalRules(r, c) : hasConds(c) ? evalRules(r, c) : true;
    });

  for (const p of cfg.paths) {
    if (p.mode === "always") {
      outputs[p.id] = { kind: "dataset", records };
    } else if (p.mode === "fallback") {
      outputs[p.id] = { kind: "dataset", records: records.filter((r) => !matchedAny(r)) };
    } else {
      // Custom: a legacy hub filters here (its rules live on the hub); a new hub passes
      // everything through and the branch's own Path-conditions step narrows it.
      const c = condsOf(p);
      outputs[p.id] = { kind: "dataset", records: legacy && hasConds(c) ? records.filter((r) => evalRules(r, c)) : records };
    }
  }
  if (cfg.fallbackId) outputs[cfg.fallbackId] = { kind: "dataset", records: records.filter((r) => !matchedAny(r)) };

  return {
    status: "ok",
    nodeType: "paths",
    shape: { kind: "dataset", records },
    outputs,
    recordsIn: records.length,
    recordsOut: records.length,
    sample: records.slice(0, 3),
    outputSchema: inferSchema(records),
  };
}

// ---------- Group ----------
function execGroup(node: FlowNode, inputs: ResolvedInput[]): NodeExec {
  const cfg = GroupConfigSchema.parse(node.data.config ?? {});
  const input = requireDataset(inputs, "Group");
  const groups = cfg.mode === "field" ? groupByField(input.records, cfg) : groupByCategories(input.records, cfg);
  return {
    status: "ok",
    nodeType: "group",
    shape: { kind: "grouped", groups },
    recordsIn: input.records.length,
    recordsOut: groups.length,
    sample: input.records.slice(0, 3),
    outputSchema: [],
  };
}

// ---------- Formula / Calculate ----------
// A binary Calculate compares two named inputs: handle "a" and handle "b".
// A dataset Calculate (count/sum/avg/min/max — the former Count node) instead
// aggregates the records flowing in through its plain chain edge.
/**
 * Read a single number from a named input handle (a/b). Shared by Formula + Calculate.
 * A scalar step (Count/Calculate) contributes its value; a dataset step (Get data,
 * Filter, …) contributes its record count — its "Output number" — so counts like
 * "56 passed" or "76 loaded" can be compared directly.
 */
function scalarAt(inputs: ResolvedInput[], handle: "a" | "b", fixed?: number | null): number {
  const found = inputs.find((i) => i.targetHandle === handle);
  if (!found) {
    // No step wired in: a typed-in literal number fills the slot.
    if (fixed != null) return fixed;
    throw new Error(`Needs a number connected to input ${handle.toUpperCase()}.`);
  }
  if (found.shape.kind === "scalar") return found.shape.value;
  if (found.shape.kind === "dataset") return found.shape.records.length;
  throw new Error("This input isn't a single number — pick a Count step or a step's record count.");
}

/** The binary calculation over two numbers. Shared by Formula + Calculate(compare). */
function formulaValue(op: string, a: number, b: number): number {
  const divGuard = (x: number, y: number) => {
    if (y === 0) throw new Error("Division by zero — check the second (denominator) number.");
    return x / y;
  };
  switch (op) {
    case "add":
      return a + b;
    case "average":
      return (a + b) / 2;
    case "subtract":
    case "difference":
      return a - b;
    case "multiply":
      return a * b;
    case "divide":
    case "ratio":
      return divGuard(a, b);
    case "percentage":
      return divGuard(a, b) * 100;
    case "percent_change":
      return divGuard(a - b, b) * 100;
    default:
      throw new Error(`Unknown calculation "${op}".`);
  }
}

function execFormula(node: FlowNode, inputs: ResolvedInput[]): NodeExec {
  const cfg = FormulaConfigSchema.parse(node.data.config ?? {});

  if (isDatasetFormulaOp(cfg.op)) {
    // Aggregate the records flowing in through the chain (any stray a/b
    // reference edges from an op switch are ignored).
    const input = inputs.find((i) => i.targetHandle == null && i.shape.kind === "dataset");
    if (!input) throw new Error("Calculate needs records flowing in — connect it after a data step.");
    const records = (input.shape as Dataset).records;
    const acfg: AggregateConfig = { aggregation: cfg.op as AggregateConfig["aggregation"], field: cfg.field, distinctField: cfg.distinctField, groupBy: cfg.groupBy };
    const shape = aggregate(records, acfg);
    const recordsOut = shape.kind === "scalar" ? 1 : shape.kind === "series" ? shape.series.length : shape.groups.length;
    return { status: "ok", nodeType: "formula", shape, recordsIn: records.length, recordsOut, sample: records.slice(0, 3), outputSchema: [] };
  }

  const value = formulaValue(cfg.op, scalarAt(inputs, "a", cfg.aFixed), scalarAt(inputs, "b", cfg.bFixed));
  return { status: "ok", nodeType: "formula", shape: { kind: "scalar", value: round(value) }, recordsIn: 2, recordsOut: 1, sample: [], outputSchema: [] };
}

// ---------- Calculate (merged Aggregate + Formula + Group) ----------
function execCalculate(node: FlowNode, inputs: ResolvedInput[]): NodeExec {
  const cfg = CalculateConfigSchema.parse(node.data.config ?? {});

  if (cfg.mode === "compare") {
    const value = formulaValue(cfg.op, scalarAt(inputs, "a", cfg.aFixed), scalarAt(inputs, "b", cfg.bFixed));
    return { status: "ok", nodeType: "calculate", shape: { kind: "scalar", value: round(value) }, recordsIn: 2, recordsOut: 1, sample: [], outputSchema: [] };
  }

  const input = requireDataset(inputs, "Calculate");

  if (cfg.mode === "breakdown") {
    const groupAgg = cfg.aggregation === "sum" || cfg.aggregation === "count_distinct" ? cfg.aggregation : "count";
    const gcfg: GroupConfig = {
      mode: cfg.breakdownMode,
      field: cfg.breakdownField,
      aggregation: groupAgg,
      valueField: cfg.field,
      distinctField: cfg.distinctField,
      categories: cfg.categories,
      fallbackLabel: cfg.fallbackLabel,
    };
    const groups = cfg.breakdownMode === "field" ? groupByField(input.records, gcfg) : groupByCategories(input.records, gcfg);
    return { status: "ok", nodeType: "calculate", shape: { kind: "grouped", groups }, recordsIn: input.records.length, recordsOut: groups.length, sample: input.records.slice(0, 3), outputSchema: [] };
  }

  // number
  const acfg: AggregateConfig = { aggregation: cfg.aggregation, field: cfg.field, distinctField: cfg.distinctField, groupBy: cfg.groupBy };
  const shape = aggregate(input.records, acfg);
  const recordsOut = shape.kind === "scalar" ? 1 : shape.kind === "series" ? shape.series.length : shape.groups.length;
  return { status: "ok", nodeType: "calculate", shape, recordsIn: input.records.length, recordsOut, sample: input.records.slice(0, 3), outputSchema: [] };
}

// ---------- Output / tiles ----------

/** Presentation config for a tile (Output node config, or a Review & publish MetricSpec). */
export type TilePresentation = {
  name: string;
  description?: string;
  viz: TileSpec["viz"];
  format: TileSpec["format"];
  unit?: string;
  currency?: string;
  precision: number;
  target: number | null;
  /** Optional dashboard time axis: a date field to bucket a dataset endpoint by. */
  timeField?: string;
  timeUnit?: "day" | "week" | "month" | "quarter" | "year";
};

/** Build a dashboard tile from a computed shape + its presentation. Shared by the
 * Output node and the materializer (endpoint metrics). */
export function buildTile(spec: TilePresentation, shape: Shape, sample: FlowRecord[]): TileSpec {
  const tile: TileSpec = {
    name: spec.name,
    description: spec.description,
    viz: spec.viz,
    format: spec.format,
    unit: spec.unit,
    currency: spec.currency,
    precision: spec.precision,
    target: spec.target,
    timeField: spec.timeField,
    timeUnit: spec.timeUnit,
    sample,
  };
  // A metric-level time reference turns a raw dataset endpoint into a time series for
  // line/bar charts — records are counted into buckets of the chosen date field.
  if (spec.timeField && (spec.viz === "line" || spec.viz === "bar") && shape.kind === "dataset") {
    const unit = spec.timeUnit ?? "month";
    const buckets = new Map<string, number>();
    for (const r of shape.records) {
      const t = dateMs(getField(r, spec.timeField));
      if (t == null) continue;
      const key = bucketKey(new Date(t).toISOString(), unit);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    tile.series = [...buckets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([bucket, value]) => ({ bucket, value }));
    tile.value = round(tile.series.reduce((a, b) => a + b.value, 0));
    return tile;
  }
  if (shape.kind === "scalar") tile.value = shape.value;
  else if (shape.kind === "series") {
    tile.series = shape.series;
    // The metric over the whole set when the shape carried one; the sum of the
    // buckets only as the fallback it always was. For a sum or a count the two
    // agree, so no existing tile moves.
    tile.value = shape.total ?? round(shape.series.reduce((a, b) => a + b.value, 0));
  } else if (shape.kind === "grouped") {
    tile.groups = shape.groups;
    tile.value = shape.total ?? round(shape.groups.reduce((a, b) => a + b.value, 0));
  } else {
    tile.value = shape.records.length;
    tile.sample = shape.records.slice(0, 5);
  }
  return tile;
}

function execOutput(node: FlowNode, inputs: ResolvedInput[]): NodeExec {
  const cfg = OutputConfigSchema.parse(node.data.config ?? {});
  const input = inputs[0];
  if (!input) {
    return { status: "error", nodeType: "output", error: "Output needs one connected input.", recordsIn: 0, recordsOut: 0, sample: [], outputSchema: [] };
  }
  const tile = buildTile(cfg, input.shape, input.exec.sample);
  return {
    status: "ok",
    nodeType: "output",
    shape: input.shape,
    recordsIn: input.exec.recordsOut,
    recordsOut: 1,
    sample: input.exec.sample,
    outputSchema: [],
    tile,
  };
}

// ---------- shared executors helpers ----------
function datasetExec(nodeType: string, nodeId: string, records: FlowRecord[], recordsIn: number): NodeExecOk {
  const count = records.length;
  // Stamp this step's own record-count and pass flag under a per-node key. Records carry
  // these downstream, so any later step can reference *this* step's "Output number" / bool
  // "Output" and it resolves correctly no matter how many steps sit in between. Keys are
  // "__"-prefixed and hidden from the field schema (see schema-infer).
  const ckey = `__count_${nodeId}`;
  const pkey = `__passed_${nodeId}`;
  const stamped = records.map((r) => ({ ...r, properties: { ...r.properties, [ckey]: count, [pkey]: true } }));
  // The preview reads "Latest N records", so it has to mean that. The dataset is
  // ordered newest-first by `occurred_at`, which was the same thing until a
  // source started dating records by when they WILL happen — Calendly's meetings
  // reach a year ahead, so the head of the list became appointments in eleven
  // months' time, shown under a label promising the opposite.
  //
  // Ordering the dataset differently is not an option: `execApp` relies on
  // newest-first so dedupe keeps the most recent copy. So only the SAMPLE is
  // re-ordered — most recent first, then whatever is coming up soonest.
  const preview = topPreview(stamped, 3);
  return {
    status: "ok",
    nodeType,
    shape: { kind: "dataset", records: stamped },
    recordsIn,
    recordsOut: count,
    sample: preview,
    outputSchema: inferSchema(stamped),
  };
}

/**
 * The top-k records ordered the way a human reads "latest": what just
 * happened, newest first — and only then what is coming up, soonest first.
 * (A plain newest-first order puts the furthest-future record at the top,
 * which is the least recognisable row a preview could show.)
 *
 * A SELECTION, not a sort — this used to copy and fully sort the dataset
 * (O(n log n) over up to APP_LOAD_CEILING records, per dataset node) to
 * display THREE rows. One scan keeping the best k is behavior-identical
 * under one condition the loop below preserves deliberately: an incumbent is
 * displaced only on STRICT improvement, so ties keep the earliest-
 * encountered record — the same answer V8's stable sort gave, where ties
 * resolved to input order (the SQL's `occurred_at DESC, id DESC` at the app
 * node, the upstream order elsewhere). A `>=`-style displacement would
 * silently reverse tie order; the seeded equivalence test pins this.
 */
function topPreview(records: FlowRecord[], k: number, now = Date.now()): FlowRecord[] {
  const at = (r: FlowRecord) => Date.parse(r.occurredAt) || 0;
  const cmp = (a: FlowRecord, b: FlowRecord): number => {
    const ta = at(a);
    const tb = at(b);
    const aFuture = ta > now;
    const bFuture = tb > now;
    if (aFuture !== bFuture) return aFuture ? 1 : -1; // already happened wins
    return aFuture ? ta - tb : tb - ta; // upcoming: soonest first; past: newest first
  };
  const top: FlowRecord[] = [];
  for (const r of records) {
    // Find the insertion point among at most k incumbents: strictly better
    // than the one it displaces, never equal.
    let i = top.length;
    while (i > 0 && cmp(r, top[i - 1]) < 0) i--;
    if (i < k) {
      top.splice(i, 0, r);
      if (top.length > k) top.pop();
    }
  }
  return top;
}

/** Exported for the E.2 parity suite: the JS side is the ORACLE the
 * compiled SQL must match exactly. */
export function evalRules(rec: FlowRecord, cfg: FilterConfig): boolean {
  if (cfg.rules.length === 0) return true;
  const results = cfg.rules.map((rule) => evalRule(rec, rule));
  return cfg.combinator === "or" ? results.some(Boolean) : results.every(Boolean);
}

type Rule = { field: string; op: string; value: string; value2?: string; valueKind?: string; valueField?: string };

export function evalRule(rec: FlowRecord, rule: Rule): boolean {
  const raw = getField(rec, rule.field);
  const str = raw == null ? "" : String(raw);
  // Comparison value: a mapped upstream field (resolved per-record) or a literal.
  const rhsRaw: unknown = rule.valueKind === "field" && rule.valueField ? getField(rec, rule.valueField) : rule.value;
  const v = rhsRaw == null ? "" : String(rhsRaw);
  const rhsNum = num(rhsRaw);
  const rhsDate = dateMs(rhsRaw);
  switch (rule.op) {
    case "equals":
      return str === v;
    case "not_equals":
      return str !== v;
    case "contains":
      return str.toLowerCase().includes(v.toLowerCase());
    case "not_contains":
      return !str.toLowerCase().includes(v.toLowerCase());
    case "starts_with":
      return str.toLowerCase().startsWith(v.toLowerCase());
    case "ends_with":
      return str.toLowerCase().endsWith(v.toLowerCase());
    case "gt":
      return num(raw) != null && rhsNum != null && (num(raw) as number) > rhsNum;
    case "lt":
      return num(raw) != null && rhsNum != null && (num(raw) as number) < rhsNum;
    case "gte":
      return num(raw) != null && rhsNum != null && (num(raw) as number) >= rhsNum;
    case "lte":
      return num(raw) != null && rhsNum != null && (num(raw) as number) <= rhsNum;
    case "is_empty":
      return raw == null || str === "";
    case "is_not_empty":
      return raw != null && str !== "";
    case "is_one_of":
      return splitList(v).includes(str);
    case "is_not_one_of":
      return !splitList(v).includes(str);
    case "before":
      return dateMs(raw) != null && (dateMs(raw) as number) < (rhsDate ?? Infinity);
    case "after":
      return dateMs(raw) != null && (dateMs(raw) as number) > (rhsDate ?? -Infinity);
    case "between": {
      const t = dateMs(raw);
      const lo = rhsDate;
      const hi = dateMs(rule.value2 ?? "");
      return t != null && lo != null && hi != null && t >= lo && t <= hi;
    }
    default:
      return false;
  }
}

function aggregate(records: FlowRecord[], cfg: AggregateConfig): Scalar | Series | Grouped {
  if (!cfg.groupBy) return { kind: "scalar", value: computeAgg(records, cfg.aggregation, cfg.field, cfg.distinctField) };
  if (cfg.groupBy.type === "time") {
    const unit = cfg.groupBy.unit;
    const buckets = new Map<string, FlowRecord[]>();
    for (const r of records) {
      const key = bucketKey(r.occurredAt, unit);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(r);
    }
    return {
      kind: "series",
      series: [...buckets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([bucket, recs]) => ({ bucket, value: computeAgg(recs, cfg.aggregation, cfg.field, cfg.distinctField) })),
      // The headline, computed HERE because this is where the records are. See
      // the note on `Series` for why it cannot be derived from the buckets.
      total: computeAgg(records, cfg.aggregation, cfg.field, cfg.distinctField),
    };
  }
  const field = cfg.groupBy.field;
  const groups = new Map<string, FlowRecord[]>();
  for (const r of records) {
    const key = String(getField(r, field) ?? "—");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  return {
    kind: "grouped",
    groups: [...groups.entries()].map(([label, recs]) => ({ label, value: computeAgg(recs, cfg.aggregation, cfg.field, cfg.distinctField) })).sort((a, b) => b.value - a.value),
    total: computeAgg(records, cfg.aggregation, cfg.field, cfg.distinctField),
  };
}

function computeAgg(records: FlowRecord[], aggregation: string, field: string, distinctField: string): number {
  switch (aggregation) {
    case "count":
      return records.length;
    case "count_distinct": {
      const set = new Set<string>();
      for (const r of records) {
        const v = getField(r, distinctField);
        if (v != null && v !== "") set.add(String(v));
      }
      return set.size;
    }
    default: {
      const nums = records.map((r) => num(getField(r, field))).filter((n): n is number => n != null);
      if (nums.length === 0) return 0;
      if (aggregation === "sum") return round(nums.reduce((a, b) => a + b, 0));
      if (aggregation === "avg") return round(nums.reduce((a, b) => a + b, 0) / nums.length);
      if (aggregation === "median") {
        // Sort a copy — same memory bound as the materialized nums array
        // itself. Even count averages the two middles (the conventional
        // answer, and the one that keeps median(2,4) = 3 rather than a
        // coin-flip between them).
        const sorted = [...nums].sort((a, b) => a - b);
        const mid = sorted.length >> 1;
        return round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
      }
      /**
       * A LOOP, NOT A SPREAD, and not as a micro-optimisation.
       *
       * `Math.min(...nums)` passes every value as a separate ARGUMENT, and the
       * argument count is bounded by the engine stack. Measured on this
       * runtime: 125,000 passes, 200,000 throws `RangeError: Maximum call
       * stack size exceeded`. `APP_LOAD_CEILING` is 500,000, so a min or max
       * over a stream holding more than roughly 150k records in the window did
       * not return a wrong number — it threw, and the node reported an error
       * the user could do nothing about. Every other aggregation here is a
       * reduce, which is why only these two ever hit it.
       *
       * A higher threshold would still be a threshold. A spread over a
       * collection with no fixed bound is the defect; the loop removes the
       * class rather than moving the number.
       */
      let best = nums[0];
      if (aggregation === "min") {
        for (const n of nums) if (n < best) best = n;
      } else {
        for (const n of nums) if (n > best) best = n;
      }
      return best;
    }
  }
}

function groupByField(records: FlowRecord[], cfg: GroupConfig): Array<{ label: string; value: number }> {
  const groups = new Map<string, FlowRecord[]>();
  for (const r of records) {
    const key = String(getField(r, cfg.field) ?? "—");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  return [...groups.entries()]
    .map(([label, recs]) => ({ label, value: computeAgg(recs, cfg.aggregation, cfg.valueField, cfg.distinctField) }))
    .sort((a, b) => b.value - a.value);
}

function groupByCategories(records: FlowRecord[], cfg: GroupConfig): Array<{ label: string; value: number }> {
  const buckets = new Map<string, FlowRecord[]>();
  for (const c of cfg.categories) buckets.set(c.label, []);
  buckets.set(cfg.fallbackLabel, []);
  for (const r of records) {
    const cat = cfg.categories.find((c) => evalRules(r, c.filters));
    buckets.get(cat ? cat.label : cfg.fallbackLabel)!.push(r);
  }
  return [...buckets.entries()].map(([label, recs]) => ({ label, value: computeAgg(recs, cfg.aggregation, cfg.valueField, cfg.distinctField) }));
}

// ---------- time windows ----------
function timeWindow(cfg: { mode: string; preset: string; from?: string; to?: string; days: number }): { start: number; end: number } {
  const now = Date.now();
  if (cfg.mode === "between") return { start: dateMs(cfg.from ?? "") ?? 0, end: dateMs(cfg.to ?? "") ?? now };
  if (cfg.mode === "rolling") return { start: now - cfg.days * 86_400_000, end: now };

  const d = new Date();
  const startOfDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = (d.getUTCDay() + 6) % 7; // Monday=0
  const startOfWeek = startOfDay - dow * 86_400_000;
  const startOfMonth = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const day = 86_400_000;
  switch (cfg.preset) {
    case "today":
      return { start: startOfDay, end: now };
    case "yesterday":
      return { start: startOfDay - day, end: startOfDay - 1 };
    case "this_week":
      return { start: startOfWeek, end: now };
    case "last_week":
      return { start: startOfWeek - 7 * day, end: startOfWeek - 1 };
    case "this_month":
      return { start: startOfMonth, end: now };
    case "last_month": {
      const startPrev = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1);
      return { start: startPrev, end: startOfMonth - 1 };
    }
    case "last_7_days":
      return { start: now - 7 * day, end: now };
    case "last_30_days":
      return { start: now - 30 * day, end: now };
    case "last_90_days":
      return { start: now - 90 * day, end: now };
    case "last_365_days":
      return { start: now - 365 * day, end: now };
    default:
      return { start: 0, end: now };
  }
}

// ---------- generic helpers ----------
function requireDataset(inputs: ResolvedInput[], nodeName: string): Dataset {
  const input = inputs[0];
  if (!input) throw new Error(`${nodeName} needs a connected input.`);
  if (input.shape.kind !== "dataset") throw new Error(`${nodeName} expects records, not a ${input.shape.kind}.`);
  return input.shape;
}
function num(v: unknown): number | null {
  return toNumber(v);
}
function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
function splitList(v: string): string[] {
  return v.split(",").map((s) => s.trim());
}
function dateMs(v: unknown): number | null {
  if (v == null || v === "") return null;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : t;
}

function bucketKey(iso: string, unit: "day" | "week" | "month" | "quarter" | "year"): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  switch (unit) {
    case "year":
      return String(y);
    case "month":
      return iso.slice(0, 7);
    case "quarter":
      return `${y}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    case "week": {
      const w = isoWeek(d);
      return `${w.year}-W${String(w.week).padStart(2, "0")}`;
    }
    case "day":
    default:
      return iso.slice(0, 10);
  }
}

function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return { year: d.getUTCFullYear(), week };
}

export function topoSort(graph: FlowGraph): string[] {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of graph.edges) {
    if (!indeg.has(e.target) || !adj.has(e.source)) continue;
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    adj.get(e.source)!.push(e.target);
  }
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adj.get(id) ?? []) {
      indeg.set(next, (indeg.get(next) ?? 0) - 1);
      if (indeg.get(next) === 0) queue.push(next);
    }
  }
  return order;
}

function ancestorsOf(target: string, incoming: Map<string, FlowGraph["edges"]>): Set<string> {
  const seen = new Set<string>([target]);
  const stack = [target];
  while (stack.length) {
    const id = stack.pop()!;
    for (const e of incoming.get(id) ?? []) {
      if (!seen.has(e.source)) {
        seen.add(e.source);
        stack.push(e.source);
      }
    }
  }
  return seen;
}
