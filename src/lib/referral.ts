import { createHash } from "node:crypto";

/**
 * SOMEBODY'S OWN LINK TO THIS PRODUCT.
 *
 * THE CODE IS DERIVED, NOT STORED, and that is the point of doing it this way
 * rather than minting a row: there is no referral table yet, no reward terms
 * and no payout — and a derived code means there will not need to be a
 * backfill when there is. Every link handed out today resolves to the same
 * person the day attribution is switched on, because the code is a pure
 * function of a WorkOS user id that never changes.
 *
 * WHAT IT IS NOT. It is not a secret, it is not a password, and nothing may be
 * authorised by holding one. It is an identifier that travels in a URL, sits in
 * other people's browser history, and gets pasted into group chats — so the
 * only property it needs is that it does not LEAK the id it came from. A
 * truncated SHA-256 gives that: `user_01J…` is not recoverable from eight
 * base32 characters, and the reverse lookup (code -> user) is a scan the
 * attribution path can do against the handful of accounts it needs to check,
 * or an index when there are more.
 *
 * WHY NOT THE USER ID ITSELF. It would work and it would be shorter to write.
 * It also publishes an internal identifier on every share, which is the kind of
 * thing that is free to avoid now and expensive to take back later.
 */

/** Crockford-ish base32 without the letters that get misread aloud or retyped. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const LENGTH = 8;

export function referralCode(userId: string): string {
  const digest = createHash("sha256").update(`namzilabs:referral:${userId}`).digest();
  let out = "";
  for (let i = 0; i < LENGTH; i++) out += ALPHABET[digest[i] % ALPHABET.length];
  return out;
}

/**
 * The link itself. `base` comes from the caller because only the server knows
 * `APP_BASE_URL`, and a link that says `localhost` in somebody's tweet is worse
 * than no link — so an unset base yields a PATH, which the page then refuses to
 * offer rather than handing over something broken.
 */
export function referralLink(code: string, base: string | undefined): string {
  const path = `/?ref=${code}`;
  if (!base) return path;
  return `${base.replace(/\/+$/, "")}${path}`;
}
