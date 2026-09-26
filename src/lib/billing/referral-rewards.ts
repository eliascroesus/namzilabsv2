import { and, asc, count, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import { accessGrants, billingSubscriptions, referrals, workspaceOwners } from "@/db/schema";
import type { DB } from "@/db/types";
import { recordAudit } from "@/lib/audit";
import { MILESTONES, type Milestone } from "@/lib/referral";
import { applyPlan } from "./pauses";
import { PLANS } from "./plans";
import { addMonths, billingEnabled } from "./state";
import { stripeClient, type StripeClient } from "./stripe";

/**
 * REFERRAL REWARDS, PAID AS THE LADDER PROMISES — with nobody doing it by hand.
 *
 * `MILESTONES` is what the customer is shown and what this pays: reaching a
 * rung gives the referrer's workspace that rung's `months` of Growth. The
 * ladder stops at a year; the lifetime rung came off at the owner's ask (see
 * `lib/referral.ts`), so nothing here grants for life.
 *
 * WHICH WORKSPACE: one — the referrer's own. If any workspace they own pays
 * through Stripe, that one, because a grant of Growth to a workspace already
 * paying for it is worth nothing; the months become a credit of Growth's
 * monthly price per month on its Stripe balance instead, which the next
 * invoices draw down. Otherwise the first workspace they made.
 *
 * MONTHS ADD UP. Each rung's grant starts where the workspace's free time
 * already ends (a trial, a code, the last rung), so reaching three invites is
 * the first month AND the next three, as the ladder reads — not three months
 * overlapping the one already running.
 *
 * ONCE PER RUNG PER PERSON, by the unique index on (referrer_user_id,
 * referral_rung) — not per workspace, because the workspace a reward lands on
 * can change. A credit is recorded as a referral row with no time in it, so
 * both kinds of reward claim the same slot. Anything that fails records nothing, and the
 * next run — the next referral, or the admin's launch run — pays it then.
 */

export type RewardOutcome =
  | { rung: number; months: number; form: "grant" | "credit"; orgId: string; amountCents?: number }
  | { rung: number; months: number; form: "failed"; orgId: string; error: string };

/** Subscription statuses that are being paid for — the same list the plan resolver trusts. */
const PAYING = ["active", "trialing", "past_due"];

async function referralCount(db: DB, userId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(referrals).where(eq(referrals.referrerUserId, userId));
  return Number(row?.n ?? 0);
}

/** The workspace a reward lands on, and the Stripe customer when it pays. */
async function rewardTarget(db: DB, userId: string): Promise<{ orgId: string; customerId: string | null } | null> {
  const owned = await db
    .select({ orgId: workspaceOwners.orgId })
    .from(workspaceOwners)
    .where(eq(workspaceOwners.userId, userId))
    .orderBy(asc(workspaceOwners.claimedAt));
  if (owned.length === 0) return null;
  const paying = await db
    .select({ orgId: billingSubscriptions.orgId, customerId: billingSubscriptions.stripeCustomerId })
    .from(billingSubscriptions)
    .where(
      and(
        inArray(
          billingSubscriptions.orgId,
          owned.map((o) => o.orgId),
        ),
        inArray(billingSubscriptions.status, PAYING),
      ),
    );
  const payer = owned.find((o) => paying.some((p) => p.orgId === o.orgId));
  if (payer) return { orgId: payer.orgId, customerId: paying.find((p) => p.orgId === payer.orgId)!.customerId };
  return { orgId: owned[0].orgId, customerId: null };
}

/** Where a new grant should start: the end of the workspace's latest free time, or now. */
async function freeTimeEnds(db: DB, orgId: string, now: Date): Promise<Date> {
  const rows = await db
    .select({ endsAt: accessGrants.endsAt })
    .from(accessGrants)
    .where(and(eq(accessGrants.orgId, orgId), isNull(accessGrants.revokedAt), isNotNull(accessGrants.endsAt), gt(accessGrants.endsAt, now)));
  let latest = now;
  for (const r of rows) if (r.endsAt && r.endsAt.getTime() > latest.getTime()) latest = r.endsAt;
  return latest;
}

/** Rungs already paid to this PERSON, on whichever workspace they landed. */
async function paidRungs(db: DB, referrerUserId: string): Promise<Set<number>> {
  const rows = await db
    .select({ rung: accessGrants.referralRung })
    .from(accessGrants)
    .where(and(eq(accessGrants.referrerUserId, referrerUserId), isNotNull(accessGrants.referralRung)));
  return new Set(rows.map((r) => r.rung!));
}

export async function grantReferralRewards(
  db: DB,
  referrerUserId: string,
  opts: { now?: Date; client?: StripeClient } = {},
): Promise<RewardOutcome[]> {
  if (!billingEnabled()) return [];
  const now = opts.now ?? new Date();
  const reached = await reachedRungs(db, referrerUserId);
  if (reached.length === 0) return [];
  const target = await rewardTarget(db, referrerUserId);
  if (!target) return [];

  const paid = await paidRungs(db, referrerUserId);
  const due = reached.filter((m) => !paid.has(m.at));
  const out: RewardOutcome[] = [];
  let client = opts.client;

  for (const m of due) {
    const outcome = target.customerId
      ? await creditRung(db, target.orgId, referrerUserId, target.customerId, m, now, () => (client ??= stripeClient()))
      : await grantRung(db, target.orgId, referrerUserId, m, now);
    // Null: a concurrent run paid this rung first. Nothing to say twice.
    if (!outcome) continue;
    out.push(outcome);
    await recordAudit(db, {
      action: "billing.referral_reward",
      orgId: target.orgId,
      actorId: null,
      target: referrerUserId,
      detail: { rung: m.at, months: m.months, form: outcome.form, amountCents: "amountCents" in outcome ? (outcome.amountCents ?? null) : null },
    });
  }
  if (out.some((o) => o.form === "grant")) await applyPlan(db, target.orgId).catch(() => {});
  return out;
}

async function reachedRungs(db: DB, userId: string): Promise<Milestone[]> {
  const n = await referralCount(db, userId);
  return MILESTONES.filter((m) => n >= m.at);
}

async function grantRung(db: DB, orgId: string, referrerUserId: string, m: Milestone, now: Date): Promise<RewardOutcome | null> {
  const startsAt = await freeTimeEnds(db, orgId, now);
  const written = await db
    .insert(accessGrants)
    .values({
      orgId,
      plan: "growth",
      kind: "referral",
      startsAt,
      endsAt: addMonths(startsAt, m.months),
      referralRung: m.at,
      referrerUserId,
      note: `Referral reward: ${m.reward} for ${m.at} ${m.at === 1 ? "invite" : "invites"}`,
    })
    .onConflictDoNothing()
    .returning({ id: accessGrants.id });
  // A concurrent run got there first — the rung is paid, just not by this call.
  if (written.length === 0) return null;
  return { rung: m.at, months: m.months, form: "grant", orgId };
}

async function creditRung(
  db: DB,
  orgId: string,
  referrerUserId: string,
  customerId: string,
  m: Milestone,
  now: Date,
  client: () => StripeClient,
): Promise<RewardOutcome | null> {
  const amountCents = PLANS.growth.price!.month * 100 * m.months;
  try {
    const txn = await client().customers.createBalanceTransaction(
      customerId,
      { amount: -amountCents, currency: "usd", description: `Referral reward: ${m.reward} (${m.at} ${m.at === 1 ? "invite" : "invites"})` },
      // Stripe keeps a key for 24 hours — long enough to cover a retried run.
      // Keyed by the PERSON and the rung, like the rows: the same reward can
      // never be two credits, whichever workspace it lands on.
      { idempotencyKey: `referral-reward:${referrerUserId}:${m.at}` },
    );
    const written = await db
      .insert(accessGrants)
      .values({
        orgId,
        plan: "growth",
        kind: "referral",
        // No time in it: the reward was money, not plan time. It is here to
        // claim the rung, so the same months are never paid again.
        startsAt: now,
        endsAt: now,
        referralRung: m.at,
        referrerUserId,
        note: `Referral reward: ${m.reward} as a $${amountCents / 100} Stripe credit (${txn.id})`,
      })
      .onConflictDoNothing()
      .returning({ id: accessGrants.id });
    // A concurrent run recorded it first; the shared idempotency key made
    // Stripe hand both runs the one transaction, so it was credited once.
    if (written.length === 0) return null;
    return { rung: m.at, months: m.months, form: "credit", orgId, amountCents };
  } catch (e) {
    console.error("[referral] credit failed", e);
    return { rung: m.at, months: m.months, form: "failed", orgId, error: e instanceof Error ? e.message : String(e) };
  }
}
