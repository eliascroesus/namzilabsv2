"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/db/client";
import { connections } from "@/db/schema";
import { requireOrg } from "@/lib/auth";
import { streamConfigHash } from "@/lib/sync/stream-hash";
import { dateColumnChoice, dateColumnNote, dateColumnSettings, setDateColumn, type DateColumnChoice } from "@/lib/sync/date-column";
import { createFlow, saveDraft, renameFlow, deleteFlow, publishFlow } from "@/lib/flow/store";
import { CapError } from "@/lib/limits";
import { sampleAppFields } from "@/lib/flow/engine";
import { materializeFlow } from "@/lib/flow/materialize";
import { parseGraph } from "@/lib/flow/types";
import { createTestRun, executeAndSettleTestRun, getTestRun, type NodeTestDTO, type TestRunState } from "@/lib/flow/test-run";
import { ensureStreamsForGraph, primeStream, pruneOrphanStreams } from "@/lib/sync/streams";
import { getConnectionCredentials } from "@/lib/credentials";
import { getConnector } from "@/connectors/registry";
import { hasStreamConfig } from "@/lib/sync/stream-hash";
import { isStreamScoped } from "@/connectors/catalog";
import type { SourceOption } from "@/connectors/types";
import { inngest } from "@/inngest/client";

export async function createFlowAction(): Promise<void> {
  const { orgId } = await requireOrg();
  let flow;
  try {
    flow = await createFlow(getDb(), orgId, "Untitled flow");
  } catch (e) {
    // The cap is a friendly banner on the list page, not a crashed action.
    if (e instanceof CapError) redirect("/dashboard/flows?error=flow_limit");
    throw e;
  }
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

/**
 * How long a Test may run in-request before it is handed to the lane. Sits
 * comfortably inside the CANVAS segment's `maxDuration` (60s, declared in
 * src/app/dashboard/flows/[id]/page.tsx — the page these actions actually
 * POST to) with room for the handoff itself — the point is to return fast,
 * not to use the whole budget.
 */
const INLINE_TEST_BUDGET_MS = 8_000;

export type StartNodeTestResult =
  | { runId: string; result?: undefined }
  /** Inline fallback (Inngest unavailable): the run already settled. */
  | { runId: string; result: NodeTestDTO };

/**
 * Start a Test. INLINE FIRST, lane as overflow.
 *
 * This order is deliberate and was inverted before. Test is the single most
 * important interactive path in the product, and routing it through a queue
 * made it depend on that queue being healthy — a dependency it does not need.
 * Most tests are now fast enough to finish in-request: Instantly is
 * analytics-first (one or two calls), Calendar and Sendblue are date-bounded,
 * Sheets is one tab.
 *
 * So: run it here under a time budget. If it finishes — the common case — the
 * user gets a result in one round trip with no polling at all. Only when it
 * overruns do we hand off to the lane, which is what the lane was actually for:
 * genuinely long first syncs that would otherwise blow the request.
 *
 * The critical property is that a Test now works with Inngest completely down.
 * The previous fallback only fired when `inngest.send` THREW; when Inngest
 * accepted the event and then never ran it, nothing settled the row and the
 * editor showed "the sync may still be running" for ninety seconds about work
 * that was never started.
 *
 * Handing off is safe: `executeAndSettleTestRun` is idempotent on the row, and
 * the lane re-runs the identical code path (force-fresh prime, Q6 lock-await),
 * so at worst the work is repeated — never corrupted, never double-counted.
 */
export async function startNodeTestAction(graph: unknown, nodeId: string): Promise<StartNodeTestResult> {
  const { orgId } = await requireOrg();
  const db = getDb();
  const runId = await createTestRun(db, orgId);

  const inline = executeAndSettleTestRun(db, orgId, runId, graph, nodeId);
  const overran = Symbol("overran");
  const raced = await Promise.race([
    inline.then((result) => ({ result })).catch((e) => ({ error: e as Error })),
    new Promise<typeof overran>((resolve) => setTimeout(() => resolve(overran), INLINE_TEST_BUDGET_MS)),
  ]);

  if (raced !== overran && "result" in raced) return { runId, result: raced.result };

  // Overran the budget, or threw. Either way the lane takes it from here and
  // the editor polls. A send failure is not fatal — an inline run may still be
  // in flight and will settle the row itself.
  try {
    await inngest.send({ name: "flow/test.requested", data: { testRunId: runId, orgId, graph, nodeId, priority: 180 } });
  } catch (e) {
    console.error(
      `[test-lane] handoff failed (orgId=${orgId}, runId=${runId}): ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return { runId };
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
    const source = typeof config.source === "string" ? config.source : undefined;
    if (connectionId && hasStreamConfig(sourceConfig, source)) {
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
 * Read and write the STREAM's date column from the Get data node.
 *
 * The picker is rendered on the node because that is where the user is looking,
 * but it is a property of the stream: `occurred_at` is a fact about a ROW, and a
 * stream's rows are shared by every flow reading it. Two flows on one tab cannot
 * hold different opinions about when something happened, so this deliberately
 * does not go through the node's `sourceConfig` — which would either let the last
 * save win silently, or, if it entered the config hash, fork the stream and
 * re-import its history.
 */
export async function streamDateColumnAction(
  connectionId: string,
  sourceConfig: Record<string, unknown>,
  choice?: DateColumnChoice,
): Promise<{ ok: true; choice: DateColumnChoice; note: string } | { ok: false; error: string }> {
  const { orgId } = await requireOrg();
  try {
    const db = getDb();
    const [conn] = await db
      .select()
      .from(connections)
      .where(and(eq(connections.id, connectionId), eq(connections.orgId, orgId)))
      .limit(1);
    if (!conn) return { ok: false, error: "Connection not found." };
    const configHash = streamConfigHash(sourceConfig, conn.source);
    if (choice) await setDateColumn(db, orgId, connectionId, configHash, choice);
    const settings = await dateColumnSettings(db, orgId, connectionId, configHash);
    return { ok: true, choice: dateColumnChoice(settings), note: dateColumnNote(settings) };
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

  // Stop paying for streams the edits since the last publish orphaned: a Get
  // data step that changed its resource leaves the old stream behind, and the
  // sweep keeps polling it against the connection's budget for data nobody can
  // read.
  //
  // Here rather than on save, deliberately. The draft autosaves on a 900ms
  // debounce after EVERY canvas change, and this reads every flow's graph in the
  // org — putting it there made dragging a node pay for the whole workspace.
  // Publish is rare, deliberate, and the moment the resource set settles.
  try {
    await pruneOrphanStreams(getDb(), orgId);
  } catch {
    // Never fail a publish over housekeeping; the next publish retries it.
  }

  return mat.ok
    ? { ok: true, version }
    : { ok: true, version, warning: "Flow published, but the dashboard result could not be calculated." };
}
