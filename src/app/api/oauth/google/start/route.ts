import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth";
import { effectiveAccess } from "@/lib/permissions";
import { getDb } from "@/db/client";
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
  // The same wall connectApiKeyAction stands behind. Without it, this GET was
  // a side door: any member could land a real connection by opening the URL.
  const access = await effectiveAccess(getDb(), ctx);
  if (!access.can("connect_integrations")) {
    return NextResponse.redirect(new URL("/integrations?error=rank_forbidden", req.url));
  }

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
