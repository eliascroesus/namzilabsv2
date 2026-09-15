import { createHash } from "node:crypto";

/**
 * THE REFERRAL SCHEME — codes, the ladder, and the rules that stop it being
 * gamed. Pure functions only: every DATABASE touch lives in `referral-store.ts`,
 * so the parts with judgement in them can be tested without one.
 *
 * HOW THE TRACKING WORKS, END TO END, because the shape is the decision:
 *
 *   1. A person opens `/dashboard/refer`. Their code is DERIVED from their
 *      WorkOS user id and an index row is written (`referral_codes`) so it can
 *      be resolved later. Deriving rather than minting is what makes this
 *      backfill-free — a link shared before that row existed still resolves,
 *      because the same id always produces the same code.
 *   2. They share `https://app/r/CODE`.
 *   3. A visitor opens it. The route handler sets a first-party cookie and
 *      redirects to the landing page. A COOKIE, not a query string carried
 *      through sign-up: the visitor will read the page, leave, come back
 *      tomorrow and sign up from a Google result, and a scheme that only works
 *      when somebody converts inside one navigation is a scheme that loses most
 *      of what it earned.
 *   4. They sign up. `/callback`'s `onSuccess` reads the cookie, checks the
 *      account is genuinely NEW, and writes one `referrals` row.
 *
 * WHAT STOPS IT BEING FARMED. Four things, and three of them are in the
 * database rather than in application code, because that is where a guard
 * survives a refactor:
 *
 *   - `referred_user_id` is UNIQUE. A person can be referred exactly once in
 *     their life; clicking four links before signing up credits whoever was
 *     first, not all four.
 *   - self-referral is refused (`attributable` below).
 *   - the account must be newly created — an existing user clicking a link and
 *     signing IN is not a referral, and `user.createdAt` is the only honest
 *     signal for that.
 *   - the code must resolve to a real account. An invented one records nothing.
 */

/** Crockford-ish base32 without the letters that get misread aloud or retyped. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const LENGTH = 8;

/**
 * SOMEBODY'S OWN CODE — derived, never minted.
 *
 * It is not a secret, it is not a password, and nothing may be authorised by
 * holding one: it travels in URLs, sits in other people's browser history and
 * gets pasted into group chats. The only property it needs is that it does not
 * LEAK the id it came from, which a truncated SHA-256 gives. Using the user id
 * directly would work and would publish an internal identifier on every share —
 * free to avoid now, expensive to take back later.
 */
export function referralCode(userId: string): string {
  const digest = createHash("sha256").update(`namzilabs:referral:${userId}`).digest();
  let out = "";
  for (let i = 0; i < LENGTH; i++) out += ALPHABET[digest[i] % ALPHABET.length];
  return out;
}

/**
 * What a shared link looks like. `/r/CODE` rather than `/?ref=CODE`: it is
 * shorter to say out loud, it survives being pasted into a client that strips
 * query strings, and it gives the capture a ROUTE HANDLER to happen in — a page
 * cannot set a cookie, and adding middleware to the whole app to set one would
 * be a request-level cost paid on every page for a feature used on one.
 *
 * `base` comes from the caller because only the server knows `APP_BASE_URL`. An
 * unset base yields a PATH, which the page then refuses to hand over: a link
 * that says `localhost` in somebody's group chat is worse than no link.
 */
export function referralLink(code: string, base: string | undefined): string {
  const path = `/r/${code}`;
  if (!base) return path;
  return `${base.replace(/\/+$/, "")}${path}`;
}

/** A code off a URL, normalised. Anything that is not one comes back null. */
export function normaliseCode(raw: string | undefined | null): string | null {
  const c = (raw ?? "").trim().toUpperCase();
  return /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/.test(c) ? c : null;
}

/** The cookie a click leaves behind, and how long it is honoured. */
export const REFERRAL_COOKIE = "nz_ref";
/**
 * NINETY DAYS, which is the window the whole scheme is really choosing.
 *
 * Short windows (24h, 7d) under-credit: the gap between "somebody showed me
 * this" and "I signed up" for a business tool is measured in weeks, because the
 * decision usually waits for a moment when the problem bites. Long windows
 * (a year) over-credit, and make a stale cookie decide an attribution the
 * visitor has long forgotten. Ninety days is where most B2B programmes land
 * and it is long enough that the referrer is still recognisably the reason.
 */
export const REFERRAL_COOKIE_DAYS = 90;

/**
 * IS THIS A REFERRAL WE MAY RECORD? The four guards in one place, taking a
 * clock rather than reading one, so the "new account" boundary is testable.
 *
 * `NEW_ACCOUNT_MINUTES` is deliberately generous. It is not a security
 * parameter — `referred_user_id` being UNIQUE is what stops repeat credit —
 * it only separates "signed up just now" from "has had an account for months
 * and happened to click a link". Thirty minutes covers an OAuth round trip, a
 * forgotten-password detour and somebody making a coffee mid-signup.
 */
export const NEW_ACCOUNT_MINUTES = 30;

export function attributable(
  input: { referrerUserId: string | null; newUserId: string; createdAt: Date | null },
  now: Date = new Date(),
): boolean {
  const { referrerUserId, newUserId, createdAt } = input;
  if (!referrerUserId) return false; // the code resolved to nobody
  if (referrerUserId === newUserId) return false; // nobody refers themselves
  if (!createdAt) return false; // no signal that this account is new — refuse
  const age = now.getTime() - createdAt.getTime();
  if (age < 0) return false; // a clock skew is not a licence
  return age <= NEW_ACCOUNT_MINUTES * 60_000;
}

/**
 * THE LADDER.
 *
 * ═══ THESE ARE PRODUCT PROMISES. Change them HERE and nowhere else. ═══
 *
 * Every string below is shown to a customer as a thing they will receive, so
 * the list is the offer and editing it is a commercial decision rather than a
 * copy edit. It is one array so the page, the progress bar and any future
 * fulfilment read the same numbers — a ladder spelled twice is a ladder that
 * pays out differently from how it was advertised.
 *
 * WHY IT IS SHAPED LIKE THIS, from what actually works:
 *
 *   - THE FIRST RUNG IS ONE. Dropbox's scheme and Loom's both reward the FIRST
 *     invite, because the gap between zero and one is the only gap most people
 *     never cross. A ladder starting at five tells the 90% who will refer one
 *     person that they are playing for nothing.
 *   - THE RUNGS GET FURTHER APART (1, 3, 5, 10, 25). Even spacing makes the
 *     late game feel identical to the early game; widening gaps with widening
 *     rewards is what keeps a bar worth watching after the easy wins.
 *   - EVERY REWARD IS SOMETHING THIS PRODUCT CAN ACTUALLY GRANT — months of
 *     Namzilabs, not cash. Cash needs a payout rail, tax handling and a fraud
 *     team; months need a flag. A scheme that cannot pay what it promised is
 *     worse than no scheme.
 *   - IT STOPS AT A YEAR. A fifth rung offered lifetime access plus revenue
 *     share and came off at the owner's ask, which is the right call twice
 *     over: revenue share is the cash problem above wearing a different word,
 *     and a permanent giveaway is the one reward that cannot be withdrawn if
 *     the scheme turns out to cost more than it earns.
 */
/**
 * `blurb` IS GONE, not merely unrendered. The cards under the track carried a
 * sentence each and they came off at the owner's ask — and a field that nothing
 * reads is worse than no field, because the next person to add a rung writes
 * one and wonders why it never appears.
 */
export type Milestone = { at: number; reward: string };

export const MILESTONES: Milestone[] = [
  { at: 1, reward: "1 month free" },
  { at: 3, reward: "3 months free" },
  { at: 5, reward: "6 months free" },
  { at: 10, reward: "1 year free" },
];

/** Where somebody is on the ladder, and how far to the next rung. */
export type Progress = {
  count: number;
  /** The highest rung already earned, or null below the first. */
  earned: Milestone | null;
  /** The rung being worked toward, or null once the ladder is finished. */
  next: Milestone | null;
  /** How many more are needed for `next`. 0 once the ladder is finished. */
  toGo: number;
  /**
   * 0–100 across the CURRENT RUNG's span, not across the whole ladder.
   *
   * The gap you are in — from the last rung you passed to the next one. Kept
   * because it is what the "N more to go" copy is counting, but it is NOT what
   * the bar draws; see `ladderPercent`.
   */
  percent: number;
  /**
   * 0–100 across the WHOLE LADDER, with every rung given an EQUAL share of the
   * track rather than a share proportional to its size.
   *
   * This is what the bar actually draws, and the equal-share part is the whole
   * idea. The rungs are 1, 3, 5, 10, 25 — laid out to scale, the first four
   * would crowd into the left sixth of the bar and the run to 25 would be
   * two-thirds of it, so the early wins that matter most would be invisible and
   * the late game would look impossible. Five equal segments means every rung
   * is a fifth of the journey, and one invite is always a visible step.
   *
   * It replaced `percent` on the bar because `percent` resets to zero the
   * moment you EARN something: cross rung one and the bar you were filling
   * empties. Correct about the next gap, and a terrible thing to watch happen
   * right after an achievement.
   */
  ladderPercent: number;
};

export function progressFor(count: number): Progress {
  // `Math.floor(NaN)` is NaN and `Math.max(0, NaN)` is NaN, so the guard is the
  // other way round: anything that is not a real number becomes zero. `percent`
  // goes straight into a `style={{ width }}`, and a NaN there is an invisible
  // bar on the one page this whole feature is about.
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const earned = [...MILESTONES].reverse().find((m) => n >= m.at) ?? null;
  const next = MILESTONES.find((m) => n < m.at) ?? null;
  if (!next) return { count: n, earned, next: null, toGo: 0, percent: 100, ladderPercent: 100 };

  const floor = earned?.at ?? 0;
  const span = next.at - floor;
  const withinRung = (n - floor) / span;
  // Which segment of the track we are in: rung 0 is the run to the first
  // milestone, rung 1 the run from the first to the second, and so on.
  const segment = MILESTONES.indexOf(next);
  return {
    count: n,
    earned,
    next,
    toGo: next.at - n,
    percent: Math.min(100, Math.round(withinRung * 100)),
    ladderPercent: Math.min(100, Math.round(((segment + withinRung) / MILESTONES.length) * 100)),
  };
}
