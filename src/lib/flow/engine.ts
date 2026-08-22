import { and, desc, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { ZodError } from "zod";
import { connections, events } from "@/db/schema";
import type { DB } from "@/db/types";
import { eventToRecord, getField, toNumber, STANDARD_FIELDS, type FlowRecord } from "./records";
import { planPushdown } from "./compile/pushdown";
import { readsRecords, recordsSourceOf } from "./shapes";
import { compileRule } from "./compile/operators";
import { inferSchema, presenceByPath, buildFieldInfo, isEmptyValue, trimExample, type FieldInfo } from "./schema-infer";
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
  UniteConfigSchema,
  type CrossRefMode,
  FormulaConfigSchema,
  GroupConfigSchema,
  CalculateConfigSchema,
  PathsConfigSchema,
  isDatasetFormulaOp,
  aggregationFields,
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
  /**
   * Compute per-record-type field presence on app reads (see presenceByPath).
   * Set by the Test path, which feeds the pickers; a materialize never reads
   * outputSchema, so it never pays for the walk.
   */
  fieldPresence?: boolean;
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
  /** What Cross-reference actually matched — the receipt for every kept/dropped record. */
  crossRef?: CrossRefReport;
  /**
   * App steps with a specific record type: path → records carrying a value,
   * counted over EVERY loaded record. The full truth the Test's picker may
   * hide on — a sampled count never is (see presenceByPath).
   */
  fieldPresence?: Map<string, number>;
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
    const reachBack = recordsReachBack(node, inputs, graph, (nid) => nodes.get(nid));
    if (reachBack) inputs.push(reachBack);

    const exec = await execNode(ctx, node, inputs, inputError, graph);
    nodes.set(id, exec);
    if (node.type === "output" && exec.status === "ok" && exec.tile) {
      outputs.push({ nodeId: id, tile: exec.tile });
    }
  }

  return { nodes, outputs };
}

/**
 * THE RECORDS A STEP READS WHEN THE STEP ABOVE IT HAS NONE TO GIVE.
 *
 * A Calculate consumes records and emits a number, so stacking a second one
 * under it left nothing to read — and the canvas offers no way to branch,
 * because "+ Add next step" appears only on a step with nothing after it. Two
 * aggregations of one sheet ("total calls" AND "total pickups") were therefore
 * unbuildable, while the second step's own field picker offered that sheet's
 * columns: the product promising exactly what the engine then refused.
 *
 * So a records-reading step with no record input reaches back to the nearest
 * step above it that has some. Returns null in every other case — including
 * when the step already has its records, which is the ordinary path and stays
 * byte-for-byte unchanged.
 */
function recordsReachBack(
  node: FlowNode,
  inputs: ResolvedInput[],
  graph: FlowGraph,
  execOf: (id: string) => NodeExec | undefined,
): ResolvedInput | null {
  const cfg = (node.data.config ?? {}) as Record<string, unknown>;
  if (!readsRecords(node.type, cfg)) return null;
  if (inputs.some((i) => i.targetHandle == null && i.shape.kind === "dataset")) return null;
  const src = recordsSourceOf(graph, node.id);
  if (!src) return null;
  const se = execOf(src.nodeId);
  if (!se || se.status !== "ok") return null;
  const shape = src.sourceHandle && se.outputs?.[src.sourceHandle] ? se.outputs[src.sourceHandle] : se.shape;
  if (shape.kind !== "dataset") return null;
  return { shape, exec: se, targetHandle: null, sourceNodeId: src.nodeId };
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

/**
 * The columns a Get-data read SELECTs — exactly the ones `eventToRecord`
 * consumes, nothing else. `select *` here shipped `event_id`, the harvested
 * `identifiers` jsonb and the rest of the row's bookkeeping out of the
 * database on every read of every materialize, to be discarded in the very
 * next line. Egress is billed by the byte and this is the hottest read in the
 * product; the keyset cursor needs only `occurred_at` and `id`, both present.
 */
type AppRow = {
  [K in keyof typeof RECORD_COLUMNS]: (typeof events.$inferSelect)[K];
};

const RECORD_COLUMNS = {
  id: events.id,
  source: events.source,
  eventType: events.eventType,
  subject: events.subject,
  occurredAt: events.occurredAt,
  value: events.value,
  currency: events.currency,
  connectionId: events.connectionId,
  properties: events.properties,
};

/** The org-scoped WHERE for a Get data step (shared by the executor and field sampling). */
function appConds(orgId: string, cfg: AppConfig, source: string | null): SQL[] {
  const conds: SQL[] = [sql`${events.orgId} = ${orgId}`, isNull(events.deletedAt)];
  /**
   * NO DASHBOARD RANGE IS APPLIED HERE, deliberately — see `tileByRange`.
   *
   * Bounding `occurred_at` at the READ looks cheaper and is wrong. It truncates
   * every lane before the flow's own logic runs, so a de-duplicating step picks
   * the earliest record OF THAT WINDOW rather than the genuine first, and a
   * pairing step loses any pair that straddles the boundary — a lead that
   * arrived yesterday at 18:00 and was called today at 09:00 was counted in
   * neither day, and a measured gap could never exceed the window's own length,
   * so "median speed to lead" fell the more the range was narrowed.
   *
   * The range is applied to the finished metric's records instead. The flow
   * always sees the whole history it was written against.
   */
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

  // A specific record type reads as ITS OWN fields, even before a test: the
  // newest records of the type are the evidence, and fields empty on all of
  // them are dropped. The registry — which spans every record type on the
  // connection — only fills in when the type has no records at all. This is
  // what keeps a meeting's attendee emails out of a "Contact created" picker,
  // with examples that come from contacts instead of whichever event the
  // registry sampled last. Saved dedupe paths are pinned: a picker missing
  // its own value reads as broken.
  if (cfg.eventType && cfg.connectionId) {
    const rows = await ctx.db
      .select(RECORD_COLUMNS)
      .from(events)
      .where(and(...appConds(ctx.orgId, cfg, await appSource(ctx, cfg))))
      .orderBy(desc(events.occurredAt))
      .limit(Math.max(limit, 200));
    if (rows.length > 0) {
      const strip = (p: string) => p.replace(/^properties\./, "");
      const pins = new Set<string>();
      if (typeof cfg.dedupeField === "string" && cfg.dedupeField) pins.add(strip(cfg.dedupeField));
      if (typeof cfg.dedupeOrderField === "string" && cfg.dedupeOrderField) pins.add(strip(cfg.dedupeOrderField));
      // `populated` here is exact over the scanned rows (<= SHAPE_SAMPLE), so
      // it may hide; the Test then recomputes over the full record set.
      return inferSchema(rows.map(eventToRecord)).filter((f) => !f.path.startsWith("properties.") || (f.populated ?? 0) > 0 || pins.has(strip(f.path)));
    }
  }

  // A.1: the field registry the writer maintains. It knows the UNION of
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
    .select(RECORD_COLUMNS)
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
 * Every field this step offers, merged from what this run loaded and what the
 * registry knows — in one of two regimes, decided by the evidence available:
 *
 * WITH `presence` (a specific record type, fully loaded): a path is offered
 * iff at least one record OF THIS RECORD TYPE carries a value — counted over
 * every record, not a sample. This is what keeps a meeting's attendee emails
 * out of a "Contact created" picker whose contacts never carry them, with
 * example values that belong to this record type instead of whichever event
 * the registry sampled last. The registry contributes nothing here: its
 * breadth spans the whole connection, which is exactly the noise.
 *
 * WITHOUT presence ("All record types", a truncated read, or an overflowing
 * shape): a path is offered iff at least one record from this CONNECTION has
 * ever carried a value. That breadth is deliberate — pipeline fields live
 * only on opportunity events and must still be findable from an all-types
 * read — and the registry is the only thing allowed to call a field empty,
 * because a 200-record sample is never grounds for hiding.
 *
 * In both regimes the run's own records win where both know a path (real
 * examples, real counts), and saved paths are pinned so a picker is never
 * missing its own value.
 */
export async function appFieldUnion(
  ctx: EngineCtx,
  config: unknown,
  loaded: FieldInfo[],
  pinned: ReadonlySet<string> = new Set(),
  presence: Map<string, number> | null = null,
): Promise<FieldInfo[]> {
  const cfg = AppConfigSchema.parse(config ?? {});
  const registered = await registeredAppFields(ctx, cfg, pinned);
  const carried = (path: string): boolean => {
    if (!presence) return true;
    if (!path.startsWith("properties.")) return true; // the spine is on every record by construction
    return (presence.get(path.slice("properties.".length)) ?? 0) > 0;
  };
  // No app-wide answer (no connection chosen, nothing registered yet, or the
  // table is unavailable). The step's own records are then the only evidence
  // there is — never an empty picker (though presence still prunes it).
  if (!registered) return presence ? loaded.filter((f) => pinned.has(f.path) || carried(f.path)) : loaded;

  const known = new Set(registered.map((f) => f.path));
  const out: FieldInfo[] = [];
  const taken = new Set<string>();
  // Record-derived fields first, so a Calls step still OPENS on call fields
  // with real samples; the app's other fields sit behind them, searchable.
  for (const f of loaded) {
    if (!pinned.has(f.path)) {
      if (presence) {
        // Full per-type truth: empty on every record of this type is hidden.
        if (!carried(f.path)) continue;
      } else if (f.populated === 0 && !known.has(f.path)) {
        continue;
      }
    }
    taken.add(f.path);
    // With presence, replace the sampled count with the true one; without it,
    // a sampled 0 the registry contradicts publishes no count rather than a
    // false zero.
    const trueCount = presence && f.path.startsWith("properties.") ? presence.get(f.path.slice("properties.".length)) : undefined;
    out.push(trueCount !== undefined ? { ...f, populated: trueCount } : f.populated === 0 ? { ...f, populated: undefined } : f);
  }
  for (const f of registered) {
    if (taken.has(f.path)) continue;
    if (!pinned.has(f.path) && !carried(f.path)) continue;
    out.push(f);
  }
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

  const rows: AppRow[] = [];
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
      .select(RECORD_COLUMNS)
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

    let batch: AppRow[];
    try {
      batch = await query;
    } catch (e) {
      // The driver's own text is a wall of SQL with no advice in it. Say what
      // to DO, then keep the cause — this wrapper exists because a customer
      // hit an unexplained failure loading every record type at once, and the
      // next occurrence has to name itself.
      const cause = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Couldn't load this step's records — the read failed partway through${rows.length > 0 ? ` (after ${rows.length.toLocaleString("en-US")} records)` : ""}. Narrowing the Record type usually fixes it. Cause: ${cause.slice(0, 200)}`,
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
  // Per-record-type field presence — the full truth, not the 200-record
  // sample — computed only when this read IS the whole record type: a
  // specific type chosen, nothing truncated, and NO folded filter chain
  // (a pushdown restricts the rows to whatever the filters pass, and a
  // presence counted over won-deals-only would hide the lost-reason field
  // from the step's own picker). It is what lets the picker hide fields this
  // record type never carries, without ever hiding on a partial count's
  // say-so. Counted BEFORE dedupe: a field is real even if it only lives on
  // the copies that get collapsed.
  const fieldPresence =
    ctx.fieldPresence && cfg.eventType && folded.length === 0 && rows.length < APP_LOAD_CEILING ? (presenceByPath(records) ?? undefined) : undefined;
  // Keep one per identity at the source — the FIRST thing that happens, before
  // any later step runs, so a duplicate never costs downstream work.
  let dedupe: DedupeReport | undefined;
  if (cfg.dedupe) {
    const field = cfg.dedupeField || "subject";
    const res = keepOnePerGroup(records, { groupField: field, keep: cfg.dedupeKeep, orderField: cfg.dedupeOrderField || "occurredAt" });
    records = res.records;
    dedupe = { field, keep: cfg.dedupeKeep, orderField: cfg.dedupeOrderField || "occurredAt", ...res.report };
  }
  const exec: NodeExecOk = {
    ...datasetExec("app", node.id, records, rows.length),
    ...(dedupe ? { dedupe } : {}),
    ...(fieldPresence ? { fieldPresence } : {}),
  };
  // Never silently truncate: if the ceiling was actually hit, the node says so.
  if (rows.length >= APP_LOAD_CEILING) {
    return { ...exec, truncated: true };
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
export type DedupeReport = { field: string; keep: KeepDirection; orderField: string; loaded: number; matched: number; ordered: number; removed: number; groups: number };

export function keepOnePerGroup(
  records: FlowRecord[],
  cfg: { groupField: string; keep: KeepDirection; orderField: string },
): { records: FlowRecord[]; report: { loaded: number; matched: number; ordered: number; removed: number; groups: number } } {
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
  // How many records the ORDER field resolved on. Without it the receipt can
  // assert "kept the earliest occurredAt" while every value was unorderable
  // and the survivor was simply whichever loaded first.
  let ordered = 0;
  for (const b of best.values()) if (b.at != null) ordered++;
  // `groups` is the distinct-identity count this run actually saw — what the
  // receipt uses to say "this field is a category, not an identity" from
  // measurement, where the old registry-based warning guessed from
  // connection-wide stats and contradicted the receipt beside it.
  return { records: out, report: { loaded: records.length, matched, ordered, removed: records.length - out.length, groups: best.size } };
}

/**
 * A field's value as something orderable: a plain number, or a moment.
 *
 * Numeric STRINGS count. A Google Sheets column, a CSV import and most webhook
 * payloads store numbers as text, and routing those through `dateMs` returned
 * null for every record — so ordering silently fell back to load order, which
 * is precisely what this rewrite exists to remove, while the receipt went on
 * asserting it had kept the earliest or latest of the chosen field.
 */
function orderValue(r: FlowRecord, field: string): number | null {
  const v = getField(r, field);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return dateMs(v);
}

// ---------- Filter ----------
function execFilter(node: FlowNode, inputs: ResolvedInput[]): NodeExec {
  const cfg = FilterConfigSchema.parse(node.data.config ?? {});
  const input = requireDataset(inputs, "Filter");
  assertComparableFields(cfg, input.records);
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

/**
 * A field-vs-field condition whose two sides never occur on the same record
 * can never match — the classic mistaken join: Combine two apps, then compare
 * a field from each, where every record is from ONE app and so always misses
 * one side. Refusing with directions beats returning an empty (or, before the
 * both-blank guard, an exactly-wrong) result with a green badge.
 *
 * Checked over the step's full input, before any date window, so a narrow
 * week can't flip a valid comparison into an error. An empty input proves
 * nothing and is left alone.
 */
function assertComparableFields(cfg: FilterConfig, records: FlowRecord[]): void {
  if (records.length === 0) return;
  const present = (r: FlowRecord, f: string) => {
    const x = getField(r, f);
    return x != null && String(x).trim() !== "";
  };
  for (const rule of cfg.rules) {
    if (rule.valueKind !== "field" || !rule.valueField) continue;
    if (records.some((r) => present(r, rule.field) && present(r, rule.valueField!))) continue;
    const nice = (f: string) => f.replace(/^properties\./, "");
    throw new Error(
      `This condition compares "${nice(rule.field)}" with "${nice(rule.valueField)}", but no record here carries both — so it can never match. ` +
        `If they come from different apps, use a Combine data step with "Only keep records that match" turned on instead.`,
    );
  }
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
    const sameSide = cfg.startField === cfg.endField;
    // Loop, not spread/filter chains — same stack-bound discipline as
    // computeAgg's min/max. A record is excluded from being its own end only
    // when both sides read the SAME field, where it would be a zero-length
    // self-pair; reading two different fields off one record (created →
    // answered) is the whole point of leaving the step unset.
    let toAt: number | null = null;
    for (const e of pair.ends) {
      if (e.at < from || (sameSide && e.id === pair.start.id)) continue;
      if (toAt == null || e.at < toAt) toAt = e.at;
    }
    if (toAt == null) {
      // Only a genuine stop that lands BEFORE the start counts as that. A key
      // whose single record was excluded as its own end simply never got one.
      const realEnds = pair.ends.filter((e) => !(sameSide && e.id === pair.start!.id));
      if (realEnds.length > 0) stopBeforeStart++;
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
  const cfg = UniteConfigSchema.parse(node.data.config ?? {});
  if (inputs.length === 0) throw new Error("Unite needs at least one connected input.");
  const datasets = inputs.map((i) => {
    if (i.shape.kind !== "dataset") throw new Error("Unite only accepts record inputs.");
    return i.shape.records;
  });
  if (cfg.mode === "match") return matchUnite(node, inputs, cfg);
  const records = datasets.flat();
  return datasetExec("unite", node.id, records, records.length);
}

// ---------- Combine's match mode (the join primitive) ----------
/** What the match actually did, counted — never inferred from the config. */
export type CrossRefReport = {
  mode: CrossRefMode;
  keyField: string;
  lookupField: string;
  /** Records in the kept lane that were checked. */
  checked: number;
  kept: number;
  dropped: number;
  /** Kept-lane records with no value in `keyField` — they can never match. */
  blanks: number;
  /** Distinct non-blank values the other step supplied to check against. */
  listSize: number;
  /** Reference records that had no value in `lookupField`. */
  listBlanks: number;
  /**
   * How many values (both sides) were matched by their digits. Only ever
   * non-zero when BOTH chosen fields are phone fields by name (see
   * `phoneField`) — and non-zero makes the receipt say so, because silence
   * about a rewrite of the user's values is how a correct match reads as a
   * wrong one.
   */
  phones: number;
};

/**
 * A value as a MATCH KEY: trimmed and lowercased, blank collapsed to null.
 *
 * Case-insensitive on purpose, unlike the filter's `equals`. A join field is
 * an identity (an email, a phone, an id), and "Anna@x.com" failing to match
 * "anna@x.com" is a silently missing lead, not a semantic anyone chose. The
 * panel says so in words next to the picker.
 */
function matchKey(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  return s === "" ? null : s;
}

/**
 * A phone number reduced to the digits that identify the line.
 *
 * Two systems never store the same phone the same way — a form writes
 * `2086130936`, Close writes `+1 208-613-0936` — and exact-string matching
 * across that divide returns ZERO matches while looking like a working
 * feature. Measured on live data before this existed: 47 spreadsheet phones
 * against 299 CRM phones, 0 exact matches, 38 by digits.
 *
 * GATED ON THE FIELDS, NOT THE VALUES — see `phoneField`. Value shape alone
 * over-captures catastrophically: a compact timestamp `20250804093000`, a
 * fixed-precision decimal `1.5000000000` and a dashed serial are all "digits
 * plus separators, 10–15 digits", and keying those by their last 10 digits
 * cross-matched timestamps a year apart (the slice drops exactly the year)
 * and silently moved every existing match step built on a non-phone column.
 * Only when BOTH chosen fields are phone fields by name does this run at all.
 *
 * Within phone fields, a value is normalized only when it is nothing BUT a
 * phone: digits plus the separators people actually type (`+ ( ) - . space`),
 * with 10–15 digits (a full national number up to the E.164 maximum) — an
 * email in a phone column keeps exact matching. The key is the LAST 10
 * digits, the industry-standard CRM join: `+1` and its absence agree. Known
 * honest limits, stated in the receipt rather than papered over: a trunk-0
 * national form vs its E.164 form (France's `06…` vs `+33 6…`) do NOT agree,
 * and two countries' lines can share a 10-digit tail. The `tel:` prefix
 * keeps a normalized phone from colliding with a literal text value.
 */
function phoneKey(s: string): string | null {
  if (!/^[+()\-.\s\d]+$/.test(s)) return null;
  const digits = s.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  return `tel:${digits.slice(-10)}`;
}

/**
 * Is this field, by its own name, a phone field? Segment-wise on purpose:
 * `phone`, `data.phones.0.phone`, `mobile_number`, `whatsapp` pass;
 * `timestamp` (contains "t-e-l"? no), `telegram_message_id` and `hotel` do
 * not — "tel" and "cell" only count as whole segments.
 */
function phoneField(path: string): boolean {
  return path
    .toLowerCase()
    .split(/[._]/)
    .some((seg) => /phone|mobile|msisdn|whatsapp/.test(seg) || seg === "tel" || seg === "cell");
}

/**
 * Keep records from ONE input whose key appears (or doesn't) among the OTHER
 * input's values. The kept lane's records pass through unchanged — matching
 * adds no columns, it only decides who continues.
 *
 * Blank keys can never match: in "appears" mode they are dropped (a record
 * with no email is not "in the spreadsheet"), in "missing" mode they are kept
 * (it is equally not absent-with-a-value), and the receipt counts them either
 * way so neither choice is silent.
 */
function matchUnite(node: FlowNode, inputs: ResolvedInput[], cfg: { keepNodeId: string; keyField: string; lookupField: string; matchMode: CrossRefMode }): NodeExec {
  if (inputs.length < 2) throw new Error("Matching needs two connected steps: the records to keep, and the list to check them against.");
  if (inputs.length > 2) throw new Error(`Matching checks one step against one other, but ${inputs.length} are wired into this Combine. Remove the extras, or turn matching off.`);
  if (!cfg.keepNodeId || !cfg.keyField || !cfg.lookupField) {
    throw new Error("Matching needs to know whose records to keep and which fields to compare — open Combine data and finish the sentence.");
  }
  const primary = inputs.find((i) => i.sourceNodeId === cfg.keepNodeId);
  const reference = inputs.find((i) => i.sourceNodeId !== cfg.keepNodeId);
  if (!primary || !reference) throw new Error("The step whose records continue isn't wired into this Combine any more — open it and pick again.");

  const primaryRecords = (primary.shape as Dataset).records;
  const referenceRecords = (reference.shape as Dataset).records;

  const list = new Set<string>();
  let listBlanks = 0;
  let phones = 0;
  // Digit-matching only when BOTH chosen fields are phone fields by name —
  // a value-shape heuristic here rewrote matching for timestamp/id/serial
  // columns on every existing flow. With the gate on, `2086130936` and
  // `+1 208-613-0936` land on the same key; everything else, everywhere
  // else, keeps exact (case-folded) matching.
  const phonesEnabled = phoneField(cfg.keyField) && phoneField(cfg.lookupField);
  const keyOf = (v: unknown): string | null => {
    const k = matchKey(v);
    if (k == null || !phonesEnabled) return k;
    const p = phoneKey(k);
    if (p != null) phones++;
    return p ?? k;
  };
  for (const r of referenceRecords) {
    const k = keyOf(getField(r, cfg.lookupField));
    if (k == null) listBlanks++;
    else list.add(k);
  }
  // The 1C distinction: a reference step with NO records is an empty window
  // (checking against an empty sheet legitimately matches nothing), while
  // records present but the chosen field blank on every one is someone
  // pointing at the wrong field — and must say so, not quietly keep 0 (or,
  // in "missing" mode, keep everything).
  if (referenceRecords.length > 0 && list.size === 0) {
    throw new Error(
      `Nothing to check against: "${cfg.lookupField.replace(/^properties\./, "")}" is empty on all ${referenceRecords.length.toLocaleString("en-US")} records from the other step. Pick the field that actually holds the value there.`,
    );
  }

  const kept: FlowRecord[] = [];
  let blanks = 0;
  for (const r of primaryRecords) {
    const k = keyOf(getField(r, cfg.keyField));
    if (k == null) {
      blanks++;
      if (cfg.matchMode === "missing") kept.push(r);
      continue;
    }
    if (list.has(k) === (cfg.matchMode === "appears")) kept.push(r);
  }

  const crossRef: CrossRefReport = {
    mode: cfg.matchMode,
    keyField: cfg.keyField,
    lookupField: cfg.lookupField,
    checked: primaryRecords.length,
    kept: kept.length,
    dropped: primaryRecords.length - kept.length,
    blanks,
    listSize: list.size,
    listBlanks,
    phones,
  };
  return { ...datasetExec("unite", node.id, kept, primaryRecords.length), crossRef };
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
    if (first?.type !== "filter") return null;
    // A half-filled condition in ONE lane used to throw out of execPaths and
    // error the hub and every other lane with it. That lane's own Filter node
    // reports the problem; the hub keeps routing.
    const parsed = FilterConfigSchema.safeParse(first.data.config ?? {});
    return parsed.success ? parsed.data : null;
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
function scalarAt(inputs: ResolvedInput[], handle: "a" | "b", fixed?: number | null, fieldPath?: string | null): number {
  const found = inputs.find((i) => i.targetHandle === handle);
  if (!found) {
    // No step wired in: a typed-in literal number fills the slot.
    if (fixed != null) return fixed;
    throw new Error(`Needs a number connected to input ${handle.toUpperCase()}.`);
  }
  if (found.shape.kind === "scalar") return found.shape.value;
  if (found.shape.kind === "dataset") {
    /**
     * A picked FIELD beats the record count: the input is "that column",
     * read off the step's newest record. This is what makes a spreadsheet
     * cell holding a precomputed total usable in a Calculate — the one-row
     * summary tab it exists for has exactly one record, and for anything
     * longer "the newest record's value" is the same current-state answer
     * every preview already gives. `toNumber` is the same reader the
     * aggregations use, so a text cell holding "5" counts as 5 here exactly
     * as it would in a Sum — and a value that genuinely isn't a number says
     * WHICH field and WHAT it held, because "isn't a single number" with no
     * name was unactionable.
     */
    if (fieldPath) {
      const rec = found.shape.records[0];
      if (!rec) throw new Error(`Input ${handle.toUpperCase()} has no records to read "${fieldPath}" from.`);
      /**
       * ONE RECORD, OR NO ANSWER. Reading a column off a step holding many
       * records silently answers with the newest one — the founder wired
       * exactly this and got 3, the last row of a five-row sheet, while
       * believing it was a total of all thirty numbers. There is no reading of
       * "that column" over many records that a person means by default: the
       * total, the average and the latest are three different questions.
       *
       * So this refuses, and names the step that answers each. The one-row
       * summary tab the feature exists for is untouched.
       */
      if (found.shape.records.length > 1) {
        throw new Error(
          `Input ${handle.toUpperCase()} reads "${fieldPath}" from a step holding ${found.shape.records.length.toLocaleString("en-US")} records, so there is no single value to take. To total that column across every record, use a Calculate set to Sum — it can add several columns at once. To read one value, narrow that step to a single record first.`,
        );
      }
      const v = toNumber(getField(rec, fieldPath));
      if (v == null) {
        const raw = getField(rec, fieldPath);
        // Two different failures, two different sentences: a value that
        // exists but isn't numeric, and a field the records don't carry at
        // all — a renamed sheet column lands here, and calling that "empty"
        // sent the person to fix the wrong thing.
        const said =
          raw === undefined
            ? "the records don't carry that field — it may have been renamed at the source"
            : raw == null || raw === ""
              ? "the latest record has no value there"
              : `the latest record holds "${String(raw).slice(0, 60)}", which isn't a number`;
        throw new Error(`Input ${handle.toUpperCase()} reads "${fieldPath}", but ${said}. Pick a numeric field, or the step's Output number.`);
      }
      return v;
    }
    return found.shape.records.length;
  }
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
    if (!input) {
      /**
       * NAME WHAT IS ACTUALLY WIRED IN. "Connect it after a data step" reads
       * as false to someone who did exactly that: the reported case was
       * Sheets → Calculate → Calculate, where the step above had already
       * collapsed 5 rows into one number, so the second one had no column
       * left to add up — while its field picker still offered the sheet's
       * columns, because the sheet IS an ancestor. Same words for an empty
       * input and for a number-shaped one is what made it unreadable.
       */
      const plain = inputs.filter((i) => i.targetHandle == null);
      if (plain.length > 0) {
        throw new Error(
          "The step above produces a single number, not records, so there is nothing here to add up. A Calculate reads records — put this step directly after the one that produces them (Get data, Filter, Combine), or add its own Get data step.",
        );
      }
      throw new Error("Calculate needs records flowing in — connect it after a data step.");
    }
    const records = (input.shape as Dataset).records;
    /**
     * A field-grouping here is honoured, deliberately, even though no control
     * writes one any more. It is NOT only a leftover of the withdrawn
     * breakdown option: `migrateLegacyGraph` turns every stored `aggregate`
     * node into this one, and those could always group by a field. Ignoring
     * it would silently turn a customer's published breakdown into a single
     * number — pinned by "produces a time series and a grouped result".
     */
    const acfg: AggregateConfig = { aggregation: cfg.op as AggregateConfig["aggregation"], field: cfg.field, extraFields: cfg.extraFields, distinctField: cfg.distinctField, groupBy: cfg.groupBy };
    const shape = aggregate(records, acfg);
    const recordsOut = shape.kind === "scalar" ? 1 : shape.kind === "series" ? shape.series.length : shape.groups.length;
    return { status: "ok", nodeType: "formula", shape, recordsIn: records.length, recordsOut, sample: records.slice(0, 3), outputSchema: [] };
  }

  const value = formulaValue(cfg.op, scalarAt(inputs, "a", cfg.aFixed, cfg.aField), scalarAt(inputs, "b", cfg.bFixed, cfg.bField));
  return { status: "ok", nodeType: "formula", shape: { kind: "scalar", value: round(value) }, recordsIn: 2, recordsOut: 1, sample: [], outputSchema: [] };
}

// ---------- Calculate (merged Aggregate + Formula + Group) ----------
function execCalculate(node: FlowNode, inputs: ResolvedInput[]): NodeExec {
  const cfg = CalculateConfigSchema.parse(node.data.config ?? {});

  if (cfg.mode === "compare") {
    const value = formulaValue(cfg.op, scalarAt(inputs, "a", cfg.aFixed, cfg.aField), scalarAt(inputs, "b", cfg.bFixed, cfg.bField));
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
  const acfg: AggregateConfig = { aggregation: cfg.aggregation, field: cfg.field, extraFields: cfg.extraFields, distinctField: cfg.distinctField, groupBy: cfg.groupBy };
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
/**
 * THE ONE NUMBER A SHAPE REPRESENTS — the tile's headline and the builder's
 * Test result, computed in one place so the two cannot disagree.
 *
 * They did. The Test DTO derived its own number and covered scalar and
 * grouped but not SERIES, so a Calculate split over time reported its BUCKET
 * COUNT in the editor ("12" for twelve months) while the dashboard rendered
 * the actual total — and grouped lacked the `?? sum` fallback the tile has, so
 * a grouped shape with no precomputed total fell back to the group count the
 * same way. The comment beside that DTO line already describes this exact
 * failure being fixed once for grouped; the fix belongs here, once, for every
 * shape.
 *
 * A dataset has no single number of its own — its headline is a record count,
 * which the caller states — so it answers undefined.
 */
export function headlineValue(shape: Shape): number | undefined {
  if (shape.kind === "scalar") return shape.value;
  if (shape.kind === "series") return shape.total ?? round(shape.series.reduce((a, b) => a + b.value, 0));
  if (shape.kind === "grouped") return shape.total ?? round(shape.groups.reduce((a, b) => a + b.value, 0));
  return undefined;
}

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
  // The metric over the whole set when the shape carried one; the sum of the
  // buckets only as the fallback it always was. `headlineValue` is the shared
  // rule — the builder's Test box reads the same function.
  if (shape.kind === "scalar") tile.value = headlineValue(shape);
  else if (shape.kind === "series") {
    tile.series = shape.series;
    tile.value = headlineValue(shape);
  } else if (shape.kind === "grouped") {
    tile.groups = shape.groups;
    tile.value = headlineValue(shape);
  } else {
    tile.value = shape.records.length;
    tile.sample = shape.records.slice(0, 5);
  }
  return tile;
}

/** One dashboard range's answer for one metric. */
export type RangeSlot = NonNullable<TileSpec["byRange"]>[string];

/**
 * THE SAME METRIC, SEEN THROUGH EACH DASHBOARD RANGE — derived from the run the
 * materializer already did, not from re-running the flow per range.
 *
 * The flow runs ONCE, over its whole history. Then a range keeps the records
 * the metric is measured over and re-does only the final arithmetic. That
 * ordering is the entire point:
 *
 *   - a de-duplicating step has already picked the genuine earliest/latest
 *     record, not the earliest of a 24-hour slice;
 *   - a pairing step has already matched a lead to its call, so a pair that
 *     straddles midnight still counts, in the day its lead arrived, and the
 *     gap it reports is free to be longer than the range itself;
 *   - a comparison's two sides are windowed at their own datasets, so a
 *     percentage stays a percentage of the same population.
 *
 * WHICH DATE is the customer's choice: `spec.timeField`, the "Time reference"
 * they pick at Review & publish — a meeting's booked-at rather than its
 * arrival, say — falling back per record to `occurredAt`. Per record, because a
 * comparison's other side is usually a different dataset that never had that
 * column, and excluding all of it would read as a confident zero.
 *
 * "All time" is the run itself, returned untouched. It must not be re-filtered:
 * its upper bound is NOW, and Calendly meetings are dated when they will
 * happen, so filtering would drop every future booking out of the total.
 */
export function tileByRange(
  graph: FlowGraph,
  nodes: Map<string, NodeExec>,
  nodeId: string,
  spec: TilePresentation,
  ranges: Array<{ key: string; start: number; end: number; all?: boolean; rollingMs?: number }>,
): { byRange: Record<string, RangeSlot>; nextChangeMs: number } {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const incomingBy = new Map<string, FlowGraph["edges"]>();
  for (const e of graph.edges) {
    if (!incomingBy.has(e.target)) incomingBy.set(e.target, []);
    incomingBy.get(e.target)!.push(e);
  }

  /**
   * WHEN CAN THESE NUMBERS NEXT CHANGE WITHOUT NEW DATA?
   *
   * The clock is a data source: a rolling window sheds a record at exactly
   * `t + length`, a future-dated record (a Calendly meeting this afternoon)
   * enters "Today" at exactly `t`, and every day-anchored range shifts at UTC
   * midnight. Recomputing every ten minutes to catch those moments re-read the
   * whole history 144 times a day per flow, almost always to reproduce the
   * identical tile — the single largest source of database egress in the
   * product. So the crossings are computed HERE, where every windowed record
   * is already in hand, and the materializer stores the earliest one; the
   * refresh loop recomputes this tile at that moment and not before. Data
   * arriving still marks it stale immediately through the sweep — this is
   * only about the quiet hours.
   *
   * Midnight always participates, so the answer is never later than the next
   * UTC midnight and a completely quiet flow recomputes once a day.
   */
  const now = ranges.reduce((a, r) => Math.max(a, r.end), 0);
  const nextMidnight = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1);
  let nextChangeMs = nextMidnight;
  const rollings = ranges.filter((r) => r.rollingMs != null).map((r) => r.rollingMs!);
  const trackCrossing = (t: number) => {
    if (t > now) {
      // A future record enters every now-ended range the moment the clock
      // reaches it.
      if (t < nextChangeMs) nextChangeMs = t;
      return;
    }
    for (const len of rollings) {
      const leaves = t + len;
      if (leaves > now && leaves < nextChangeMs) nextChangeMs = leaves;
    }
  };

  const out: Record<string, RangeSlot> = {};
  for (const range of ranges) {
    let undated = 0;
    /**
     * The fallback is decided PER DATASET, not per record, and the difference
     * matters both ways.
     *
     * A lane where the chosen field never resolves simply does not speak that
     * vocabulary — the other side of a comparison is usually a different
     * source entirely — so it is dated the ordinary way rather than excluded
     * wholesale, which would read as a confident zero.
     *
     * A lane where it resolves for SOME records is using it, so the records it
     * misses are genuinely undated: they belong to no period, and quietly
     * filing them under `occurredAt` instead would put them in a period the
     * metric does not claim to measure.
     */
    const keep = (records: FlowRecord[]): FlowRecord[] => {
      if (range.all) return records;
      const field =
        spec.timeField && records.some((r) => dateMs(getField(r, spec.timeField!)) != null) ? spec.timeField : "occurredAt";
      return records.filter((r) => {
        const t = dateMs(getField(r, field));
        if (t == null) {
          undated++;
          return false;
        }
        trackCrossing(t);
        return t >= range.start && t <= range.end;
      });
    };

    // Memoized per range: a step feeding both sides of a comparison is windowed
    // once, and a diamond in the graph cannot re-do the work per path.
    const memo = new Map<string, NodeExecOk>();
    const windowed = (id: string): NodeExecOk => {
      const hit = memo.get(id);
      if (hit) return hit;
      const ex = nodes.get(id);
      if (!ex || ex.status !== "ok") throw new Error("This step produced no result.");
      const node = nodeById.get(id);
      let result: NodeExecOk;
      /**
       * A step that produces RECORDS is windowed in place — its own logic ran
       * over everything and this only chooses which of its results are in the
       * period. Anything else (a Calculate, a Group, an Output) is re-run over
       * its windowed inputs, because an average or a rate cannot be sliced.
       */
      if (node && node.type !== "output" && ex.shape.kind === "dataset") {
        const records = keep(ex.shape.records);
        result = {
          ...ex,
          shape: { kind: "dataset", records },
          recordsOut: records.length,
          sample: records.slice(0, 3),
          // Paths lanes live here, and a lane is a dataset of its own — leaving
          // them unwindowed would hand a branch's whole history to a step
          // reading it through the hub.
          outputs: ex.outputs
            ? Object.fromEntries(
                Object.entries(ex.outputs).map(([h, s]) => [h, s.kind === "dataset" ? { kind: "dataset" as const, records: keep(s.records) } : s]),
              )
            : undefined,
        };
      } else if (!node) {
        throw new Error("This step is no longer part of the flow.");
      } else {
        const inputs: ResolvedInput[] = [];
        /**
         * A FIELD-READ INPUT IS CURRENT STATE, NOT A COHORT — so the range
         * must not window it. A compare slot reading a spreadsheet cell
         * (aField/bField) reads the newest record's value: the summary row is
         * usually dated whenever it was written, so windowing that dataset to
         * "Today" empties it and every pill but All time would show "no data"
         * for a tile whose denominator is a constant. Same rule as a typed-in
         * literal, which also stays unwindowed. The OTHER slot — a genuine
         * count — still windows, so "booked today ÷ the sheet's total" means
         * exactly what it says.
         */
        const cfgAB = (node.data.config ?? {}) as { aField?: unknown; bField?: unknown };
        const fieldRead = (h: string | null | undefined): boolean =>
          (h === "a" && typeof cfgAB.aField === "string" && cfgAB.aField !== "") ||
          (h === "b" && typeof cfgAB.bField === "string" && cfgAB.bField !== "");
        for (const e of incomingBy.get(id) ?? []) {
          let se: NodeExecOk;
          if (fieldRead(e.targetHandle)) {
            const full = nodes.get(e.source);
            if (!full || full.status !== "ok") throw new Error("This step produced no result.");
            se = full;
          } else {
            se = windowed(e.source);
          }
          const shape = e.sourceHandle && se.outputs?.[e.sourceHandle] ? se.outputs[e.sourceHandle] : se.shape;
          inputs.push({ shape, exec: se, targetHandle: e.targetHandle ?? null, sourceNodeId: e.source });
        }
        // The same reach-back the run itself does, over WINDOWED records — a
        // range that resolved a step's input differently from the headline
        // would put two answers to one question on the same tile.
        const reachBack = recordsReachBack(node, inputs, graph, (nid) => {
          try {
            return windowed(nid);
          } catch {
            return undefined;
          }
        });
        if (reachBack) inputs.push(reachBack);
        const re = reexecPure(node, inputs);
        if (re.status !== "ok") throw new Error(re.error);
        result = re;
      }
      memo.set(id, result);
      return result;
    };

    try {
      const ex = windowed(nodeId);
      const tile = ex.tile ?? buildTile(spec, ex.shape, ex.sample);
      out[range.key] = { value: tile.value, series: tile.series, groups: tile.groups, ...(undated > 0 ? { undated } : {}) };
    } catch (e) {
      /**
       * EVERY RANGE GETS AN ENTRY, including the ones that cannot be answered.
       *
       * Skipping the key was the original defect: a missing entry was
       * indistinguishable from a tile written before ranges existed, so the
       * dashboard fell back to the flow's own all-time number and showed it
       * under the "Today" pill with a green "Up to date" badge. The commonest
       * trigger is a percentage whose denominator is zero for the period —
       * exactly the case where an honest "no data yet" matters most.
       */
      out[range.key] = { unavailable: e instanceof Error ? e.message : String(e) };
    }
  }
  return { byRange: out, nextChangeMs };
}

/**
 * Re-run one step over already-computed inputs. Only the steps that compute
 * something from their input rather than produce records reach this, and none
 * of them touch the database — so a range costs arithmetic, not a query.
 */
function reexecPure(node: FlowNode, inputs: ResolvedInput[]): NodeExec {
  switch (node.type) {
    case "output":
      return execOutput(node, inputs);
    case "calculate":
      return execCalculate(node, inputs);
    case "formula":
      return execFormula(node, inputs);
    case "group":
      return execGroup(node, inputs);
    default:
      return {
        status: "error",
        nodeType: node.type,
        error: "This step cannot be recomputed for a date range.",
        recordsIn: 0,
        recordsOut: 0,
        sample: [],
        outputSchema: [],
      };
  }
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
  // A field-to-field comparison where BOTH sides are blank matches nothing.
  // `"" === ""` is how "keep Close records whose email is in the sheet" —
  // built as Combine + a field-vs-field equals — passed exactly the records
  // that had NEITHER field: blank is not an identity. is_empty/is_not_empty
  // ask about one field, not a comparison, and keep their meaning. Mirrored
  // in compileRule so the pushed-down SQL stays parity-exact.
  if (rule.valueKind === "field" && rule.valueField && str === "" && v === "" && rule.op !== "is_empty" && rule.op !== "is_not_empty") return false;
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
      // Same rule as the date-range window: a date-only bound covers its day.
      const hi = endOfDayMs(rule.value2 ?? "");
      return t != null && lo != null && hi != null && t >= lo && t <= hi;
    }
    default:
      return false;
  }
}

/**
 * The field this aggregation reads holds nothing, anywhere in the input.
 *
 * Asked ONCE over every record the step loaded, before any bucketing. That
 * distinction is the whole point: "no revenue on Monday" is a fact about
 * Monday and must stay a 0, while "no revenue in any of the 412 records" is
 * someone pointing at the wrong field — and Calculate's default field is
 * `value`, which Close never populates.
 */
function assertFieldHasValues(records: FlowRecord[], cfg: AggregateConfig): void {
  if (records.length === 0) return; // an empty window is an empty window
  if (cfg.aggregation === "count") return;
  if (cfg.aggregation === "count_distinct") {
    for (const r of records) {
      const v = getField(r, cfg.distinctField);
      if (v != null && v !== "") return;
    }
    throw new EmptyFieldError(cfg.distinctField, records.length, "count unique values of");
  }
  const fields = aggregationFields(cfg);
  /**
   * TWO CHECKS, and the split is the whole point.
   *
   * PRESENCE, per column, only once a step reads more than one. A column whose
   * key is absent from every record was renamed or mistyped at the source —
   * and since a record still counts through its OTHER columns, that failure is
   * otherwise silent: a total of 21 quietly becomes 13, green badge and all.
   * Asked only for multi-column steps, so no existing single-field message
   * changes and no published metric moves.
   *
   * VALUE, combined, exactly as before: an error only when no record yields a
   * number from ANY of the columns. A column that is present but blank all
   * week — confirmation calls nobody made — is a real answer of zero, not a
   * misconfiguration, and erroring there would turn every quiet "Today" pill
   * on the dashboard red.
   */
  if (fields.length > 1) {
    for (const f of fields) {
      let present = false;
      for (const r of records) {
        if (getField(r, f) !== undefined) {
          present = true;
          break;
        }
      }
      if (!present) {
        throw new Error(
          `Can't ${cfg.aggregation} "${f.replace(/^properties\./, "")}" — none of the ${records.length.toLocaleString("en-US")} records here have that field at all. It may have been renamed at the source; pick it again, or remove it from this step.`,
        );
      }
    }
  }
  for (const r of records) for (const f of fields) if (num(getField(r, f)) != null) return;
  throw new EmptyFieldError(fields.join('" + "'), records.length, cfg.aggregation);
}

function aggregate(records: FlowRecord[], cfg: AggregateConfig): Scalar | Series | Grouped {
  assertFieldHasValues(records, cfg);
  if (!cfg.groupBy) return { kind: "scalar", value: computeAgg(records, cfg.aggregation, aggregationFields(cfg), cfg.distinctField) };
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
      series: [...buckets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([bucket, recs]) => ({ bucket, value: computeAgg(recs, cfg.aggregation, aggregationFields(cfg), cfg.distinctField) })),
      // The headline, computed HERE because this is where the records are. See
      // the note on `Series` for why it cannot be derived from the buckets.
      total: computeAgg(records, cfg.aggregation, aggregationFields(cfg), cfg.distinctField),
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
    groups: [...groups.entries()].map(([label, recs]) => ({ label, value: computeAgg(recs, cfg.aggregation, aggregationFields(cfg), cfg.distinctField) })).sort((a, b) => b.value - a.value),
    total: computeAgg(records, cfg.aggregation, aggregationFields(cfg), cfg.distinctField),
  };
}

/** Records arrived, the chosen field held nothing in any of them. Names the fix. */
class EmptyFieldError extends Error {
  constructor(field: string, count: number, what: string) {
    const name = field.replace(/^properties\./, "") || "(no field chosen)";
    super(
      `Can't ${what} "${name}" — none of the ${count.toLocaleString("en-US")} records here have a value in that field. Pick the field that holds the number.`,
    );
  }
}

/**
 * WHAT ONE RECORD CONTRIBUTES — the total of every column the step reads.
 *
 * A form writes one question per column, so "how many did you call (CRM)" and
 * "how many did you call (your phone)" are two columns meaning one thing. The
 * step adds them into one per-record number, and the aggregation then runs
 * over that: `sum` totals the combined column, `avg` averages the combined
 * daily total, `max` finds the busiest single record.
 *
 * A column that holds nothing readable on this record contributes NOTHING
 * rather than a zero, and the record still counts through its other columns —
 * a zero here would be a measurement nobody took. Only when NO column on the
 * record reads as a number does the record drop out entirely, exactly as a
 * single unreadable field always has.
 */
function combinedValue(r: FlowRecord, fields: string[]): number | null {
  let total = 0;
  let read = 0;
  for (const f of fields) {
    const n = num(getField(r, f));
    if (n != null) {
      total += n;
      read += 1;
    }
  }
  return read > 0 ? total : null;
}

function computeAgg(records: FlowRecord[], aggregation: string, fields: string[], distinctField: string): number {
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
      const nums = records.map((r) => combinedValue(r, fields)).filter((n): n is number => n != null);
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
       *
       * ASKED ONCE, OVER THE WHOLE INPUT — see `assertFieldHasValues`. This
       * check briefly lived here, inside computeAgg, which runs once PER
       * BUCKET in a trend or a breakdown: a single quiet Monday then threw and
       * destroyed the whole chart, including the six days that were fine. A
       * bucket of 0 is a real answer about that bucket. Only "empty in every
       * record this step loaded" is a configuration mistake.
       */
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
    const key = groupKey(getField(r, cfg.field));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  return [...groups.entries()]
    .map(([label, recs]) => ({ label, value: computeAgg(recs, cfg.aggregation, [cfg.valueField], cfg.distinctField) }))
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
  return [...buckets.entries()].map(([label, recs]) => ({ label, value: computeAgg(recs, cfg.aggregation, [cfg.valueField], cfg.distinctField) }));
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
    /**
     * AN EMPTY "TO" HAS NO END — not "up to now".
     *
     * It used to stop at the current instant, which is invisible on data that
     * only ever looks backwards and catastrophic on data that does not: a
     * Google Calendar filtered "from 11 Aug onwards" returned 9 of 20 matching
     * meetings, because the other 11 are SCHEDULED and the window quietly
     * ended before them. "Onwards" that stops at this second is not a window
     * anyone asked for; a bounded range is what the "To" box is for.
     *
     * Presets and rolling windows still end at `now`, and must: "the last 30
     * days" reaching into next week would be a different kind of wrong.
     */
    return { start: dateMs(cfg.from ?? "") ?? 0, end: endOfDayMs(cfg.to ?? "") ?? Number.POSITIVE_INFINITY };
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
  // Any bare number, decimals included. `/^-?\d+$/` let "12.5" through to
  // Date.parse, which reads it as 5 December 2001 — so a duration or an amount
  // with a fractional part still fabricated a moment.
  const asNumber = typeof v === "number" ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null;
  if (asNumber != null) {
    if (!Number.isFinite(asNumber)) return null;
    // Positive only: a negative count or delta is not a pre-1970 date. Nothing
    // in this product reads timestamps from before the epoch.
    if (asNumber >= EPOCH_MS_FLOOR) return asNumber;
    if (asNumber >= EPOCH_SECONDS_FLOOR) return asNumber * 1000;
    return null; // too small to be a timestamp in either unit
  }
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : t;
}

/**
 * The upper bound of a date range, inclusive of the day it names.
 *
 * Shared by the date-range window and the `between` filter operator so the two
 * cannot drift: both are fed by <input type="date">, which produces
 * "2026-08-31" — parsed as midnight, that excludes the whole of the day the
 * user typed. A hand-written instant keeps the exact moment it names.
 */
function endOfDayMs(v: unknown): number | null {
  const parsed = dateMs(v);
  if (parsed == null) return null;
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? parsed + 86_399_999 : parsed;
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
