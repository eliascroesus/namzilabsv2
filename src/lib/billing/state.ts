import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { accessGrants, billingSubscriptions, promoCodes, trialClaims } from "@/db/schema";
import type { DB } from "@/db/types";
import { TRIAL_DAYS, isPaidPlan, type GrantKind, type PaidPlanId } from "./plans";
import { resolvePlan, type GrantInput, type ResolvedPlan, type SubscriptionInput } from "./resolve";

/**
 * THE LAUNCH SWITCH. Unset — the default, and the state of every deploy until
 * the owner has tested Stripe end to end — means nothing in the product is
 * limited, locked, paused or gated, exactly as before plans existed.
 */
export function billingEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.BILLING_ENABLED ?? "");
}

/**
 * `subscribed`: a live Stripe subscription exists, WHICHEVER candidate won. A
 * subscriber given a higher plan by a code still pays underneath, and anything
 * that would open Checkout must send them to the billing portal instead — or
 * Stripe starts a second subscription on the same customer.
 */
export type WorkspacePlan = ResolvedPlan & { subscribed: boolean };

const LIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

/** Everything a workspace holds, resolved to one plan. */
export async function workspacePlan(db: DB, orgId: string, now = new Date()): Promise<WorkspacePlan> {
  const [sub] = await db
    .select({
      plan: billingSubscriptions.plan,
      status: billingSubscriptions.status,
      currentPeriodEnd: billingSubscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: billingSubscriptions.cancelAtPeriodEnd,
      trialEnd: billingSubscriptions.trialEnd,
    })
    .from(billingSubscriptions)
    .where(eq(billingSubscriptions.orgId, orgId))
    .limit(1);
  const grantRows = await db
    .select({
      plan: accessGrants.plan,
      kind: accessGrants.kind,
      startsAt: accessGrants.startsAt,
      endsAt: accessGrants.endsAt,
      revokedAt: accessGrants.revokedAt,
    })
    .from(accessGrants)
    .where(and(eq(accessGrants.orgId, orgId), isNull(accessGrants.revokedAt)));

  const subscription: SubscriptionInput | null =
    sub && isPaidPlan(sub.plan) && sub.status
      ? {
          plan: sub.plan,
          status: sub.status,
          currentPeriodEnd: sub.currentPeriodEnd,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          trialEnd: sub.trialEnd,
        }
      : null;
  const grants: GrantInput[] = grantRows.flatMap((g) =>
    isPaidPlan(g.plan) ? [{ plan: g.plan, kind: g.kind as GrantKind, startsAt: g.startsAt, endsAt: g.endsAt, revokedAt: g.revokedAt }] : [],
  );
  return { ...resolvePlan({ subscription, grants, now }), subscribed: sub != null && LIVE_STATUSES.has(sub.status ?? "") };
}

export type GrantRow = typeof accessGrants.$inferSelect;

/**
 * Write a grant. Returns its id, or null when one of the table's rules refused
 * it (a second launch trial, a second reward for the same rung, a second
 * redemption of the same code) — the unique indexes, not a read-then-write, so
 * two racing requests cannot both win.
 */
export async function grantPlan(
  db: DB,
  input: {
    orgId: string;
    plan: PaidPlanId;
    kind: GrantKind;
    endsAt: Date | null;
    grantedBy: string | null;
    note?: string | null;
    promoCodeId?: string | null;
    referralRung?: number | null;
    now?: Date;
  },
): Promise<string | null> {
  const rows = await db
    .insert(accessGrants)
    .values({
      orgId: input.orgId,
      plan: input.plan,
      kind: input.kind,
      startsAt: input.now ?? new Date(),
      endsAt: input.endsAt,
      grantedBy: input.grantedBy,
      note: input.note ?? null,
      promoCodeId: input.promoCodeId ?? null,
      referralRung: input.referralRung ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: accessGrants.id });
  return rows[0]?.id ?? null;
}

/** Revoke one grant. False when it was already revoked or does not exist. */
export async function revokeGrant(db: DB, input: { grantId: string; by: string; now?: Date }): Promise<boolean> {
  const rows = await db
    .update(accessGrants)
    .set({ revokedAt: input.now ?? new Date(), revokedBy: input.by })
    .where(and(eq(accessGrants.id, input.grantId), isNull(accessGrants.revokedAt)))
    .returning({ id: accessGrants.id, orgId: accessGrants.orgId });
  return rows.length > 0;
}

export async function listGrants(db: DB, orgId: string): Promise<GrantRow[]> {
  return db.select().from(accessGrants).where(eq(accessGrants.orgId, orgId)).orderBy(desc(accessGrants.createdAt));
}

/** Rows from `db.execute` — an array on PGlite, `{ rows }` on the Neon HTTP driver. */
function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as T[];
}

export type TrialResult = { ok: true; endsAt: Date } | { ok: false; reason: "already_trialed" | "has_plan" };

/**
 * START A 30-DAY TRIAL — once per PERSON, not per workspace, so a second
 * workspace offers "Start Growth" instead of another free month.
 *
 * The claim and the grant are ONE statement: a crash between two statements
 * would otherwise spend someone's only trial on nothing. A workspace that
 * already holds a paid plan is refused BEFORE the claim, so the person keeps
 * their trial for a workspace that needs it.
 */
export async function startTrial(
  db: DB,
  input: { orgId: string; userId: string; plan: PaidPlanId; now?: Date },
): Promise<TrialResult> {
  const now = input.now ?? new Date();
  if ((await workspacePlan(db, input.orgId, now)).plan !== "free") return { ok: false, reason: "has_plan" };
  const endsAt = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);
  const result = await db.execute(sql`
    with claim as (
      insert into trial_claims (user_id, org_id, plan, claimed_at)
      values (${input.userId}, ${input.orgId}, ${input.plan}, ${now.toISOString()}::timestamptz)
      on conflict (user_id) do nothing
      returning org_id, plan
    )
    insert into access_grants (org_id, plan, kind, starts_at, ends_at)
    select org_id, plan, 'trial', ${now.toISOString()}::timestamptz, ${endsAt.toISOString()}::timestamptz from claim
    returning id
  `);
  if (rowsOf<{ id: string }>(result).length === 0) return { ok: false, reason: "already_trialed" };
  return { ok: true, endsAt };
}

/** Whether this person has spent their one trial — the picker then shows a price, not "FREE". */
export async function hasTrialed(db: DB, userId: string): Promise<boolean> {
  const [row] = await db.select({ userId: trialClaims.userId }).from(trialClaims).where(eq(trialClaims.userId, userId)).limit(1);
  return row != null;
}

/** Upper-case, 3–32 of A–Z, 0–9, "-" and "_". Anything else is not a code. */
export function normaliseCode(raw: string | null | undefined): string | null {
  const code = (raw ?? "").trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code) ? code : null;
}

/** Calendar months, clamped: 31 Jan + 1 month is 28 Feb, not 3 Mar. */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

export type RedeemResult =
  | { ok: true; plan: PaidPlanId; endsAt: Date | null }
  | { ok: false; reason: "unknown" | "disabled" | "expired" | "used_up" | "already_redeemed" };

/**
 * REDEEM AN ACCESS CODE — the plan it names, until redemption + its months
 * (never counted from launch: the owner's rule), or for life.
 *
 * The cap is checked by count before the insert. Two redemptions landing in
 * the same instant can both pass that check, so a cap of 30 can admit a 31st
 * in a simultaneous burst; the one-per-workspace rule cannot be beaten, it is
 * a unique index.
 */
export async function redeemCode(db: DB, input: { orgId: string; code: string; now?: Date }): Promise<RedeemResult> {
  const now = input.now ?? new Date();
  const normal = normaliseCode(input.code);
  if (!normal) return { ok: false, reason: "unknown" };
  const [pc] = await db.select().from(promoCodes).where(eq(promoCodes.code, normal)).limit(1);
  if (!pc || !isPaidPlan(pc.plan)) return { ok: false, reason: "unknown" };
  if (pc.disabledAt) return { ok: false, reason: "disabled" };
  if (pc.redeemBy && pc.redeemBy.getTime() <= now.getTime()) return { ok: false, reason: "expired" };

  const [mine] = await db
    .select({ id: accessGrants.id })
    .from(accessGrants)
    .where(and(eq(accessGrants.orgId, input.orgId), eq(accessGrants.promoCodeId, pc.id)))
    .limit(1);
  if (mine) return { ok: false, reason: "already_redeemed" };
  if (pc.maxRedemptions != null) {
    const [used] = await db.select({ n: count() }).from(accessGrants).where(eq(accessGrants.promoCodeId, pc.id));
    if (Number(used?.n ?? 0) >= pc.maxRedemptions) return { ok: false, reason: "used_up" };
  }

  const endsAt = pc.months == null ? null : addMonths(now, pc.months);
  const id = await grantPlan(db, {
    orgId: input.orgId,
    plan: pc.plan,
    kind: "code",
    endsAt,
    grantedBy: null,
    promoCodeId: pc.id,
    now,
  });
  if (!id) return { ok: false, reason: "already_redeemed" };
  return { ok: true, plan: pc.plan, endsAt };
}
