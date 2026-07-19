"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireOrg } from "@/lib/auth";
import { createFlow, saveDraft, renameFlow, deleteFlow, publishFlow } from "@/lib/flow/store";
import { runFlow, topoSort, type NodeExec } from "@/lib/flow/engine";
import { materializeFlow } from "@/lib/flow/materialize";
import { parseGraph } from "@/lib/flow/types";
import { validateGraph } from "@/lib/flow/validate";
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
    await saveDraft(getDb(), orgId, id, graph);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function renameFlowAction(id: string, name: string): Promise<void> {
  const { orgId } = await requireOrg();
  await renameFlow(getDb(), orgId, id, name.trim() || "Untitled flow");
}

export async function deleteFlowAction(id: string): Promise<void> {
  const { orgId } = await requireOrg();
  await deleteFlow(getDb(), orgId, id);
  redirect("/dashboard/flows");
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
};

/** One step's compact result, for the persistent "Result so far" panel (W5). */
export type ChainStepDTO = {
  nodeId: string;
  type: string;
  recordsIn: number;
  recordsOut: number;
  value: number | null;
  status: "ok" | "error";
  error?: string;
};

/** Shape one engine result into the compact DTO the editor renders. */
function execToDTO(exec: NodeExec | undefined, inputSample: unknown[]): NodeTestDTO {
  if (!exec) return { status: "error", recordsIn: 0, recordsOut: 0, sample: [], inputSample, outputSchema: [], error: "This step didn't run — check its inputs are connected." };
  if (exec.status === "error") return { status: "error", recordsIn: exec.recordsIn, recordsOut: exec.recordsOut, sample: [], inputSample, outputSchema: [], error: exec.error };
  return { status: "ok", recordsIn: exec.recordsIn, recordsOut: exec.recordsOut, sample: exec.sample, inputSample, outputSchema: exec.outputSchema, tile: exec.tile };
}

/** Run the engine up to a single node on real synced data and return a compact result. */
export async function testNodeAction(graph: unknown, nodeId: string): Promise<NodeTestDTO> {
  const { orgId } = await requireOrg();
  try {
    const g = parseGraph(graph);
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

/** Value a step contributes to the running "Result so far" (scalar/tile value, else null). */
function chainValue(ex: NodeExec): number | null {
  if (ex.status !== "ok") return null;
  const tileVal = (ex.tile as { value?: unknown } | undefined)?.value;
  if (typeof tileVal === "number") return tileVal;
  if (ex.shape.kind === "scalar") return ex.shape.value;
  return null;
}

/**
 * Run the flow up to a node and return (1) the ordered ancestor chain (incl. the node)
 * as compact per-step results for the persistent "Result so far" panel, and (2) full
 * per-node DTOs so the editor can refresh each node card + the data browser at once.
 * Read-only over synced data, so the client calls this on a debounce after edits.
 */
export async function runChainAction(
  graph: unknown,
  nodeId: string,
): Promise<{ steps: ChainStepDTO[]; results: Record<string, NodeTestDTO> }> {
  const { orgId } = await requireOrg();
  try {
    const g = parseGraph(graph);
    const res = await runFlow({ db: getDb(), orgId }, g, { untilNodeId: nodeId });

    // Ancestors of nodeId (incl. itself).
    const incoming = new Map<string, string[]>();
    for (const e of g.edges) {
      if (!incoming.has(e.target)) incoming.set(e.target, []);
      incoming.get(e.target)!.push(e.source);
    }
    const anc = new Set<string>([nodeId]);
    const stack = [nodeId];
    while (stack.length) {
      const id = stack.pop()!;
      for (const s of incoming.get(id) ?? []) if (!anc.has(s)) { anc.add(s); stack.push(s); }
    }

    const ordered = topoSort(g).filter((id) => anc.has(id));
    const steps: ChainStepDTO[] = [];
    const results: Record<string, NodeTestDTO> = {};
    for (const id of ordered) {
      const node = g.nodes.find((n) => n.id === id)!;
      const ex = res.nodes.get(id);
      const inNodeId = g.edges.find((e) => e.target === id)?.source;
      const inExec = inNodeId ? res.nodes.get(inNodeId) : undefined;
      const inputSample = inExec && inExec.status === "ok" ? inExec.sample : [];
      results[id] = execToDTO(ex, inputSample);
      steps.push({
        nodeId: id,
        type: node.type,
        recordsIn: ex?.recordsIn ?? 0,
        recordsOut: ex?.recordsOut ?? 0,
        value: ex ? chainValue(ex) : null,
        status: ex?.status ?? "error",
        error: ex && ex.status === "error" ? ex.error : ex ? undefined : "This step didn't run.",
      });
    }
    return { steps, results };
  } catch {
    return { steps: [], results: {} };
  }
}

export async function validateFlowAction(graph: unknown): Promise<{ issues: Array<{ nodeId?: string; message: string }> }> {
  await requireOrg();
  return { issues: validateGraph(parseGraph(graph)) };
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
