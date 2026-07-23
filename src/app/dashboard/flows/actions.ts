"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/db/client";
import { connections } from "@/db/schema";
import { requireOrg } from "@/lib/auth";
import { createFlow, saveDraft, renameFlow, deleteFlow, publishFlow } from "@/lib/flow/store";
import { runFlow, sampleAppFields, type NodeExec } from "@/lib/flow/engine";
import { materializeFlow } from "@/lib/flow/materialize";
import { parseGraph, type FlowGraph } from "@/lib/flow/types";
import { ensureStreamsForGraph, primeStream } from "@/lib/sync/streams";
import { getConnectionCredentials } from "@/lib/credentials";
import { getConnector } from "@/connectors/registry";
import { hasStreamConfig } from "@/lib/sync/stream-hash";
import { isStreamScoped } from "@/connectors/catalog";
import type { SourceOption } from "@/connectors/types";
import { inngest } from "@/inngest/client";

export async function createFlowAction(): Promise<void> {
  const { orgId } = await requireOrg();
  const flow = await createFlow(getDb(), orgId, "Untitled flow");
  redirect(`/dashboard/flows/${flow.id}`);
}

export async function saveDraftAction(
  id: string,
  graph: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { orgId } = await requireOrg();
  try {
    const db = getDb();
    await saveDraft(db, orgId, id, graph);
    // Register any flow-configured resources (streams) so the sync sweep picks
    // them up. Best-effort: a stream hiccup must never fail the save.
    try {
      await ensureStreamsForGraph(db, orgId, parseGraph(graph));
    } catch {
      // The Test path (primeStream) and the sweep self-heal missing streams.
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function renameFlowAction(id: string, name: string): Promise<void> {
  const { orgId } = await requireOrg();
  await renameFlow(getDb(), orgId, id, name.trim() || "Untitled flow");
}

export async function deleteFlowAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { orgId } = await requireOrg();
  try {
    await deleteFlow(getDb(), orgId, id);
    revalidatePath("/dashboard/flows");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

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
 * First-use sync: if any app step feeding this test declares a resource whose
 * stream has never been polled, pull its first pages now — the Zapier "test
 * pulls samples" model. Errors surface on the Test result, never thrown.
 */
async function primeStreamsForTest(orgId: string, g: FlowGraph, nodeId: string): Promise<string | null> {
  const db = getDb();
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
  for (const node of g.nodes) {
    if (!wanted.has(node.id) || node.type !== "app") continue;
    const cfg = node.data.config as { connectionId?: unknown; sourceConfig?: unknown };
    const connectionId = typeof cfg.connectionId === "string" ? cfg.connectionId : null;
    const sourceConfig = (cfg.sourceConfig ?? {}) as Record<string, unknown>;
    if (!connectionId || !hasStreamConfig(sourceConfig)) continue;
    const r = await primeStream(db, orgId, connectionId, sourceConfig);
    if (!r.ok) return r.error;
  }
  return null;
}

/** Run the engine up to a single node on real synced data and return a compact result. */
export async function testNodeAction(graph: unknown, nodeId: string): Promise<NodeTestDTO> {
  const { orgId } = await requireOrg();
  try {
    const g = parseGraph(graph);
    const primeError = await primeStreamsForTest(orgId, g, nodeId);
    if (primeError) return { status: "error", recordsIn: 0, recordsOut: 0, sample: [], inputSample: [], outputSchema: [], error: primeError };
    const res = await runFlow({ db: getDb(), orgId }, g, { untilNodeId: nodeId });
    // The "before" side of the preview: the primary input node's output sample.
    const inNodeId = g.edges.find((e) => e.target === nodeId)?.source;
    const inExec = inNodeId ? res.nodes.get(inNodeId) : undefined;
    const inputSample = inExec && inExec.status === "ok" ? inExec.sample : [];
    return execToDTO(res.nodes.get(nodeId), inputSample);
  } catch (e) {
    return { status: "error", recordsIn: 0, recordsOut: 0, sample: [], inputSample: [], outputSchema: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export type AppFieldDTO = { path: string; label: string; type: string; example?: unknown; container?: boolean };

/**
 * The fields a Get data step's records actually carry — the user's real sheet
 * columns, webhook keys, etc. — sampled straight from its synced events. Powers
 * pickers on the step itself (e.g. "Match duplicates by") so they list real
 * data fields even before the step's first test. Primes a freshly-configured
 * stream first, so a brand-new resource still lists its fields.
 */
export async function listAppFieldsAction(
  config: Record<string, unknown>,
): Promise<{ ok: true; fields: AppFieldDTO[] } | { ok: false; error: string }> {
  const { orgId } = await requireOrg();
  try {
    const db = getDb();
    const connectionId = typeof config.connectionId === "string" ? config.connectionId : null;
    const sourceConfig = (config.sourceConfig ?? {}) as Record<string, unknown>;
    if (connectionId && hasStreamConfig(sourceConfig)) {
      // Best-effort first-use sync; the field listing proceeds on whatever is synced.
      await primeStream(db, orgId, connectionId, sourceConfig);
    }
    return { ok: true, fields: await sampleAppFields({ db, orgId }, config) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Live choices for a Get data step's Configure dropdowns (spreadsheets, tabs,
 * calendars…), listed straight from the provider with the connection's
 * credentials. `config` carries the values chosen so far for dependent fields.
 */
export async function listSourceOptionsAction(
  connectionId: string,
  key: string,
  config: Record<string, unknown>,
): Promise<{ ok: true; options: SourceOption[] } | { ok: false; error: string }> {
  const { orgId } = await requireOrg();
  try {
    const db = getDb();
    const [conn] = await db
      .select()
      .from(connections)
      .where(and(eq(connections.id, connectionId), eq(connections.orgId, orgId)))
      .limit(1);
    if (!conn) return { ok: false, error: "Connection not found." };
    if (!isStreamScoped(conn.source)) return { ok: true, options: [] };
    const connector = getConnector(conn.source);
    if (!connector?.listOptions) return { ok: true, options: [] };
    const credentials = await getConnectionCredentials(db, conn);
    const options = await connector.listOptions(key, { connectionId, credentials, config });
    return { ok: true, options };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Manual "Refresh" from the dashboard: recompute a published flow's stored
 * results now (org-scoped) so the tile shows current data on reload.
 */
export async function refreshFlowAction(formData: FormData): Promise<void> {
  const { orgId } = await requireOrg();
  const id = String(formData.get("flowId") ?? "");
  if (id) await materializeFlow(getDb(), orgId, id);
  revalidatePath("/dashboard");
}

export async function publishFlowAction(
  id: string,
): Promise<{ ok: true; version: number; warning?: string } | { ok: false; error: string }> {
  const { orgId } = await requireOrg();

  // Publishing (validate + immutable version snapshot) is the only step that can
  // report failure. A validation error here means the flow was NOT published.
  let version: number;
  try {
    ({ version } = await publishFlow(getDb(), orgId, id));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // The flow IS published now. Materialize its dashboard result inline so the tile
  // appears immediately (don't depend on async Inngest processing). If this fails
  // the publish still stands — we only warn that the number couldn't be computed.
  const mat = await materializeFlow(getDb(), orgId, id);
  // Best-effort async recompute as a backup; never affects the publish outcome.
  try {
    await inngest.send({ name: "flow/materialize.requested", data: { orgId, flowId: id } });
  } catch {
    // Inngest not configured — the inline materialize above already ran.
  }

  return mat.ok
    ? { ok: true, version }
    : { ok: true, version, warning: "Flow published, but the dashboard result could not be calculated." };
}
