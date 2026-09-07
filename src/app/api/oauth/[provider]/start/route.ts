import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth";
import { effectiveAccess } from "@/lib/permissions";
import { getDb } from "@/db/client";
import { oauthProvider, oauthProviderFor } from "@/lib/oauth/providers";
import { buildAuthUrl } from "@/lib/oauth/flow";
import { createOAuthState, OAUTH_STATE_COOKIE } from "@/lib/oauth-state";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const org = await getOrgContext();
  if (!org) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await effectiveAccess(getDb(), org);
  if (!access.can("connect_integrations")) {
    return NextResponse.redirect(new URL("/integrations?error=rank_forbidden", req.url));
  }
  const { provider: key } = await ctx.params;
  const provider = oauthProvider(key);
  const source = new URL(req.url).searchParams.get("source") ?? "";
  // The source must belong to this provider — a URL cannot borrow Google's
  // consent screen for another connector.
  if (!provider || oauthProviderFor(source)?.key !== provider.key) {
    return NextResponse.redirect(new URL("/integrations?error=oauth_unknown", req.url));
  }
  const { state, nonce } = createOAuthState({ provider: provider.key, source });
  const res = NextResponse.redirect(buildAuthUrl(provider, { source, state }));
  res.cookies.set(OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
