"use server";

import { withAuth } from "@workos-inc/authkit-nextjs";
import { ensureReferralCode } from "@/lib/referral-store";

/**
 * MAKE MY CODE RESOLVABLE — called the moment somebody actually shares.
 *
 * The code itself is DERIVED (`referralCode`, a hash of the WorkOS user id), so
 * any surface can print a correct link with no database at all. What the
 * database is for is the reverse lookup at signup: `referral_codes` maps the
 * code back to its owner, and without a row there a shared link resolves to
 * nobody and the referral is silently lost.
 *
 * SO THE ROW IS WRITTEN ON INTENT, NOT ON RENDER. The refer page writes it
 * because opening that page is intent; the top bar's Share button cannot, so it
 * calls this when the link is copied. The alternative — writing it in
 * `AppShell` — is an INSERT on every authenticated page view in the product,
 * for a feature most of those views have nothing to do with.
 *
 * It takes no arguments and trusts nothing from the caller: the user comes from
 * the session, which is the same rule `renameOrganizationAction` follows and
 * for the same reason. A server action is a public endpoint whatever UI
 * happens to be calling it.
 *
 * Returns nothing. The caller already knows the link — it was rendered on the
 * server — so there is nothing to wait for, and the copy must not be held up by
 * a round trip it does not need.
 */
export async function claimReferralCode(): Promise<void> {
  try {
    const auth = await withAuth();
    if (!auth.user) return;
    await ensureReferralCode(auth.user.id);
  } catch (err) {
    // The link the caller just copied is still correct and still derivable.
    // Only the index is missing, and the refer page writes it again.
    console.error("[referral] claim failed", err);
  }
}
