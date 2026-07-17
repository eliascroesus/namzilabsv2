import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getOrgContext } from "@/lib/auth";
import { exchangeGoogleCode } from "@/lib/google-oauth";
import { createConnection } from "@/lib/connections";
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
    const conn = await createConnection({
      orgId: ctx.orgId,
      source,
      name: source === "gcal" ? "Google Calendar" : "Google Sheets",
      authType: "oauth2",
      credentials: tokens as unknown as Record<string, unknown>,
      config: {},
    });
    return clearStateCookie(NextResponse.redirect(new URL(`/connections/${conn.id}`, req.url)));
  } catch {
    return clearStateCookie(NextResponse.redirect(new URL("/integrations?error=oauth_exchange", req.url)));
  }
}
