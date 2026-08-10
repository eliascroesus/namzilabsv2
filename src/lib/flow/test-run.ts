import { and, eq } from "drizzle-orm";
import { connections, testRuns } from "@/db/schema";
import type { DB } from "@/db/types";
import { appFieldUnion, runFlow, type NodeExec } from "./engine";
import type { FieldInfo } from "./schema-infer";
import { compileEnabled } from "./compile/flags";
import { parseGraph, type FlowGraph } from "@/lib/flow/types";
import { hasStreamConfig, streamConfigHash } from "@/lib/sync/stream-hash";
import { catalogEntry, isStreamScoped } from "@/connectors/catalog";
import { dedupeWarningFor } from "@/lib/schema-registry/registry";
import { primeStream } from "@/lib/sync/streams";
import { primeConnection } from "@/lib/sync/resync";

/**
 * D.1-full — the user-initiated Test execution path.
 *
 * The editor's Test button starts a run on the HIGH-PRIORITY lane (its own
 * Inngest function, ahead of sweep contention, org-fair) and polls the
 * `test_runs` row for the result: the browser never holds a long request open
 * and a serverless timeout can't kill a slow first sync. Freshness guarantees
 * on the way down: `primeStream(force)` always re-reads the source, and on the
 * pool driver a collision with an in-flight writer AWAITS and adopts its
 * result (Q6) instead of double-polling.
 */

export type NodeTestDTO = {
  status: "ok" | "error";
  recordsIn: number;
  recordsOut: number;
  sample: unknown[];
  /** Sample of the primary input (before) — for the before/after test preview. */
  inputSample: unknown[];
  outputSchema: FieldInfo[];
  error?: string;
  tile?: unknown;
  /** The computed number, when the step produces a single number (Count/Calculate). */
  value?: number;
  /**
   * F.8 honesty marker: set when the Test could NOT re-read the source (the
   * provider budget is spent, or syncing is paused) and therefore computed on
   * stored data. The editor shows this verbatim — a Test must never silently
   * imply it refreshed when it didn't.
   */
  sourceNote?: string;
  /**
   * E.7 guardrail: set when this step's "Match duplicates by" field has too few
   * distinct values to identify a record, so the dedupe is silently collapsing
   * most of the data into a plausible-looking number. Surfaced BEFORE the
   * number is trusted — a wrong answer nobody questions is worse than an error.
   */
  dedupeWarning?: string;
  /**
   * What "Remove duplicates" actually did, measured on the run: how many of
   * the loaded records the chosen field resolved on, and how many were
   * removed. `matched: 0` is the silent no-op — the field exists nowhere in
   * this step's data — which the E.7 warning above cannot catch, because the
   * field IS in the connection's registry, just never on THIS record type.
   */
  dedupe?: { field: string; keep?: string; orderField?: string; loaded: number; matched: number; ordered?: number; removed: number };
  /**
   * What Time between paired. A median over "the leads that were called" is a
   * different question from the one the tile's name asks, and the keys that
   * never matched used to vanish without a number anywhere.
   */
  pairing?: { keys: number; started: number; matched: number; noStop: number; stopBeforeStart: number };
  /**
   * The read hit the safety ceiling. The engine has always set this and the
   * DTO always dropped it, so a capped count was reported as a complete total.
   */
  truncated?: boolean;
};

/** Shape one engine result into the compact DTO the editor renders. */
function execToDTO(exec: NodeExec | undefined, inputSample: unknown[]): NodeTestDTO {
  if (!exec) return { status: "error", recordsIn: 0, recordsOut: 0, sample: [], inputSample, outputSchema: [], error: "This step didn't run — check its inputs are connected." };
  if (exec.status === "error") return { status: "error", recordsIn: exec.recordsIn, recordsOut: exec.recordsOut, sample: [], inputSample, outputSchema: [], error: exec.error };
  return {
    status: "ok",
    recordsIn: exec.recordsIn,
    recordsOut: exec.recordsOut,
    sample: exec.sample,
    inputSample,
    outputSchema: exec.outputSchema,
    tile: exec.tile,
    value: exec.shape.kind === "scalar" ? exec.shape.value : undefined,
    dedupe: exec.dedupe,
    pairing: exec.pairing,
    truncated: exec.truncated,
  };
}

/**
 * First-use / force-fresh sync for every app step feeding the tested node —
 * the Zapier "test pulls samples" model. Errors surface on the Test result,
 * never thrown. The explicit Test always forces a re-read of the CURRENT
 * source (never a staleness window).
 */
async function primeStreamsForTest(
  db: DB,
  orgId: string,
  g: FlowGraph,
  nodeId: string,
): Promise<{ error?: string; notes: string[] }> {
  const incoming = new Map<string, string[]>();
  for (const e of g.edges) {
    if (!incoming.has(e.target)) incoming.set(e.target, []);
    incoming.get(e.target)!.push(e.source);
  }
  const wanted = new Set<string>([nodeId]);
  const stack = [nodeId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const s of incoming.get(cur) ?? []) if (!wanted.has(s)) { wanted.add(s); stack.push(s); }
  }
  // The step's source decides which of its settings are stream identity and
  // which only narrow the read, so it has to be known before the config is
  // hashed. Read once for the whole graph rather than per node.
  const sourceOf = new Map<string, string>(
    (await db.select({ id: connections.id, source: connections.source }).from(connections).where(eq(connections.orgId, orgId))).map((c) => [c.id, c.source]),
  );
  const notes: string[] = [];
  for (const node of g.nodes) {
    if (!wanted.has(node.id) || node.type !== "app") continue;
    const cfg = node.data.config as { connectionId?: unknown; source?: unknown; sourceConfig?: unknown };
    const connectionId = typeof cfg.connectionId === "string" ? cfg.connectionId : null;
    const sourceConfig = (cfg.sourceConfig ?? {}) as Record<string, unknown>;
    if (!connectionId) continue;
    const source = typeof cfg.source === "string" ? cfg.source : sourceOf.get(connectionId);
    // A source with no per-flow resource (Sendblue, Close) has an empty
    // sourceConfig, so primeStream has nothing to key on. Refresh the whole
    // connection instead — skipping it silently is what made Test report "0
    // loaded" for sources it had never actually asked.
    const r = hasStreamConfig(sourceConfig, source)
      ? await primeStream(db, orgId, connectionId, sourceConfig, { force: true })
      : await primeConnection(db, orgId, connectionId);
    if (!r.ok) return { error: r.error, notes };
    if (r.note) notes.push(r.note);
  }
  return { notes };
}

/**
 * E.7: does the node being tested dedupe on a field that cannot identify a
 * record? Reads the field registry the writer maintains, so the judgement is
 * made over everything ever synced for the stream — not over the sample the
 * Test happened to load.
 *
 * Diagnostic only: any failure here returns null rather than failing the Test.
 */
async function dedupeWarningForNode(db: DB, orgId: string, g: FlowGraph, nodeId: string): Promise<string | null> {
  try {
    const node = g.nodes.find((n) => n.id === nodeId);
    if (!node || node.type !== "app") return null;
    const cfg = (node.data.config ?? {}) as {
      connectionId?: unknown;
      sourceConfig?: unknown;
      dedupe?: unknown;
      dedupeField?: unknown;
    };
    if (cfg.dedupe !== true) return null;
    const connectionId = typeof cfg.connectionId === "string" ? cfg.connectionId : null;
    if (!connectionId) return null;
    const field = typeof cfg.dedupeField === "string" && cfg.dedupeField ? cfg.dedupeField : "subject";
    const sourceConfig = (cfg.sourceConfig ?? {}) as Record<string, unknown>;
    const [conn] = await db.select({ source: connections.source }).from(connections).where(eq(connections.id, connectionId)).limit(1);
    const streamHash = hasStreamConfig(sourceConfig, conn?.source) ? streamConfigHash(sourceConfig, conn?.source) : null;
    const warning = await dedupeWarningFor(db, { orgId, connectionId, streamHash }, field);
    return warning?.message ?? null;
  } catch {
    return null;
  }
}

/**
 * A Get-data step whose source is gone must SAY so.
 *
 * Removing an integration retires its events, so a flow still pointing at it
 * now computes over nothing and renders a confident zero. Empty is a legitimate
 * answer to a real question; it must never be how "this step is broken" looks.
 * Same for a stream-scoped source with no resource chosen — after Instantly
 * became campaign-scoped, every pre-existing step is in exactly that state.
 */
async function missingSourcePrompt(db: DB, orgId: string, g: FlowGraph, nodeId: string): Promise<string | null> {
  const node = g.nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== "app") return null;
  const cfg = (node.data.config ?? {}) as { connectionId?: unknown; sourceConfig?: unknown };
  const connectionId = typeof cfg.connectionId === "string" ? cfg.connectionId : null;
  if (!connectionId) return "Choose a connection for this step — it isn't reading from anything yet.";

  const [conn] = await db
    .select({ id: connections.id, name: connections.name, source: connections.source })
    .from(connections)
    .where(and(eq(connections.id, connectionId), eq(connections.orgId, orgId)))
    .limit(1);
  if (!conn) {
    return "This step's connection was removed. Pick another connection, or reconnect that integration and choose it here.";
  }

  const entry = catalogEntry(conn.source);
  if (isStreamScoped(conn.source) && !hasStreamConfig((cfg.sourceConfig ?? {}) as Record<string, unknown>, conn.source)) {
    const what = entry?.flowFields?.map((f) => f.label.toLowerCase()).join(" and ") ?? "a resource";
    return `Choose ${what} for this step — ${entry?.name ?? conn.source} needs to know which data to pull before it can return anything.`;
  }
  return null;
}

/** Prime (force-fresh) + run the engine up to the node. Never throws. */
export async function executeNodeTest(db: DB, orgId: string, graph: unknown, nodeId: string): Promise<NodeTestDTO> {
  try {
    const g = parseGraph(graph);
    // Before anything else: if this step has no source to read, say which
    // choice is missing rather than returning a confident zero.
    const missing = await missingSourcePrompt(db, orgId, g, nodeId);
    if (missing) return { status: "error", recordsIn: 0, recordsOut: 0, sample: [], inputSample: [], outputSchema: [], error: missing };
    const primed = await primeStreamsForTest(db, orgId, g, nodeId);
    if (primed.error) return { status: "error", recordsIn: 0, recordsOut: 0, sample: [], inputSample: [], outputSchema: [], error: primed.error };
    // E.4: the Test surface is the pushdown's soak seam (compile/flags.ts) —
    // a human is watching, nothing persists, and the JS engine re-applies
    // every folded rule anyway.
    const res = await runFlow({ db, orgId, compile: compileEnabled("test") }, g, { untilNodeId: nodeId });
    const inNodeId = g.edges.find((e) => e.target === nodeId)?.source;
    const inExec = inNodeId ? res.nodes.get(inNodeId) : undefined;
    const inputSample = inExec && inExec.status === "ok" ? inExec.sample : [];
    const dto = execToDTO(res.nodes.get(nodeId), inputSample);
    // The Test computed on stored data — say so, rather than implying a refresh.
    if (primed.notes.length > 0) dto.sourceNote = primed.notes.join(" ");
    const warning = await dedupeWarningForNode(db, orgId, g, nodeId);
    if (warning) dto.dedupeWarning = warning;
    /**
     * The picker's list is a fact about the APP, not about this one run.
     *
     * Only the tested node's DTO travels back, and every downstream picker
     * reads the APP node's stored outputSchema — filters and windows
     * contribute nothing but their own Output flags, and a Combine is skipped
     * entirely (see buildFieldGroups). So widening it HERE is what reaches
     * the Filter, the Calculate and the Time between below it.
     *
     * On the test path and not in execApp on purpose: execApp also runs on
     * every materialize, and the materializer never reads outputSchema.
     */
    const tested = g.nodes.find((n) => n.id === nodeId);
    if (tested?.type === "app" && dto.status === "ok") {
      try {
        dto.outputSchema = await appFieldUnion({ db, orgId }, tested.data.config, dto.outputSchema, savedFieldPaths(g));
      } catch {
        // A picker must never fail because a diagnostic table is unavailable.
      }
    }
    return dto;
  } catch (e) {
    return { status: "error", recordsIn: 0, recordsOut: 0, sample: [], inputSample: [], outputSchema: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** Config keys that hold a single field path. */
const PATH_KEYS = [
  "field",
  "valueField",
  "distinctField",
  "breakdownField",
  "dateField",
  "keyField",
  "startField",
  "endField",
  "dedupeField",
] as const;

/**
 * Every field path any step in this graph has SAVED.
 *
 * These are exempt from the emptiness rule. A field can be empty in the data
 * and still be the one a published metric is built on — and a picker missing
 * its own value is worse than a picker with one dead row in it: the pill goes
 * amber claiming the source is missing, the operator list silently degrades
 * to textual, and a Filter's picker is pick-only so it cannot even be chosen
 * again. Graph-wide rather than per-branch because descendants are a subset
 * of all nodes and a graph is a handful of steps.
 */
function savedFieldPaths(g: FlowGraph): Set<string> {
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string" && v && !v.startsWith("__")) out.add(v);
  };
  const addRules = (c: unknown) => {
    for (const r of ((c as { rules?: unknown[] } | undefined)?.rules ?? []) as Array<Record<string, unknown>>) {
      add(r.field);
      add(r.valueField);
    }
  };
  for (const n of g.nodes) {
    const cfg = (n.data.config ?? {}) as Record<string, unknown>;
    for (const k of PATH_KEYS) add(cfg[k]);
    add((cfg.dateRange as { dateField?: unknown } | undefined)?.dateField);
    add((cfg.groupBy as { field?: unknown } | undefined)?.field);
    addRules(cfg);
    addRules(cfg.start);
    addRules(cfg.end);
    for (const p of (cfg.paths ?? []) as Array<Record<string, unknown>>) addRules(p.filters);
    for (const c of (cfg.categories ?? []) as Array<Record<string, unknown>>) addRules(c.filters);
  }
  for (const m of g.metrics ?? []) add(m.timeField);
  return out;
}

export type TestRunState = {
  status: "queued" | "running" | "ok" | "error";
  result?: NodeTestDTO;
  error?: string;
  /**
   * Milliseconds since the row last changed state. Without this the poller can
   * only see "not finished yet" and has to guess why — which is how a run that
   * was never picked up, and a run whose container was killed, both came out as
   * "the sync may still be running". They are different failures and the user
   * needs different things from each.
   */
  ageMs: number;
};

/** Create the polling row for a Test run. */
export async function createTestRun(db: DB, orgId: string): Promise<string> {
  const [row] = await db.insert(testRuns).values({ orgId }).returning({ id: testRuns.id });
  return row.id;
}

/** Execute + settle a Test run's row (called by the lane worker or the inline fallback). */
export async function executeAndSettleTestRun(db: DB, orgId: string, runId: string, graph: unknown, nodeId: string): Promise<NodeTestDTO> {
  await db.update(testRuns).set({ status: "running", updatedAt: new Date() }).where(and(eq(testRuns.id, runId), eq(testRuns.orgId, orgId)));
  const dto = await executeNodeTest(db, orgId, graph, nodeId);
  // "ok" = the RUN completed (the DTO itself may carry a node-level error the
  // editor renders); run-status "error" is reserved for infrastructure failure.
  await db
    .update(testRuns)
    .set({ status: "ok", result: dto as unknown as Record<string, unknown>, updatedAt: new Date() })
    .where(and(eq(testRuns.id, runId), eq(testRuns.orgId, orgId)));
  return dto;
}

/** Poll a Test run (org-scoped). */
export async function getTestRun(db: DB, orgId: string, runId: string): Promise<TestRunState | null> {
  const [row] = await db
    .select()
    .from(testRuns)
    .where(and(eq(testRuns.id, runId), eq(testRuns.orgId, orgId)))
    .limit(1);
  if (!row) return null;
  return {
    status: row.status as TestRunState["status"],
    result: (row.result as unknown as NodeTestDTO) ?? undefined,
    error: row.error ?? undefined,
    ageMs: Math.max(0, Date.now() - new Date(row.updatedAt).getTime()),
  };
}
