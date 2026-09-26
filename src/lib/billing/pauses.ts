import { and, asc, eq, gte, inArray, ne } from "drizzle-orm";
import { connections, planPauses } from "@/db/schema";
import type { DB } from "@/db/types";
import { formatTime } from "@/lib/format";
import { wakeSweeper } from "@/lib/sweep/wake";
import { PLANS, type PlanId } from "./plans";
import { billingEnabled, workspacePlan } from "./state";

/**
 * APPS OVER THE PLAN'S LIMIT STOP SYNCING — through the pause that already
 * exists. The sweep, its gate and the connection page all honour
 * `connections.paused_until`; a plan pause sets it to a date no breaker would
 * ever choose, and `plan_pauses` records which connections this code paused,
 * so an upgrade resumes exactly those and never a connection a tripped breaker
 * or a rate limit is holding.
 *
 * The first N connected (by `created_at`) keep syncing. Webhook deliveries to a
 * paused app still land — only polling stops — so an upgrade resumes from data
 * that kept arriving where it could.
 */

/** The marker date. Year 9999: a pause this long is only ever a plan pause. */
export const PLAN_PAUSE_UNTIL = new Date("9999-12-31T00:00:00.000Z");

export function isPlanPause(until: Date | null | undefined): boolean {
  return until != null && until.getTime() >= PLAN_PAUSE_UNTIL.getTime();
}

/**
 * THE LINE A PAUSED APP SHOWS ON THE INTEGRATIONS LIST. An ordinary pause (a
 * breaker, a rate limit) retries on its own, so it says when. A plan pause
 * does not retry until the plan changes — "Retries automatically around
 * 12:00 AM" under a year-9999 marker would be a promise nothing keeps.
 */
export function pausedNote(until: Date | null | undefined, reason: string | null | undefined, now = new Date()): string | undefined {
  if (!until || until.getTime() <= now.getTime()) return undefined;
  if (isPlanPause(until)) return `${reason ?? "Paused by your plan — upgrade to resume syncing."} Nothing is lost — it catches up as soon as you upgrade.`;
  return `${reason ?? "Waiting before the next attempt."} Retries automatically around ${formatTime(until)} — nothing is lost.`;
}

function reasonFor(plan: PlanId): string {
  return `Paused on the ${PLANS[plan].name} plan — upgrade to resume syncing.`;
}

/** Every app that counts against the limit, oldest first. */
async function appsInOrder(db: DB, orgId: string) {
  return db
    .select({ id: connections.id, pausedUntil: connections.pausedUntil })
    .from(connections)
    .where(and(eq(connections.orgId, orgId), ne(connections.status, "disabled")))
    .orderBy(asc(connections.createdAt), asc(connections.id));
}

/** Pause every app past the plan's limit that is not already plan-paused. Returns how many. */
export async function enforceAppLimit(db: DB, orgId: string, now = new Date()): Promise<number> {
  if (!billingEnabled()) return 0;
  const { plan } = await workspacePlan(db, orgId, now);
  const limit = PLANS[plan].limits.apps;
  const over = (await appsInOrder(db, orgId)).slice(limit).filter((a) => !isPlanPause(a.pausedUntil));
  if (over.length === 0) return 0;
  const ids = over.map((a) => a.id);
  await db
    .update(connections)
    .set({ pausedUntil: PLAN_PAUSE_UNTIL, pausedReason: reasonFor(plan), updatedAt: now })
    .where(and(eq(connections.orgId, orgId), inArray(connections.id, ids)));
  await db
    .insert(planPauses)
    .values(ids.map((id) => ({ connectionId: id, orgId, pausedAt: now })))
    .onConflictDoNothing();
  wakeSweeper();
  return ids.length;
}

/**
 * Resume the plan-paused apps the CURRENT plan fits. Only a pause that is
 * still this code's (the marker date) is lifted; a record whose pause a
 * breaker has since replaced is simply forgotten. With billing off, every
 * plan pause lifts. Returns how many resumed.
 */
export async function resumePlanPauses(db: DB, orgId: string, now = new Date()): Promise<number> {
  const recorded = (await db.select({ id: planPauses.connectionId }).from(planPauses).where(eq(planPauses.orgId, orgId))).map((r) => r.id);
  if (recorded.length === 0) return 0;

  let fits = new Set(recorded);
  if (billingEnabled()) {
    const { plan } = await workspacePlan(db, orgId, now);
    fits = new Set((await appsInOrder(db, orgId)).slice(0, PLANS[plan].limits.apps).map((a) => a.id));
  }
  const toResume = recorded.filter((id) => fits.has(id));
  if (toResume.length === 0) return 0;

  const cleared = await db
    .update(connections)
    .set({ pausedUntil: null, pausedReason: null, updatedAt: now })
    .where(and(eq(connections.orgId, orgId), inArray(connections.id, toResume), gte(connections.pausedUntil, PLAN_PAUSE_UNTIL)))
    .returning({ id: connections.id });
  await db.delete(planPauses).where(and(eq(planPauses.orgId, orgId), inArray(planPauses.connectionId, toResume)));
  wakeSweeper();
  return cleared.length;
}

/** After any plan change: resume what now fits, then pause what no longer does. */
export async function applyPlan(db: DB, orgId: string, now = new Date()): Promise<void> {
  await resumePlanPauses(db, orgId, now);
  await enforceAppLimit(db, orgId, now);
}
