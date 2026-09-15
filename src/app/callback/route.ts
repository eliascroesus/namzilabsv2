import { handleAuth } from "@workos-inc/authkit-nextjs";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { REFERRAL_COOKIE } from "@/lib/referral";
import { recordReferral } from "@/lib/referral-store";

/**
 * WorkOS redirects here after authentication (must match
 * NEXT_PUBLIC_WORKOS_REDIRECT_URI, e.g. https://namzilabs.co/callback).
 *
 * onError: without it, any callback failure answers with the SDK's raw JSON
 * blob — which is what an invited teammate once saw as their very first
 * contact with the product. The SDK has already console.error'd the real
 * cause ("[AuthKit callback error]", visible in Vercel logs) by the time
 * onError runs, so this adds no logging — it only turns the dead end into
 * a human page with the two fixes that cover the common cases.
 *
 * onSuccess: THE ONE MOMENT A REFERRAL CAN BE RECORDED.
 *
 * It is the first request in the product that knows both halves — the cookie a
 * click left behind ninety days ago, and who just signed in. Nowhere later has
 * the cookie (it is cleared here) and nowhere earlier has the user.
 *
 * IT RUNS ON EVERY SIGN-IN, NOT JUST SIGN-UP, which is why the guards live in
 * `recordReferral` rather than here: an existing customer who clicks a friend's
 * link and signs in must not credit that friend, and the `createdAt` window is
 * what separates the two. The UNIQUE on `referred_user_id` is the wall behind
 * that.
 *
 * THE COOKIE IS CLEARED ONLY ON SUCCESS. Somebody who signs IN before they sign
 * UP — different email, second account, an invite they accepted first — would
 * otherwise have their attribution thrown away by the sign-in that preceded it.
 *
 * IT MAY NOT THROW. This is the first thing a new customer ever does, and a
 * failed bookkeeping insert must not be the first thing they see; `recordReferral`
 * swallows everything and answers false, and the `catch` here is the second belt.
 */
export const GET = handleAuth({
  returnPathname: "/dashboard",
  onSuccess: async ({ user }) => {
    try {
      const jar = await cookies();
      const raw = jar.get(REFERRAL_COOKIE)?.value;
      if (!raw) return;
      const created = user.createdAt ? new Date(user.createdAt) : null;
      const written = await recordReferral({ rawCode: raw, newUserId: user.id, createdAt: created });
      if (written) jar.delete(REFERRAL_COOKIE);
    } catch (err) {
      console.error("[referral] callback attribution failed", err);
    }
  },
  onError: ({ request }) => NextResponse.redirect(new URL("/auth-error", request.url)),
});
