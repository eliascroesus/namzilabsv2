import { cache } from "react";
import { eq } from "drizzle-orm";
import { getReadDb } from "@/db/client";
import { userProfiles } from "@/db/schema";

/**
 * WHO SOMEBODY IS, AS THE PRODUCT SHOWS THEM.
 *
 * The email comes from WorkOS and the name and picture come from us — see the
 * header on `user_profiles` for why that split is deliberate rather than
 * accidental. This module is the one place the two are put back together, so
 * "what do we call this person" has a single answer instead of one per surface.
 */
export type Profile = {
  /** What to call them: their chosen name, or their email if they never set one. */
  name: string;
  /** Their chosen name, or null. Distinct from `name`, which always has a value. */
  displayName: string | null;
  avatarUrl: string | null;
  /** Two letters for the fallback chip the rail and top bar already draw. */
  initials: string;
};

/**
 * TWO LETTERS FROM WHATEVER WE HAVE.
 *
 * Spelled once here because three surfaces draw this chip — the rail's foot, the
 * top bar's trigger, and the panel that opens from it — and three copies of
 * "take the first letters" is how one of them ends up disagreeing on a
 * hyphenated name. It is also the reason this file exports it rather than
 * keeping it private.
 *
 * A NAME SPLITS ON WORDS, AN EMAIL DOES NOT. "Elias Croesus" is EC; an email is
 * its first two characters, because `eliascroesus@gmail.com` has no word
 * boundary to find and "el" is what every other product shows for it.
 */
export function initialsOf(source: string): string {
  const trimmed = source.trim();
  if (!trimmed) return "?";
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}

/**
 * `cache()`d PER REQUEST, because the shell renders on every route and would
 * otherwise ask twice: once for the rail's chip and once for the panel behind
 * it. Same discipline as `navViews`.
 *
 * NEVER THROWS. A profile is decoration on every screen it appears on — the rail
 * must render if this read fails, exactly as `navViewsOrNone` must. The fallback
 * is the email, which the caller already has from the session.
 */
export const getProfile = cache(async (userId: string, email: string | null): Promise<Profile> => {
  const fallback = email ?? "Your account";
  try {
    const [row] = await getReadDb()
      .select({ displayName: userProfiles.displayName, avatarUrl: userProfiles.avatarUrl })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    const displayName = row?.displayName?.trim() || null;
    return {
      name: displayName ?? fallback,
      displayName,
      avatarUrl: row?.avatarUrl ?? null,
      initials: initialsOf(displayName ?? fallback),
    };
  } catch (err) {
    console.error("[profile] read failed", err);
    return { name: fallback, displayName: null, avatarUrl: null, initials: initialsOf(fallback) };
  }
});
