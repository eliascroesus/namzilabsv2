import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getOrgContext } from "@/lib/auth";
import { effectiveAccess } from "@/lib/permissions";
import { getDb } from "@/db/client";
import { catalogEntry } from "@/connectors/catalog";
import { oauthProvider } from "@/lib/oauth/providers";
import { exchangeCode } from "@/lib/oauth/flow";
import { createConnection } from "@/lib/connections";
import { CapError } from "@/lib/limits";
import { parseOAuthState, isValidOAuthState, OAUTH_STATE_COOKIE } from "@/lib/oauth-state";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const org = await getOrgContext();
  if (!org) return NextResponse.redirect(new URL("/", req.url));
  {
    const access = await effectiveAccess(getDb(), org);
    if (!access.can("connect_integrations")) {
      return NextResponse.redirect(new URL("/integrations?error=rank_forbidden", req.url));
    }
  }
  const { provider: key } = await ctx.params;
  const provider = oauthProvider(key);
  if (!provider) return NextResponse.redirect(new URL("/integrations?error=oauth_unknown", req.url));

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
  const state = parseOAuthState(stateParam);
  if (!isValidOAuthState(stateParam, cookieNonce) || state.provider !== provider.key || !state.source) {
    return clearStateCookie(NextResponse.redirect(new URL("/integrations?error=state_mismatch", req.url)));
  }
  const entry = catalogEntry(state.source);
  if (!entry) return clearStateCookie(NextResponse.redirect(new URL("/integrations?error=oauth_unknown", req.url)));
  try {
    const tokens = await exchangeCode(provider, code);
    const conn = await createConnection({
      orgId: org.orgId,
      source: state.source,
      name: tokens.email ? `${entry.name} · ${tokens.email}` : entry.name,
      authType: "oauth2",
      credentials: tokens as unknown as Record<string, unknown>,
      config: {},
    });
    return clearStateCookie(NextResponse.redirect(new URL(`/connections/${conn.id}`, req.url)));
  } catch (err) {
    const dest = err instanceof CapError ? "/integrations?error=connection_limit" : "/integrations?error=oauth_exchange";
    return clearStateCookie(NextResponse.redirect(new URL(dest, req.url)));
  }
}
