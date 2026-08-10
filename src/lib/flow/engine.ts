import { and, desc, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { ZodError } from "zod";
import { connections, events } from "@/db/schema";
import type { DB } from "@/db/types";
import { eventToRecord, getField, toNumber, STANDARD_FIELDS, type FlowRecord } from "./records";
import { planPushdown } from "./compile/pushdown";
import { compileRule } from "./compile/operators";
import { inferSchema, buildFieldInfo, isEmptyValue, trimExample, type FieldInfo } from "./schema-infer";
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
  type KeepDirection,
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
  /** What "Remove duplicates" actually did on this run, measured rather than predicted. */
  dedupe?: DedupeReport;
  /** What Time between actually paired, so the dropped keys are never silent. */
  pairing?: PairingReport;
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
    return err(configErrorMessage(e));
  }
}

/**
 * A step's error, in a sentence.
 *
 * A `ZodError`'s `.message` in zod v4 IS the JSON issues array, and it went
 * straight onto the node card and into the Test panel. The most ordinary state
 * in the whole builder produced it: click "+ Add condition", don't fill the
 * field in yet, hit Test, and read `[{"code":"too_small","minimum":1,...`.
 */
function configErrorMessage(e: unknown): string {
  if (e instanceof ZodError) {
    const issue = e.issues[0];
    const path = (issue?.path ?? []).map(String);
    if (path[0] === "rules") return "A condition on this step has no field chosen yet.";
    if (path.includes("categories")) return "A category on this step is missing something — open it and finish the row.";
    if (path.includes("paths")) return "A branch on this step is missing something — open it and finish the row.";
    const where = path.length > 0 ? ` (${path.join(".")})` : "";
    return `This step isn't set up yet${where}.`;
  }
  return e instanceof Error ? e.message : String(e);
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
async function registeredAppFields(ctx: EngineCtx, cfg: AppConfig, pinned: ReadonlySet<string> = new Set()): Promise<FieldInfo[] | null> {
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
    // Paths a saved step already points at are exempt from every emptiness
    // rule below. A picker missing its own value reads as broken: the pill
    // goes amber with "this field's source is missing", the operator list
    // degrades to textual, and a Filter's picker is pick-only, so there is no
    // way to choose it again.
    const pins = new Set<string>();
    for (const p of pinned) pins.add(p.replace(/^properties\./, ""));
    if (typeof cfg.dedupeField === "string" && cfg.dedupeField) pins.add(cfg.dedupeField.replace(/^properties\./, ""));

    for (const f of [...fields].sort((a, b) => a.fieldPath.localeCompare(b.fieldPath))) {
      if (f.fieldPath.startsWith("__")) continue; // internal engine keys are never fields
      // The registry stores the example wrapped (`{ value: … }`) so a jsonb
      // column can hold a bare scalar; unwrap before inferring, or every field
      // types as "object" and the picker shows the wrong icon for all of them.
      const example = (f.sample as { value?: unknown } | null)?.value;
      if (!pins.has(f.fieldPath)) {
        // Never once held a value across everything ever synced on this
        // connection — a provider column this account does not use.
        if (f.approxCardinality === 0) continue;
        // A row written before the writer knew "" is not a value. Exactly one
        // distinct value ever recorded, and that one value is blank, IS
        // "never held a value": under the old rule a column that ever held a
        // real value alongside a blank would have counted TWO distinct
        // strings. The upsert's greatest() can only raise a cardinality, so
        // this read is the only repair short of a backfill.
        if (f.approxCardinality === 1 && isEmptyValue(example)) continue;
      }
      out.push(buildFieldInfo(`properties.${f.fieldPath}`, f.fieldPath, trimExample(example)));
    }
    return out;
  } catch {
    // The picker must never fail because a diagnostic table is unavailable.
    return null;
  }
}

/** Runaway guard only — a real Close connection is ~750 registry paths plus <=600 scanned. */
const MAX_UNION_FIELDS = 2_000;

/**
 * Every field this step's APP has ever carried a value for, merged with what
 * this run actually loaded.
 *
 * ONE RULE: a path is offered iff at least one record from this app has ever
 * carried a value for it. "This app" is the CONNECTION, deliberately not the
 * record type — so a Filter fed by a Calls step offers data.pipeline_id
 * exactly like the Get data step above it, because both are asking "what does
 * this app have". That breadth is the chosen answer, not an accident: the
 * registry has no event_type column, and narrowing to the record type is what
 * made pipeline vanish from a picker that had been offering it.
 *
 * The run's own records win where both know a path — they carry a real
 * example and a real populated count. The registry contributes the rest, and
 * is the ONLY thing allowed to call a field empty, because it is the only
 * app-wide answer; a 200-record sample is a sample, and a sample is never
 * grounds for hiding.
 */
export async function appFieldUnion(
  ctx: EngineCtx,
  config: unknown,
  loaded: FieldInfo[],
  pinned: ReadonlySet<string> = new Set(),
): Promise<FieldInfo[]> {
  const cfg = AppConfigSchema.parse(config ?? {});
  const registered = await registeredAppFields(ctx, cfg, pinned);
  // No app-wide answer (no connection chosen, nothing registered yet, or the
  // table is unavailable). The step's own records are then the only evidence
  // there is — never an empty picker.
  if (!registered) return loaded;

  const known = new Set(registered.map((f) => f.path));
  const out: FieldInfo[] = [];
  const taken = new Set<string>();
  // Record-derived fields first, so a Calls step still OPENS on call fields
  // with real samples; the app's other fields sit behind them, searchable.
  for (const f of loaded) {
    if (f.populated === 0 && !known.has(f.path) && !pinned.has(f.path)) continue;
    taken.add(f.path);
    // `populated: 0` means "empty everywhere" to the picker, and the registry
    // has just said otherwise. Publish no count rather than a false zero.
    out.push(f.populated === 0 ? { ...f, populated: undefined } : f);
  }
  for (const f of registered) if (!taken.has(f.path)) out.push(f);
  return out.length > MAX_UNION_FIELDS ? out.slice(0, MAX_UNION_FIELDS) : out;
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
  // Keep one per identity at the source — the FIRST thing that happens, before
  // any later step runs, so a duplicate never costs downstream work.
  let dedupe: DedupeReport | undefined;
  if (cfg.dedupe) {
    const field = cfg.dedupeField || "subject";
    const res = keepOnePerGroup(records, { groupField: field, keep: cfg.dedupeKeep, orderField: cfg.dedupeOrderField });
    records = res.records;
    dedupe = { field, keep: cfg.dedupeKeep, orderField: cfg.dedupeOrderField, ...res.report };
  }
  const exec = dedupe ? { ...datasetExec("app", node.id, records, rows.length), dedupe } : datasetExec("app", node.id, records, rows.length);
  // Never silently truncate: if the ceiling was actually hit, the node says so.
  if (rows.length >= APP_LOAD_CEILING && exec.status === "ok") {
    return { ...exec, truncated: true } as NodeExec;
  }
  return exec;
}

/**
 * Keep one record per identity value; empty identities always pass.
 *
 * WHICH ONE SURVIVES IS COMPARED, NOT INHERITED. This used to keep whichever
 * record it saw first and rely on `execApp` loading newest-first — a sort
 * order that lived in a different function, was never shown to anyone, and
 * could not be asked for. Someone who wanted the FIRST call to each lead
 * ticked the box, got the last one, and read a 24-hour speed-to-lead. Now the
 * ordering field and the direction are both arguments, so the answer is
 * whatever the panel says it is.
 *
 * It also COUNTS how many records the group field actually resolved on. A
 * field that exists nowhere in the data removes nothing, raises nothing, and
 * looks identical to a dedupe that found no duplicates — which is how a Close
 * user matched calls on `data.number`, a field belonging to a different Close
 * object entirely, and got a silent no-op with the box ticked.
 */
export type DedupeReport = { field: string; keep: KeepDirection; orderField: string; loaded: number; matched: number; removed: number };

export function keepOnePerGroup(
  records: FlowRecord[],
  cfg: { groupField: string; keep: KeepDirection; orderField: string },
): { records: FlowRecord[]; report: { loaded: number; matched: number; removed: number } } {
  // Position is kept so the survivor is emitted where its group FIRST appeared.
  // The dataset's order is load-bearing downstream (topPreview, the newest-first
  // contract execApp documents), so choosing a different record must not also
  // reorder the stream.
  const best = new Map<string, { rec: FlowRecord; at: number | null; pos: number }>();
  const passthrough: Array<{ rec: FlowRecord; pos: number }> = [];
  let matched = 0;
  records.forEach((r, pos) => {
    const key = String(getField(r, cfg.groupField) ?? "").trim();
    if (key === "") {
      // No identity, so it cannot be a duplicate of anything.
      passthrough.push({ rec: r, pos });
      return;
    }
    matched++;
    const at = orderValue(r, cfg.orderField);
    const cur = best.get(key);
    if (!cur) {
      best.set(key, { rec: r, at, pos });
      return;
    }
    // A record with no orderable value never beats one that has it; a group
    // where nothing is orderable keeps the first it saw.
    if (at == null) return;
    // Strictly better only. `>=` here would reverse tie order, and a tie is
    // exactly what the old load-order rule already decided.
    const better = cur.at == null || (cfg.keep === "latest" ? at > cur.at : at < cur.at);
    if (better) best.set(key, { rec: r, at, pos: cur.pos });
  });

  const merged = [...passthrough, ...[...best.values()].map((b) => ({ rec: b.rec, pos: b.pos }))];
  merged.sort((a, b) => a.pos - b.pos);
  const out = merged.map((m) => m.rec);
  return { records: out, report: { loaded: records.length, matched, removed: records.length - out.length } };
}

/** A field's value as something orderable: a moment, or a plain number. */
function orderValue(r: FlowRecord, field: string): number | null {
  const v = getField(r, field);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  return dateMs(v);
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
/**
 * The pairing primitive nothing else in the engine has: per distinct
 * `keyField` value, the earliest start moment is matched with the first stop
 * moment at-or-after it, and ONE record per match is emitted carrying the gap
 * as plain numbers under `properties.time_between`.
 *
 * Three load-bearing choices:
 * - Picked variables, not a bespoke config: which moment starts the clock is a
 *   field path plus the step that produced it, chosen from the same data
 *   browser as everything else. See TimeBetweenConfigSchema for why the step
 *   is part of the choice.
 * - The gap is a NUMBER, not a date pair: the existing avg/median/min/max never
 *   learned to read timestamps, and they don't have to.
 * - "First at-or-after": a call BEFORE the lead existed (a re-imported history
 *   overlap, a mismatched key) must never count as the response to it.
 *   Unmatched keys emit NOTHING — a lead never called has no duration, and
 *   emitting 0 would drag every average toward a lie.
 */
/** What pairing actually did — the denominator a median would otherwise hide. */
export type PairingReport = { keys: number; started: number; matched: number; noStop: number; stopBeforeStart: number };

function execTimeBetween(node: FlowNode, inputs: ResolvedInput[]): NodeExec {
  const cfg = TimeBetweenConfigSchema.parse(node.data.config ?? {});
  const input = requireDataset(inputs, "Time between");
  if (!cfg.keyField || !cfg.startField || !cfg.endField) {
    throw new Error("Time between needs a matching field, a start time and a stop time.");
  }
  /**
   * AN UNSET LANE ON A COMBINED STREAM IS AMBIGUOUS, AND USED TO PUBLISH CLEAN.
   *
   * An empty step means "any record carrying this field", which is right for
   * the one-record case (a call's created → answered) and catastrophic after a
   * Combine: leads and calls both carry `occurredAt`, so the clock starts on
   * whichever record came first — measuring call → call and reporting a
   * speed-to-lead near zero, with a green badge.
   *
   * Every dataset step stamps `__count_<id>` on what it emits (datasetExec)
   * and stamps travel, so a record's stamp SET names the path it came down.
   * More than one distinct set means lanes were combined, and an unset side is
   * then a question the step cannot answer for itself.
   */
  const laneSig = (r: FlowRecord) =>
    Object.keys(r.properties ?? {})
      .filter((k) => k.startsWith("__count_"))
      .sort()
      .join(",");
  if (!cfg.startStep || !cfg.endStep) {
    let firstSig: string | null = null;
    for (const r of input.records) {
      const sig = laneSig(r);
      if (firstSig == null) firstSig = sig;
      else if (sig !== firstSig) {
        throw new Error(
          "This step is reading records from more than one earlier step, so it can't tell which ones start the clock and which ones stop it. Pick the step beside each time.",
        );
      }
    }
  }
  // Which lane a record came from. No step chosen = any record carrying the
  // field, which after the guard above can only be the one-record case.
  const fromLane = (r: FlowRecord, stepId: string) => !stepId || getField(r, `properties.__count_${stepId}`) !== undefined;

  type Pair = { start: FlowRecord | null; startAt: number | null; ends: Array<{ at: number; id: string }> };
  const byKey = new Map<string, Pair>();
  for (const r of input.records) {
    const keyRaw = getField(r, cfg.keyField);
    const key = typeof keyRaw === "string" ? keyRaw : keyRaw != null ? String(keyRaw) : "";
    if (!key) continue; // no key, no honest match
    let pair = byKey.get(key);
    if (!pair) {
      pair = { start: null, startAt: null, ends: [] };
      byKey.set(key, pair);
    }
    if (fromLane(r, cfg.startStep)) {
      const at = dateMs(getField(r, cfg.startField));
      if (at != null && (pair.startAt == null || at < pair.startAt)) {
        pair.startAt = at;
        pair.start = r;
      }
    }
    if (fromLane(r, cfg.endStep)) {
      const at = dateMs(getField(r, cfg.endField));
      if (at != null) pair.ends.push({ at, id: r.id });
    }
  }

  const out: FlowRecord[] = [];
  // The denominator is the thing a median hides. "Median speed to lead" over
  // only the leads that were EVER called is a different question from the one
  // the tile's name asks, and dropping the rest was silent.
  let started = 0;
  let noStop = 0;
  let stopBeforeStart = 0;
  for (const [key, pair] of byKey) {
    if (pair.start == null || pair.startAt == null) continue;
    started++;
    const from = pair.startAt;
    // Loop, not spread/filter chains — same stack-bound discipline as
    // computeAgg's min/max. A record is excluded from being its own end only
    // when both sides read the SAME field, where it would be a zero-length
    // self-pair; reading two different fields off one record (created →
    // answered) is the whole point of leaving the step unset.
    const sameSide = cfg.startField === cfg.endField;
    let toAt: number | null = null;
    for (const e of pair.ends) {
      if (e.at < from || (sameSide && e.id === pair.start.id)) continue;
      if (toAt == null || e.at < toAt) toAt = e.at;
    }
    if (toAt == null) {
      if (pair.ends.length > 0) stopBeforeStart++;
      else noStop++;
      continue;
    }
    const gap = toAt - from;
    out.push({
      // THE OUTPUT IS THE START RECORD, ANNOTATED — not a fabricated one, so a
      // later Filter can still read properties.lead_id.
      ...pair.start,
      // The pairing key, not the start record's own subject. `subject` is the
      // default of every count-distinct in the product, and on a paired record
      // the thing being counted is the key — a Close lead row carries
      // subject: null, which would have made "how many leads got called" read 0.
      subject: key,
      properties: {
        ...pair.start.properties,
        // Namespaced, and that is not cosmetic: these used to be written as
        // bare `duration`/`key`/`from_at`/`to_at`, which OVERWROTE a source
        // column of the same name. A Sheets column or a Close call's own
        // `duration` is exactly the data this step gets pointed at.
        time_between: {
          key,
          from_at: new Date(from).toISOString(),
          to_at: new Date(toAt).toISOString(),
          // Four units as plain numbers: pick the one that reads well and hand
          // it to a Calculate, which already knows how to average a number.
          seconds: gap / 1_000,
          minutes: gap / 60_000,
          hours: gap / 3_600_000,
          days: gap / 86_400_000,
        },
      },
    });
  }
  const pairing: PairingReport = { keys: byKey.size, started, matched: out.length, noStop, stopBeforeStart };
  return { ...datasetExec("time_between", node.id, out, input.records.length), pairing };
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
  // PER PATH, not once for the hub. This was `cfg.paths.some(...)`, so a
  // single legacy path made every OTHER branch read the hub's rules — which
  // they do not have — so they claimed nothing and the fallback swallowed
  // everything.
  const isLegacyPath = (p: { filters?: FilterConfig }) => (p.filters?.rules?.length ?? 0) > 0;
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const condsOf = (p: { id: string; filters?: FilterConfig }): FilterConfig | null => {
    if (isLegacyPath(p)) return p.filters ?? null;
    const edge = graph.edges.find((e) => e.source === node.id && e.sourceHandle === p.id);
    const first = edge ? nodeById.get(edge.target) : undefined;
    return first?.type === "filter" ? FilterConfigSchema.parse(first.data.config ?? {}) : null;
  };
  const hasConds = (c: FilterConfig | null): c is FilterConfig => !!c && c.rules.length > 0;

  /**
   * Does a record continue down at least one custom branch? (Fallback = the rest.)
   *
   * ONE RULE: a branch claims a record only if it HAS conditions and they
   * match. A branch you have added but not configured yet used to claim
   * everything, which silently emptied the "everything else" lane — the one
   * place the loss is invisible, because that branch simply reports zero and
   * looks like a true answer. An unconfigured branch still passes everything
   * down its own lane, where you can see it.
   */
  const customPaths = cfg.paths.filter((p) => p.mode === "custom");
  const matchedAny = (r: FlowRecord) =>
    customPaths.some((p) => {
      const c = condsOf(p);
      return hasConds(c) && evalRules(r, c);
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
      outputs[p.id] = { kind: "dataset", records: isLegacyPath(p) && hasConds(c) ? records.filter((r) => evalRules(r, c)) : records };
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
  durationDisplay?: string;
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
    durationDisplay: spec.durationDisplay,
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
    const key = groupKey(getField(r, field));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  return {
    kind: "grouped",
    groups: [...groups.entries()].map(([label, recs]) => ({ label, value: computeAgg(recs, cfg.aggregation, cfg.field, cfg.distinctField) })).sort((a, b) => b.value - a.value),
    total: computeAgg(records, cfg.aggregation, cfg.field, cfg.distinctField),
  };
}

/** Records arrived, the chosen field held nothing in any of them. Names the fix. */
class EmptyFieldError extends Error {
  constructor(field: string, count: number, what: string) {
    const name = field.replace(/^properties\./, "") || "(no field chosen)";
    super(
      `Can't ${what} "${name}" — none of the ${count.toLocaleString()} records here have a value in that field. Pick the field that holds the number.`,
    );
  }
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
      // Records went in and nothing came out: the field is empty on all of
      // them. See the note below — a confident 0 is the worst answer here.
      if (set.size === 0 && records.length > 0) throw new EmptyFieldError(distinctField, records.length, "count unique values of");
      return set.size;
    }
    default: {
      const nums = records.map((r) => num(getField(r, field))).filter((n): n is number => n != null);
      /**
       * A CONFIDENT ZERO IS THE WORST POSSIBLE ANSWER.
       *
       * This returned 0 whenever nothing numeric was found, which reads as a
       * real measurement: "Average deal value: $0" in a big bold box with a
       * green Ready badge. The default field is `value`, and Close never
       * populates it — so the most likely first thing anyone builds on Close
       * produced a plausible, wrong, unquestioned number.
       *
       * Zero records is a different case and stays 0: an empty week really is
       * an empty week, and erroring there would turn every quiet Monday red.
       */
      if (nums.length === 0) {
        if (records.length === 0) return 0;
        throw new EmptyFieldError(field, records.length, aggregation);
      }
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
    const key = groupKey(getField(r, cfg.field));
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
  if (cfg.mode === "between") {
    /**
     * A DATE-ONLY "To" MEANS THE WHOLE OF THAT DAY.
     *
     * The control is <input type="date">, so "To: 31 Aug" arrived as
     * "2026-08-31" and parsed to midnight — excluding almost everything that
     * happened on the last day of the range. Every custom-range metric was
     * short by up to a day, silently, and the shorter the range the larger the
     * error: a one-day range measured nothing at all.
     *
     * Guarded on the date-only shape, so a hand-typed ISO datetime keeps the
     * exact instant it names.
     */
    const to = cfg.to ?? "";
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(to.trim());
    const parsedTo = dateMs(to);
    return {
      start: dateMs(cfg.from ?? "") ?? 0,
      end: parsedTo == null ? now : dateOnly ? parsedTo + 86_399_999 : parsedTo,
    };
  }
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
  // Reading inputs[0] and ignoring the rest silently discarded whole lanes,
  // and WHICH lane survived depended on the order the edges happened to be
  // created in. A step that reads one stream must say so rather than choose.
  if (inputs.length > 1) {
    throw new Error(`${nodeName} reads records from one step, but ${inputs.length} are wired into it. Add a Combine data step to bring them together first.`);
  }
  return input.shape;
}
/**
 * A group's label. Records with no value used to become a category literally
 * named "—", indistinguishable from a real one — and they merged with any
 * record whose value WAS the string "—".
 */
function groupKey(v: unknown): string {
  return v == null || v === "" ? "(not set)" : String(v);
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
/**
 * A moment, or nothing.
 *
 * This was `Date.parse(String(v))`, which reads a bare number as a YEAR:
 * `Date.parse("42")` is the year 2042 and `Date.parse("1994")` is 1994. So a
 * numeric field offered as a start time — a call's duration in seconds, a
 * count, an amount — produced a plausible multi-century gap instead of
 * refusing. A number here is an epoch or it is not a moment at all.
 */
const EPOCH_SECONDS_FLOOR = 1e9; // ~2001 in seconds; below this a number is not a timestamp
const EPOCH_MS_FLOOR = 1e11; // ~1973 in ms

function dateMs(v: unknown): number | null {
  if (v == null || v === "") return null;
  const asNumber = typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v.trim()) ? Number(v) : null;
  if (asNumber != null) {
    if (!Number.isFinite(asNumber)) return null;
    if (Math.abs(asNumber) >= EPOCH_MS_FLOOR) return asNumber;
    if (Math.abs(asNumber) >= EPOCH_SECONDS_FLOOR) return asNumber * 1000;
    return null; // too small to be a timestamp in either unit
  }
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
