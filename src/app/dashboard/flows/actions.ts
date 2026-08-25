"use server";

import { PublishBlocked } from "@/lib/flow/store";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { getDb, getReadDb } from "@/db/client";
import { connections, flowResults } from "@/db/schema";
import { requireOrg, type OrgContext } from "@/lib/auth";
import { effectiveAccess } from "@/lib/permissions";
import { streamConfigHash } from "@/lib/sync/stream-hash";
import { dateColumnChoice, dateColumnNote, dateColumnSettings, setDateColumn, type DateColumnChoice } from "@/lib/sync/date-column";
import { createFlow, saveDraft, renameFlow, deleteFlow, publishFlow, getFlow, setFlowEnabled, type FlowState } from "@/lib/flow/store";
import { CapError } from "@/lib/limits";
import { forgetTilePlacements } from "@/lib/board/store";
import { sampleAppFields } from "@/lib/flow/engine";
import { materializeFlow, materializeStaleAll } from "@/lib/flow/materialize";
import { parseGraph } from "@/lib/flow/types";
import { createTestRun, executeAndSettleTestRun, getTestRun, type NodeTestDTO, type TestRunState } from "@/lib/flow/test-run";
import { ensureStreamsForGraph, primeStream, pruneOrphanStreams } from "@/lib/sync/streams";
import { hasStreamConfig } from "@/lib/sync/stream-hash";
import { listSourceOptions } from "@/lib/flow/source-options";
import { distinctConnectionEventTypes } from "@/lib/metrics/compute";
import { connectionImportStatus, type ImportStatus } from "@/lib/sync/import-status";
import type { SourceOption } from "@/connectors/types";
import { inngest } from "@/inngest/client";

/**
 * The rank gate, on MUTATIONS only: viewing is not editing, so the list and
 * the Test/poll read paths stay open. Admins and rankless members resolve to
 * allow-all inside effectiveAccess without touching the ranks table, so the
 * common case costs one assignment lookup at most.
 */
const RANK_BLOCKS_FLOWS = "Your role doesn't allow editing flows.";

/**
 * The single gate every flow mutation passes through.
 *
 * Two questions, not one. "create_flows" says whether this member may build at
 * all. The optional flowId asks the second: FOR A RANK-RESTRICTED MEMBER, A
 * HIDDEN FLOW DOES NOT EXIST — not on the dashboard, not in the list, not in
 * the editor, and not here. Without that second check, a member who could not
 * see a tile could still rename, republish or delete the flow behind it by
 * calling the action directly; the review that found it called URL secrecy
 * "not a control", and it is right.
 */
async function blockedFromEditingFlows(ctx: Pick<OrgContext, "orgId" | "userId" | "role">, flowId?: string): Promise<boolean> {
  const access = await effectiveAccess(getDb(), ctx);
  if (!access.can("create_flows")) return true;
  return flowId != null && !access.canSeeMetric(`flow:${flowId}`);
}

export async function createFlowAction(): Promise<void> {
  const ctx = await requireOrg();
  const { orgId } = ctx;
  // Same channel as the cap: this action's only voice is a redirect, and the
  // flows page renders the code as a banner.
  if (await blockedFromEditingFlows(ctx)) redirect("/dashboard/flows?error=rank");
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

/**
 * Turn a published flow off, or back on.
 *
 * OFF is not delete and not unpublish: the immutable version and every stored
 * result stay exactly where they are, the dashboard simply stops joining to
 * them and the materialize sweep stops picking the flow up (both already gate
 * on `flows.status`). ON restores the same numbers from the same rows.
 */
export async function setFlowEnabledAction(
  id: string,
  enabled: boolean,
): Promise<{ ok: true; state: FlowState } | { ok: false; error: string }> {
  const ctx = await requireOrg();
  const { orgId } = ctx;
  if (await blockedFromEditingFlows(ctx, id)) return { ok: false, error: RANK_BLOCKS_FLOWS };
  try {
    const state = await setFlowEnabled(getDb(), orgId, id, enabled);
    // The dashboard's tiles come and go with this, so it has to re-render too.
    revalidatePath("/dashboard/flows");
    revalidatePath("/dashboard");
    // The calendar reads the same stored tiles, so it goes stale with them.
    revalidatePath("/dashboard/calendar");
    return { ok: true, state };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Copy a flow: same draft graph, fresh name, draft status. The one honest
 * subtlety is the cap — a duplicate is a create and counts like one.
 */
export async function duplicateFlowAction(id: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await requireOrg();
  const { orgId } = ctx;
  if (await blockedFromEditingFlows(ctx, id)) return { ok: false, error: RANK_BLOCKS_FLOWS };
  const db = getDb();
  const src = await getFlow(db, orgId, id);
  if (!src) return { ok: false, error: "Flow not found." };
  let copy;
  try {
    copy = await createFlow(db, orgId, `${src.name} (copy)`);
  } catch (e) {
    if (e instanceof CapError) return { ok: false, error: e.message };
    throw e;
  }
  await saveDraft(db, orgId, copy.id, src.draftGraph);
  return { ok: true, id: copy.id };
}

export async function saveDraftAction(
  id: string,
  graph: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireOrg();
  const { orgId } = ctx;
  if (await blockedFromEditingFlows(ctx, id)) return { ok: false, error: RANK_BLOCKS_FLOWS };
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
  const ctx = await requireOrg();
  const { orgId } = ctx;
  // This action has no result channel — a throw is how it already reports.
  if (await blockedFromEditingFlows(ctx, id)) throw new Error(RANK_BLOCKS_FLOWS);
  await renameFlow(getDb(), orgId, id, name.trim() || "Untitled flow");
}

export async function deleteFlowAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireOrg();
  const { orgId } = ctx;
  if (await blockedFromEditingFlows(ctx, id)) return { ok: false, error: RANK_BLOCKS_FLOWS };
  try {
    await deleteFlow(getDb(), orgId, id);
    // Where its tiles sat on the board goes with it. This is the ONLY place a
    // placement is cleaned up: republishing a flow deliberately keeps them, so
    // that re-adding an Output returns its metric to the column it was in.
    // One flow can publish several tiles, hence the prefix.
    await forgetTilePlacements(getDb(), orgId, `flow:${id}:`);
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
 * analytics-first (one or two calls), Calendar is date-bounded,
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
  const ctx = await requireOrg();
  const { orgId } = ctx;
  // A Test is a BUILD tool, not a read: it takes an arbitrary graph from the
  // browser, primes provider syncs, and returns computed values — exactly the
  // number a hidden tile hides. Gated like every other edit.
  if (await blockedFromEditingFlows(ctx)) throw new Error(RANK_BLOCKS_FLOWS);
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
  const ctx = await requireOrg();
  const { orgId } = ctx;
  if (await blockedFromEditingFlows(ctx)) return { ok: false, error: RANK_BLOCKS_FLOWS };
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
    return await listSourceOptions(getDb(), orgId, connectionId, key, config);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Whether this account is still pulling history — the question a builder
 * needs answered before trusting a number ("is 190 all of them, or all of
 * them SO FAR?"). Stored state only: no provider call, so the panel can ask
 * whenever it opens.
 */
export async function importStatusAction(connectionId: string): Promise<ImportStatus> {
  const { orgId } = await requireOrg();
  try {
    return await connectionImportStatus(getReadDb(), orgId, connectionId);
  } catch {
    // A progress line must never be the reason a panel fails to open.
    return { state: "unknown" };
  }
}

/**
 * The Record type dropdown's options: distinct live types of ONE connection,
 * fetched when the Configure panel opens. This used to be a snapshot taken
 * when the editor page rendered — records synced by the very Test the user
 * just ran wouldn't appear in the dropdown until a full browser reload.
 */
export async function listRecordTypesAction(
  connectionId: string,
): Promise<{ ok: true; types: string[] } | { ok: false; error: string }> {
  const { orgId } = await requireOrg();
  try {
    return { ok: true, types: await distinctConnectionEventTypes(getDb(), orgId, connectionId) };
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
  const ctx = await requireOrg();
  const { orgId } = ctx;
  // Writes SHARED stream config that every flow reading the stream inherits —
  // a mutation wearing a picker's clothes, and the audit's exact finding.
  if (await blockedFromEditingFlows(ctx)) return { ok: false, error: RANK_BLOCKS_FLOWS };
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
  const ctx = await requireOrg();
  const { orgId } = ctx;
  const id = String(formData.get("flowId") ?? "");
  // A refresh is a VIEWER's act (no create_flows needed) — but only on tiles
  // the member can see. For a rank-restricted member a hidden flow does not
  // exist, so refreshing it silently no-ops rather than confirming it is there.
  if (id) {
    const access = await effectiveAccess(getDb(), ctx);
    if (!access.canSeeMetric(`flow:${id}`)) {
      revalidatePath("/dashboard");
      // The calendar reads the same stored tiles, so it goes stale with them.
      revalidatePath("/dashboard/calendar");
      return;
    }
    await materializeFlow(getDb(), orgId, id);
  }
  revalidatePath("/dashboard");
  // The calendar reads the same stored tiles, so it goes stale with them.
  revalidatePath("/dashboard/calendar");
}

/**
 * "Refresh all" — recompute every published tile in the workspace, now.
 *
 * The per-tile button next to it recomputes ONE flow, which is the wrong unit
 * when somebody has just changed something upstream and wants the board to
 * agree with reality. Marking stale first and then materializing means the
 * pass is the same one the sweep runs, under the same time budget, rather
 * than a second implementation that could drift from it: whatever the budget
 * cannot finish stays marked and the next tick picks it up, longest-stale
 * first.
 */
export async function refreshAllFlowsAction(): Promise<void> {
  const { orgId } = await requireOrg();
  const db = getDb();
  await db.update(flowResults).set({ status: "stale" }).where(eq(flowResults.orgId, orgId));
  await materializeStaleAll(db, { orgId });
  revalidatePath("/dashboard");
  // The calendar reads the same stored tiles, so it goes stale with them.
  revalidatePath("/dashboard/calendar");
}

export async function publishFlowAction(
  id: string,
): Promise<{ ok: true; version: number; warning?: string } | { ok: false; error: string; issues?: Array<{ nodeId?: string; message: string }> }> {
  const ctx = await requireOrg();
  const { orgId } = ctx;
  if (await blockedFromEditingFlows(ctx, id)) return { ok: false, error: RANK_BLOCKS_FLOWS };

  // Publishing (validate + immutable version snapshot) is the only step that can
  // report failure. A validation error here means the flow was NOT published.
  let version: number;
  try {
    ({ version } = await publishFlow(getDb(), orgId, id));
  } catch (e) {
    // Each issue keeps its nodeId so the editor can ring the step that caused
    // it, instead of concatenating everything into one unattributable line.
    if (e instanceof PublishBlocked) return { ok: false, error: "This flow isn't ready to publish yet.", issues: e.issues };
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
