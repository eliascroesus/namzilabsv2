import { NextResponse, type NextRequest } from "next/server";
import { REFERRAL_COOKIE, REFERRAL_COOKIE_DAYS, normaliseCode } from "@/lib/referral";

/**
 * A SHARED REFERRAL LINK, CAUGHT.
 *
 * This is the whole capture step: set a first-party cookie, send the visitor to
 * the landing page, get out of the way. It exists as a ROUTE HANDLER because a
 * page cannot set a cookie and middleware would charge every request in the
 * product for a feature used on one.
 *
 * WHY A COOKIE RATHER THAN CARRYING THE CODE THROUGH SIGN-UP. Almost nobody
 * converts inside one navigation. They open the link, read the page, close the
 * tab, and sign up on Thursday from a Google result — and a scheme that only
 * credits the referrer when the whole thing happens in one session loses most
 * of what it earned. Ninety days is the window (`REFERRAL_COOKIE_DAYS`); see
 * `referral.ts` for why that number.
 *
 * `sameSite: "lax"` IS LOAD-BEARING. Sign-up leaves for WorkOS and comes back,
 * and `strict` would withhold the cookie on that return navigation — the one
 * request where it is finally read. `lax` sends it on top-level GETs, which is
 * exactly the shape of an OAuth return and nothing else.
 *
 * `httpOnly` because only the server ever reads it, and there is no reason for
 * a script on the marketing page to be able to see or forge an attribution.
 *
 * A BAD CODE IS NOT AN ERROR. Links get truncated by chat clients and retyped
 * by hand. The visitor still gets the home page; they simply arrive unattributed,
 * which is the same outcome as typing the address themselves.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code: raw } = await ctx.params;
  const code = normaliseCode(raw);
  const base = process.env.APP_BASE_URL ?? _req.nextUrl.origin;
  const res = NextResponse.redirect(new URL("/", base));
  if (code) {
    res.cookies.set(REFERRAL_COOKIE, code, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: REFERRAL_COOKIE_DAYS * 24 * 60 * 60,
    });
  }
  return res;
}
