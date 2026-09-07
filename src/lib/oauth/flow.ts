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
