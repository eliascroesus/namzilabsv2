import { and, desc, eq, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { flows, flowVersions } from "@/db/schema";
import type { DB } from "@/db/types";
import { CapError, flowCap } from "@/lib/limits";
import { parseGraph, type FlowGraph } from "./types";
import { validateGraph, type ValidationIssue } from "./validate";

import { graphFingerprint } from "./changes";

/**
 * "Is the draft still the flow the dashboard is showing?" — the content test,
 * re-exported here so server callers have it where the rest of the draft/
 * publish vocabulary lives. It is DEFINED in ./changes because the builder
 * asks the same question in the browser on every edit, and this file imports
 * the schema and the driver.
 */
export { graphFingerprint };

export type Flow = typeof flows.$inferSelect;
export type FlowVersion = typeof flowVersions.$inferSelect;

/**
 * db-parameterized so the same code path is used by the app (Neon) and by tests
 * (PGlite). All reads/writes are org-scoped.
 */

export async function createFlow(db: DB, orgId: string, name = "Untitled flow"): Promise<Flow> {
  // Cap in the single writer — see src/lib/limits.ts for why counts-at-create
  // is the right strength here (blast-radius bound, not billing).
  const [{ c: existing }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(flows)
    .where(eq(flows.orgId, orgId));
  const cap = flowCap();
  if (Number(existing) >= cap) throw new CapError("flows", cap);
  const [row] = await db
    .insert(flows)
    .values({ orgId, name, draftGraph: { nodes: [], edges: [] } })
    .returning();
  return row;
}

/**
 * Every column, including `draft_graph` — WHICH IS THE WHOLE POINT AND ALSO THE
 * WHOLE COST. The flows list needs the graph (it counts steps and names sources
 * off it), and nothing else does.
 *
 * A draft graph is not a small value: it carries every node's config AND its
 * cached `lastTest` payload, sample records included. Reaching for this to get
 * a flow's NAME reads all of that out of a database that bills by the byte —
 * see `listFlowNames` below, which exists because the calendar page did exactly
 * that to label a dropdown.
 */
export async function listFlows(db: DB, orgId: string): Promise<Flow[]> {
  return db.select().from(flows).where(eq(flows.orgId, orgId)).orderBy(desc(flows.updatedAt));
}

/**
 * Id and name, for anything that only has to LABEL a flow.
 *
 * Two columns instead of nine, and the two that matter are small: the ones left
 * behind include `draft_graph`, whose cached Test samples can run to tens of
 * kilobytes per flow. The calendar's metric picker shows which flow a metric
 * came from ("Booked" from Speed to lead, "Booked" from Pickup rate), and it
 * was calling `listFlows` for that — every graph in the workspace, on every
 * page view, to print a hint.
 */
export async function listFlowNames(db: DB, orgId: string): Promise<Array<{ id: string; name: string }>> {
  return db.select({ id: flows.id, name: flows.name }).from(flows).where(eq(flows.orgId, orgId));
}

export async function getFlow(db: DB, orgId: string, id: string): Promise<Flow | null> {
  const [row] = await db
    .select()
    .from(flows)
    .where(and(eq(flows.id, id), eq(flows.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

/** Autosave the editable draft. Never touches published versions. */
export async function saveDraft(db: DB, orgId: string, id: string, graph: unknown): Promise<void> {
  const g = parseGraph(graph);
  await db
    .update(flows)
    .set({ draftGraph: g as unknown as Record<string, unknown>, updatedAt: new Date() })
    .where(and(eq(flows.id, id), eq(flows.orgId, orgId)));
}

export async function renameFlow(db: DB, orgId: string, id: string, name: string): Promise<void> {
  await db
    .update(flows)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(flows.id, id), eq(flows.orgId, orgId)));
}

export async function deleteFlow(db: DB, orgId: string, id: string): Promise<void> {
  await db.delete(flows).where(and(eq(flows.id, id), eq(flows.orgId, orgId)));
}

/**
 * Validate the current draft and snapshot it into an immutable version. The live
 * dashboard only reads published versions, so this is the single moment a flow's
 * dashboard output can change.
 */
/**
 * Publish refused, and it knows which steps refused it.
 *
 * Every issue carries a nodeId and every one of them used to be thrown away
 * into a single joined string, so the user read "Can't publish: Cannot
 * publish: A; B; C" — doubly prefixed, and pointing at nothing on the canvas.
 */
export class PublishBlocked extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super(`Cannot publish: ${issues.map((i) => i.message).join("; ")}`);
    this.name = "PublishBlocked";
  }
}

export async function publishFlow(db: DB, orgId: string, id: string): Promise<{ version: number }> {
  const flow = await getFlow(db, orgId, id);
  if (!flow) throw new Error("flow not found");

  const graph = parseGraph(flow.draftGraph);
  const issues = validateGraph(graph);
  if (issues.length > 0) throw new PublishBlocked(issues);

  const [{ maxV }] = await db
    .select({ maxV: sql<number>`coalesce(max(${flowVersions.version}), 0)::int` })
    .from(flowVersions)
    .where(eq(flowVersions.flowId, id));
  const version = Number(maxV) + 1;

  await db.insert(flowVersions).values({ flowId: id, orgId, version, graph: graph as unknown as Record<string, unknown> });
  await db
    .update(flows)
    .set({ status: "published", publishedVersion: version, updatedAt: new Date() })
    .where(and(eq(flows.id, id), eq(flows.orgId, orgId)));

  return { version };
}

/**
 * THE THREE STATES A FLOW CAN BE IN, read off the two columns that already
 * exist. No migration, and no fourth source of truth.
 *
 *  - active — `status: "published"`. On the dashboard, and recomputed by the
 *    sweep (both gate on exactly this).
 *  - paused — turned off by hand, but it HAS a published version. Its tiles
 *    disappear and its recomputes stop; nothing is destroyed, and switching
 *    it back on restores the same numbers from the same stored results.
 *  - draft  — never published. Cannot be turned on; there is nothing to turn
 *    on yet.
 *
 * "Paused" and "draft" are the same `status` value on purpose: what separates
 * them is whether a published version was ever cut, which `publishedVersion`
 * already records. Adding a column to say it twice would let the two disagree.
 */
export type FlowState = "active" | "paused" | "draft";

export function flowState(flow: { status: string; publishedVersion: number | null }): FlowState {
  if (flow.status === "published") return "active";
  return flow.publishedVersion != null ? "paused" : "draft";
}

/**
 * Turn a flow on or off.
 *
 * Turning ON is refused unless the flow has a published version — otherwise
 * the dashboard would join to `flow_results` rows that were never written and
 * the flow would read "active" while showing nothing. Returns the state it
 * ended in so the caller can render the truth rather than its own optimism.
 */
export async function setFlowEnabled(db: DB, orgId: string, id: string, enabled: boolean): Promise<FlowState> {
  const flow = await getFlow(db, orgId, id);
  if (!flow) throw new Error("flow not found");
  if (enabled && flow.publishedVersion == null) return "draft";

  const next = enabled ? "published" : "draft";
  if (flow.status !== next) {
    await db
      .update(flows)
      // `publishedVersion` is deliberately untouched: it is what makes a
      // paused flow distinguishable from one that was never published, and
      // what lets it come back on with its numbers intact.
      .set({ status: next, updatedAt: new Date() })
      .where(and(eq(flows.id, id), eq(flows.orgId, orgId)));
  }
  return flowState({ status: next, publishedVersion: flow.publishedVersion });
}

/**
 * THE GRAPH REDUCED TO WHAT A FINGERPRINT READS, IN THE SELECT.
 *
 * `graphFingerprint` reads node ids, node types, every step's config, the
 * wiring and `metrics[]` — and nothing else. A stored graph also carries each
 * step's cached `lastTest`, with its `sample`, `inputSample` and rendered
 * `tile`: the fattest jsonb the product stores, in the draft and therefore in
 * every snapshot cut from one. Egress on this account is metered, so the rows
 * that only answer "are the edits live" never ship those payloads at all.
 *
 * Edge ids and node `position` are decided by two different rules: positions
 * are dropped (the fingerprint ignores them and `parseGraph` defaults them),
 * edge ids are kept because `parseGraph` REQUIRES them, not because anything
 * downstream reads them. Order is preserved — `parseGraph`'s legacy migrations
 * resolve some references first-match.
 */
export function graphForFingerprint(graph: SQLWrapper): SQL<unknown> {
  return sql`jsonb_build_object(
    'nodes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', node ->> 'id',
          'type', node ->> 'type',
          'data', jsonb_build_object('config', coalesce(node -> 'data' -> 'config', '{}'::jsonb))
        )
        order by ord
      )
      from jsonb_array_elements(coalesce(${graph} -> 'nodes', '[]'::jsonb)) with ordinality as n(node, ord)
    ), '[]'::jsonb),
    'edges', coalesce(${graph} -> 'edges', '[]'::jsonb),
    'metrics', coalesce(${graph} -> 'metrics', '[]'::jsonb)
  )`;
}

/**
 * The published version's fingerprint, without the version's Test payloads
 * crossing the wire — the editor asks this on every open purely to decide
 * whether the toolbar shows a pill.
 *
 * Null means "no such version row", never "unchanged": a caller that cannot
 * get an answer has to show the warning, not swallow it.
 */
export async function publishedGraphFingerprint(db: DB, orgId: string, flowId: string, version: number): Promise<string | null> {
  const [row] = await db
    .select({ graph: graphForFingerprint(flowVersions.graph) })
    .from(flowVersions)
    .where(and(eq(flowVersions.orgId, orgId), eq(flowVersions.flowId, flowId), eq(flowVersions.version, version)))
    .limit(1);
  return row ? graphFingerprint(row.graph) : null;
}

/**
 * One version's graph, for a caller that already knows which version it wants
 * (it holds the flow row, or it just published). The `graph` column ONLY: a
 * version row also carries ids and timestamps, and this jsonb is the largest
 * thing the product reads per flow. Whole, because the caller RUNS it —
 * anything that only compares graphs goes through `graphForFingerprint`
 * instead and leaves the Test payloads in the database.
 */
export async function getPublishedGraph(db: DB, orgId: string, flowId: string, version: number): Promise<FlowGraph | null> {
  const [row] = await db
    .select({ graph: flowVersions.graph })
    .from(flowVersions)
    .where(and(eq(flowVersions.orgId, orgId), eq(flowVersions.flowId, flowId), eq(flowVersions.version, version)))
    .limit(1);
  return row ? parseGraph(row.graph) : null;
}

/** The immutable published graph the dashboard/materializer should use. */
export async function getPublishedVersion(
  db: DB,
  orgId: string,
  flowId: string,
): Promise<{ version: number; graph: FlowGraph } | null> {
  const flow = await getFlow(db, orgId, flowId);
  if (!flow?.publishedVersion) return null;
  const graph = await getPublishedGraph(db, orgId, flowId, flow.publishedVersion);
  return graph ? { version: flow.publishedVersion, graph } : null;
}
