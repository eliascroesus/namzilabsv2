"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/db/client";
import { connections } from "@/db/schema";
import { requireOrg } from "@/lib/auth";
import { createFlow, saveDraft, renameFlow, deleteFlow, publishFlow } from "@/lib/flow/store";
import { sampleAppFields } from "@/lib/flow/engine";
import { materializeFlow } from "@/lib/flow/materialize";
import { parseGraph } from "@/lib/flow/types";
import { createTestRun, executeAndSettleTestRun, getTestRun, type NodeTestDTO, type TestRunState } from "@/lib/flow/test-run";
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

export type { NodeTestDTO } from "@/lib/flow/test-run";

export type StartNodeTestResult =
  | { runId: string; result?: undefined }
  /** Inline fallback (Inngest unavailable): the run already settled. */
  | { runId: string; result: NodeTestDTO };

/**
 * D.1-full: start a Test on the high-priority lane and return a run id the
 * editor polls. When Inngest isn't reachable (local dev without the dev
 * server), the test executes inline and the settled result returns
 * immediately — same DTO either way.
 */
export async function startNodeTestAction(graph: unknown, nodeId: string): Promise<StartNodeTestResult> {
  const { orgId } = await requireOrg();
  const db = getDb();
  const runId = await createTestRun(db, orgId);
  try {
    await inngest.send({ name: "flow/test.requested", data: { testRunId: runId, orgId, graph, nodeId, priority: 180 } });
    return { runId };
  } catch {
    // Inngest not configured — run inline (the pre-lane behavior).
    const result = await executeAndSettleTestRun(db, orgId, runId, graph, nodeId);
    return { runId, result };
  }
}

/** Poll a Test run started by startNodeTestAction (org-scoped). */
export async function pollNodeTestAction(runId: string): Promise<TestRunState | null> {
  const { orgId } = await requireOrg();
  return getTestRun(getDb(), orgId, runId);
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
