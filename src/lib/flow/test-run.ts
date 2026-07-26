import { and, eq } from "drizzle-orm";
import { testRuns } from "@/db/schema";
import type { DB } from "@/db/types";
import { runFlow, type NodeExec } from "./engine";
import { parseGraph, type FlowGraph } from "@/lib/flow/types";
import { hasStreamConfig, streamConfigHash } from "@/lib/sync/stream-hash";
import { dedupeWarningFor } from "@/lib/schema-registry/registry";
import { primeStream } from "@/lib/sync/streams";

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
  outputSchema: Array<{ path: string; label: string; type: string; example?: unknown; container?: boolean }>;
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
  const notes: string[] = [];
  for (const node of g.nodes) {
    if (!wanted.has(node.id) || node.type !== "app") continue;
    const cfg = node.data.config as { connectionId?: unknown; sourceConfig?: unknown };
    const connectionId = typeof cfg.connectionId === "string" ? cfg.connectionId : null;
    const sourceConfig = (cfg.sourceConfig ?? {}) as Record<string, unknown>;
    if (!connectionId || !hasStreamConfig(sourceConfig)) continue;
    const r = await primeStream(db, orgId, connectionId, sourceConfig, { force: true });
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
    const streamHash = hasStreamConfig(sourceConfig) ? streamConfigHash(sourceConfig) : null;
    const warning = await dedupeWarningFor(db, { orgId, connectionId, streamHash }, field);
    return warning?.message ?? null;
  } catch {
    return null;
  }
}

/** Prime (force-fresh) + run the engine up to the node. Never throws. */
export async function executeNodeTest(db: DB, orgId: string, graph: unknown, nodeId: string): Promise<NodeTestDTO> {
  try {
    const g = parseGraph(graph);
    const primed = await primeStreamsForTest(db, orgId, g, nodeId);
    if (primed.error) return { status: "error", recordsIn: 0, recordsOut: 0, sample: [], inputSample: [], outputSchema: [], error: primed.error };
    const res = await runFlow({ db, orgId }, g, { untilNodeId: nodeId });
    const inNodeId = g.edges.find((e) => e.target === nodeId)?.source;
    const inExec = inNodeId ? res.nodes.get(inNodeId) : undefined;
    const inputSample = inExec && inExec.status === "ok" ? inExec.sample : [];
    const dto = execToDTO(res.nodes.get(nodeId), inputSample);
    // The Test computed on stored data — say so, rather than implying a refresh.
    if (primed.notes.length > 0) dto.sourceNote = primed.notes.join(" ");
    const warning = await dedupeWarningForNode(db, orgId, g, nodeId);
    if (warning) dto.dedupeWarning = warning;
    return dto;
  } catch (e) {
    return { status: "error", recordsIn: 0, recordsOut: 0, sample: [], inputSample: [], outputSchema: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export type TestRunState = { status: "queued" | "running" | "ok" | "error"; result?: NodeTestDTO; error?: string };

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
  };
}
