import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { referralCodes, referrals } from "@/db/schema";
import { attributable, normaliseCode, referralCode } from "@/lib/referral";

/**
 * THE DATABASE HALF OF THE REFERRAL SCHEME. Every rule with judgement in it is
 * in `referral.ts` and pure; this is the three queries around them.
 *
 * NOTHING IN HERE MAY THROW INTO A REQUEST. A referral is a nice-to-have on
 * every path it touches: the refer page, and the sign-in callback. Losing one
 * attribution is a bad day; taking out somebody's first-ever sign-in because a
 * bookkeeping insert failed is a different category of bad. So every function
 * swallows, logs, and answers with the harmless value.
 */

/**
 * Make sure this person's code is resolvable, and hand it back.
 *
 * WRITTEN LAZILY, at the only moment it could possibly matter: you cannot share
 * a link you have never been shown. The alternative — a row per user at signup
 * — writes for every account that never opens the page, on the one request that
 * must not get slower.
 *
 * `onConflictDoNothing` on BOTH keys: the code is derived, so re-running this
 * for the same user produces the same pair and the second write is a no-op
 * rather than a violation.
 */
export async function ensureReferralCode(userId: string): Promise<string> {
  const code = referralCode(userId);
  try {
    await getDb().insert(referralCodes).values({ code, userId }).onConflictDoNothing();
  } catch (err) {
    // The code is still correct and still derivable — only the INDEX is
    // missing, and the next page view writes it again.
    console.error("[referral] code index write failed", err);
  }
  return code;
}

/** How many people this person has brought, and when the last one arrived. */
export async function referralStats(userId: string): Promise<{ count: number; recent: Date[] }> {
  try {
    const rows = await getDb()
      .select({ at: referrals.createdAt })
      .from(referrals)
      .where(eq(referrals.referrerUserId, userId))
      .orderBy(desc(referrals.createdAt))
      .limit(50);
    return { count: rows.length, recent: rows.map((r) => r.at) };
  } catch (err) {
    console.error("[referral] stats read failed", err);
    return { count: 0, recent: [] };
  }
}

/**
 * RECORD A SIGNUP AGAINST A CODE — the one write the whole scheme exists for.
 *
 * Called from `/callback`'s `onSuccess`, which runs on EVERY sign-in, so the
 * guards matter more than the insert:
 *
 *   - the code must be well-formed and must resolve to a real account;
 *   - it may not be the new user's own;
 *   - the account must have been created minutes ago, not months — an existing
 *     user clicking a link and signing IN is not a referral;
 *   - and `referred_user_id` is UNIQUE, so even a guard that let something
 *     through can only ever credit one person, once.
 *
 * Returns whether a row was written, so the caller knows whether to clear the
 * cookie — a cookie cleared on a REFUSED attribution would silently drop a
 * legitimate referral for somebody who signed in before signing up.
 */
export async function recordReferral(input: {
  rawCode: string | undefined | null;
  newUserId: string;
  createdAt: Date | null;
  now?: Date;
}): Promise<boolean> {
  const code = normaliseCode(input.rawCode);
  if (!code) return false;
  try {
    const [owner] = await getDb()
      .select({ userId: referralCodes.userId })
      .from(referralCodes)
      .where(eq(referralCodes.code, code))
      .limit(1);
    const referrerUserId = owner?.userId ?? null;
    if (!attributable({ referrerUserId, newUserId: input.newUserId, createdAt: input.createdAt }, input.now ?? new Date()))
      return false;

    const written = await getDb()
      .insert(referrals)
      .values({ referrerUserId: referrerUserId!, referredUserId: input.newUserId, code })
      .onConflictDoNothing()
      .returning({ id: referrals.id });
    return written.length > 0;
  } catch (err) {
    console.error("[referral] attribution failed", err);
    return false;
  }
}
