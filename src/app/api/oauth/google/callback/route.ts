import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getOrgContext } from "@/lib/auth";
import { effectiveAccess } from "@/lib/permissions";
import { getDb } from "@/db/client";
import { exchangeGoogleCode } from "@/lib/google-oauth";
import { createConnection } from "@/lib/connections";
import { CapError } from "@/lib/limits";
import { parseOAuthState, isValidOAuthState, OAUTH_STATE_COOKIE } from "@/lib/oauth-state";

export const runtime = "nodejs";

/**
 * Google OAuth callback. The organization is derived ONLY from the authenticated
 * session — the browser cannot influence which org the connection lands in — and
 * the state nonce must match the session cookie set at the start of the flow.
 */
export async function GET(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.redirect(new URL("/", req.url));

  // Gated HERE, not only at /start: the callback is what writes the
  // connection, and OAuth can be entered without our start URL.
  {
    const access = await effectiveAccess(getDb(), ctx);
    if (!access.can("connect_integrations")) {
      return NextResponse.redirect(new URL("/integrations?error=rank_forbidden", req.url));
    }
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");

  const jar = await cookies();
  const cookieNonce = jar.get(OAUTH_STATE_COOKIE)?.value;

  const clearStateCookie = (res: NextResponse) => {
    res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };

  if (!code) return clearStateCookie(NextResponse.redirect(new URL("/integrations?error=oauth_denied", req.url)));
  if (!isValidOAuthState(stateParam, cookieNonce)) {
    return clearStateCookie(NextResponse.redirect(new URL("/integrations?error=state_mismatch", req.url)));
  }

  const { source } = parseOAuthState(stateParam);

  try {
    const tokens = await exchangeGoogleCode(code);
    // Label the connection with the Google account's email, so two connected
    // accounts are distinguishable at a glance ("Google Sheets · me@work.com").
    const product = source === "gcal" ? "Google Calendar" : "Google Sheets";
    const conn = await createConnection({
      orgId: ctx.orgId,
      source,
      name: tokens.email ? `${product} · ${tokens.email}` : product,
      authType: "oauth2",
      credentials: tokens as unknown as Record<string, unknown>,
      config: {},
    });
    return clearStateCookie(NextResponse.redirect(new URL(`/connections/${conn.id}`, req.url)));
  } catch (err) {
    // A cap hit is not an OAuth failure — mapping everything to
    // oauth_exchange would tell a capped workspace that Google broke.
    // Full literal URLs, not `error=${code}`: tests/integrations-errors.test.ts
    // greps this source for `error=` codes to guarantee each has human copy,
    // and a template variable would hide a code from that net.
    const dest = err instanceof CapError ? "/integrations?error=connection_limit" : "/integrations?error=oauth_exchange";
    return clearStateCookie(NextResponse.redirect(new URL(dest, req.url)));
  }
}
