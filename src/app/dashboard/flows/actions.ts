"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireOrg } from "@/lib/auth";
import { createFlow, saveDraft, renameFlow, deleteFlow, publishFlow } from "@/lib/flow/store";
import { runFlow } from "@/lib/flow/engine";
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
  outputSchema: Array<{ path: string; label: string; type: string; example?: unknown }>;
  error?: string;
  tile?: unknown;
};

/** Run the engine up to a single node on real synced data and return a compact result. */
export async function testNodeAction(graph: unknown, nodeId: string): Promise<NodeTestDTO> {
  const { orgId } = await requireOrg();
  try {
    const g = parseGraph(graph);
    const res = await runFlow({ db: getDb(), orgId }, g, { untilNodeId: nodeId });
    const exec = res.nodes.get(nodeId);
    if (!exec) {
      return { status: "error", recordsIn: 0, recordsOut: 0, sample: [], outputSchema: [], error: "This node didn't run — check that its inputs are connected and tested." };
    }
    if (exec.status === "error") {
      return { status: "error", recordsIn: exec.recordsIn, recordsOut: exec.recordsOut, sample: [], outputSchema: [], error: exec.error };
    }
    return {
      status: "ok",
      recordsIn: exec.recordsIn,
      recordsOut: exec.recordsOut,
      sample: exec.sample,
      outputSchema: exec.outputSchema,
      tile: exec.tile,
    };
  } catch (e) {
    return { status: "error", recordsIn: 0, recordsOut: 0, sample: [], outputSchema: [], error: e instanceof Error ? e.message : String(e) };
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

export async function publishFlowAction(id: string): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const { orgId } = await requireOrg();
  try {
    const { version } = await publishFlow(getDb(), orgId, id);
    await inngest.send({ name: "flow/materialize.requested", data: { orgId, flowId: id } });
    return { ok: true, version };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
