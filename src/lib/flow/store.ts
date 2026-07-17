import { and, desc, eq, sql } from "drizzle-orm";
import { flows, flowVersions } from "@/db/schema";
import type { DB } from "@/db/types";
import { parseGraph, type FlowGraph } from "./types";
import { validateGraph } from "./validate";

export type Flow = typeof flows.$inferSelect;
export type FlowVersion = typeof flowVersions.$inferSelect;

/**
 * db-parameterized so the same code path is used by the app (Neon) and by tests
 * (PGlite). All reads/writes are org-scoped.
 */

export async function createFlow(db: DB, orgId: string, name = "Untitled flow"): Promise<Flow> {
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
export async function publishFlow(db: DB, orgId: string, id: string): Promise<{ version: number }> {
  const flow = await getFlow(db, orgId, id);
  if (!flow) throw new Error("flow not found");

  const graph = parseGraph(flow.draftGraph);
  const issues = validateGraph(graph);
  if (issues.length > 0) {
    throw new Error(`Cannot publish: ${issues.map((i) => i.message).join("; ")}`);
  }

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
