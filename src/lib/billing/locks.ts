import { and, asc, eq } from "drizzle-orm";
import { flowResults, flows } from "@/db/schema";
import type { DB } from "@/db/types";
import { PLANS } from "./plans";
import { billingEnabled, workspacePlan } from "./state";

/**
 * LOCKED METRICS — the numbers a workspace keeps on the board but cannot read
 * until it upgrades.
 *
 * The first N metrics it published stay live (N = its plan's metrics); every
 * later one is locked. First-published order is `flow_results.created_at`: the
 * row is written the first time a metric computes and only updated after, so
 * the order never shuffles as tiles recompute.
 *
 * ═══ THE LOCK IS THE DATA BEING WITHHELD, NOT A BLUR OVER IT ═══
 *
 * The owner's rule: inspect mode must not reveal a locked number. So a locked
 * row is rebuilt from an allowlist — its identity, its name, its chart kind —
 * and everything it measured is dropped before the row reaches anything that
 * renders it, sorts by it, composes a funnel from it, fills the calendar or
 * answers the AI assistant. The blur the dashboard draws is a picture with no
 * data in it.
 *
 * Applied by each CONSUMER of the tile reads, never inside them: the board's
 * read is cached by results version, and a plan changing does not move that
 * key. `tests/billing-locks.test.ts` fails if a consumer forgets.
 */

export function metricKey(flowId: string, outputNodeId: string): string {
  return `${flowId}:${outputNodeId}`;
}

/** Keys of every published metric past the first `limit`, in first-published order. */
export async function lockedMetricKeys(db: DB, orgId: string, limit: number): Promise<Set<string>> {
  const rows = await db
    .select({ flowId: flowResults.flowId, outputNodeId: flowResults.outputNodeId })
    .from(flowResults)
    .innerJoin(flows, eq(flows.id, flowResults.flowId))
    .where(and(eq(flowResults.orgId, orgId), eq(flows.status, "published")))
    .orderBy(asc(flowResults.createdAt), asc(flowResults.id));
  return new Set(rows.slice(limit).map((r) => metricKey(r.flowId, r.outputNodeId)));
}

/** The locked set for a workspace's current plan. Empty while billing is off. */
export async function metricLocksFor(db: DB, orgId: string): Promise<Set<string>> {
  if (!billingEnabled()) return new Set();
  const { plan } = await workspacePlan(db, orgId);
  return lockedMetricKeys(db, orgId, PLANS[plan].limits.metrics);
}

type LockableRow = {
  flowId: string;
  outputNodeId: string;
  tile: Record<string, unknown> | null;
  error?: string | null;
  computedAt?: Date | string | null;
  provenance?: unknown;
};

/**
 * The row as the browser may see it: who it is, what it is called, what kind
 * of chart it draws. Nothing it measured — not the value, a range, a day, a
 * sample, a series, when it last computed, where its data came from, or an
 * error message that might quote a figure.
 */
export function lockRow<T extends LockableRow>(row: T): T & { locked: true } {
  const tile = row.tile ?? {};
  const name = typeof tile.name === "string" ? tile.name : "Metric";
  const kept: Record<string, unknown> = { name, locked: true };
  if (typeof tile.viz === "string") kept.viz = tile.viz;
  return {
    ...row,
    tile: { name, ...(kept.viz ? { viz: kept.viz } : {}), locked: true },
    error: null,
    computedAt: null,
    ...("provenance" in row ? { provenance: null } : {}),
    locked: true,
  } as T & { locked: true };
}

export function applyMetricLocks<T extends LockableRow>(rows: T[], locked: Set<string>): Array<T | (T & { locked: true })> {
  if (locked.size === 0) return rows;
  return rows.map((r) => (locked.has(metricKey(r.flowId, r.outputNodeId)) ? lockRow(r) : r));
}

/** A chart built from several metrics is locked when any one of them is. */
export function anyLocked(keys: string[], locked: Set<string>): boolean {
  return keys.some((k) => locked.has(k));
}

export function isLockedRow(row: unknown): boolean {
  return Boolean(row && typeof row === "object" && (row as { locked?: unknown }).locked === true);
}
