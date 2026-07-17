import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth";
import { buildGoogleAuthUrl, GOOGLE_SCOPES } from "@/lib/google-oauth";
import { createOAuthState, OAUTH_STATE_COOKIE } from "@/lib/oauth-state";

export const runtime = "nodejs";

/**
 * Begin Google OAuth for a Google-backed source. A cryptographically random
 * state nonce is stored in an httpOnly session cookie and echoed in the OAuth
 * `state` param; the callback validates the two match (CSRF protection). The
 * tenant is always taken from the session in the callback, never from `state`.
 */
export async function GET(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const source = new URL(req.url).searchParams.get("source") === "gcal" ? "gcal" : "gsheets";
  const { state, nonce } = createOAuthState(source);
  const url = buildGoogleAuthUrl({ scopes: GOOGLE_SCOPES[source], state });

  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes
  });
  return res;
}
