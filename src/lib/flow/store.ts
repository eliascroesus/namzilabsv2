import { and, desc, eq, sql } from "drizzle-orm";
import { flows, flowVersions } from "@/db/schema";
import type { DB } from "@/db/types";
import { CapError, flowCap } from "@/lib/limits";
import { parseGraph, type FlowGraph } from "./types";
import { validateGraph, type ValidationIssue } from "./validate";

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

export async function listFlows(db: DB, orgId: string): Promise<Flow[]> {
  return db.select().from(flows).where(eq(flows.orgId, orgId)).orderBy(desc(flows.updatedAt));
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

/** The immutable published graph the dashboard/materializer should use. */
export async function getPublishedVersion(
  db: DB,
  orgId: string,
  flowId: string,
): Promise<{ version: number; graph: FlowGraph } | null> {
  const flow = await getFlow(db, orgId, flowId);
  if (!flow?.publishedVersion) return null;
  const [row] = await db
    .select()
    .from(flowVersions)
    .where(and(eq(flowVersions.flowId, flowId), eq(flowVersions.version, flow.publishedVersion)))
    .limit(1);
  return row ? { version: row.version, graph: parseGraph(row.graph) } : null;
}
