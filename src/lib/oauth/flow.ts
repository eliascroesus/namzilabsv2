import { fetchJson } from "@/lib/http-client";
import type { OAuthProvider, OAuthTokens } from "./providers";

function appBaseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/** `<KEY>_REDIRECT_URI` overrides; otherwise `${APP_BASE_URL}/api/oauth/<key>/callback` — the path Google already has registered. */
export function redirectUriFor(p: OAuthProvider): string {
  return process.env[`${p.key.toUpperCase()}_REDIRECT_URI`] ?? `${appBaseUrl()}/api/oauth/${p.key}/callback`;
}

export function buildAuthUrl(p: OAuthProvider, opts: { source: string; state: string }): string {
  const clientId = reqEnv(p.clientIdEnv);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUriFor(p),
    response_type: "code",
    scope: p.scopesFor(opts.source).join(" "),
    ...(p.authParams ?? {}),
    state: opts.state,
  });
  return `${p.authorizeUrl}?${params.toString()}`;
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number; token_type?: string } & Record<string, unknown>;

async function tokenRequest(p: OAuthProvider, body: URLSearchParams): Promise<TokenResponse> {
  return fetchJson<TokenResponse>(p.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

export async function exchangeCode(p: OAuthProvider, code: string): Promise<OAuthTokens> {
  const res = await tokenRequest(
    p,
    new URLSearchParams({
      code,
      client_id: reqEnv(p.clientIdEnv),
      client_secret: reqEnv(p.clientSecretEnv),
      redirect_uri: redirectUriFor(p),
      grant_type: "authorization_code",
    }),
  );
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token,
    expiresAt: Date.now() + (res.expires_in ?? 3600) * 1000,
    email: p.identity?.(res),
  };
}

export async function refreshTokens(p: OAuthProvider, refreshToken: string): Promise<OAuthTokens> {
  const res = await tokenRequest(
    p,
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: reqEnv(p.clientIdEnv),
      client_secret: reqEnv(p.clientSecretEnv),
      grant_type: "refresh_token",
    }),
  );
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token ?? refreshToken,
    expiresAt: Date.now() + (res.expires_in ?? 3600) * 1000,
  };
}

/**
 * HAND THE GRANT BACK — the last thing a connection does on its way out.
 *
 * Dropping the encrypted row removes OUR ability to use a token. It does
 * nothing about the authorisation itself: the customer's Google account goes
 * on listing Namzilabs among the apps with access to their spreadsheets,
 * indefinitely, for a workspace that no longer exists. For a product whose
 * whole job is other people's data, that is the wrong resting state.
 *
 * THE REFRESH TOKEN FIRST. Google revokes the entire grant when handed either
 * one, but an access token is minutes old and may already have expired — the
 * refresh token is the durable half and the one actually worth ending.
 *
 * FORM-ENCODED, AND NOT VIA `fetchJson`. The revocation endpoint answers 200
 * with an EMPTY body, which a JSON parse treats as a failure — the call would
 * succeed and be logged as having failed.
 *
 * NEVER THROWS. The caller is a delete the customer has already confirmed, and
 * a provider that is slow, unreachable or has already forgotten the grant must
 * not hold that hostage. Same policy as the webhook teardown beside it.
 */
export async function revokeOAuthGrant(p: OAuthProvider, tokens: OAuthTokens): Promise<"revoked" | "failed" | "none"> {
  if (!p.revokeUrl) return "none";
  const token = tokens.refreshToken ?? tokens.accessToken;
  if (!token) return "none";
  try {
    const res = await fetch(p.revokeUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
    /**
     * A 400 HERE IS USUALLY SUCCESS ALREADY ACHIEVED — Google answers
     * `invalid_token` for a grant that has already been revoked, or one the
     * user withdrew from their own account page. The outcome we wanted is the
     * outcome we have, so it is not reported as a failure.
     */
    if (res.ok || res.status === 400) return "revoked";
    console.warn(`[oauth] revoke returned ${res.status} for ${p.key}`);
    return "failed";
  } catch (e) {
    console.warn(`[oauth] revoke failed for ${p.key}: ${e instanceof Error ? e.message : String(e)}`);
    return "failed";
  }
}
