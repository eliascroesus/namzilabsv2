import { fetchJson } from "./http-client";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** OAuth scopes per Google-backed source (read-only). */
export const GOOGLE_SCOPES: Record<string, string[]> = {
  gsheets: [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
  ],
  gcal: ["https://www.googleapis.com/auth/calendar.readonly"],
};

export type GoogleTokens = {
  accessToken: string;
  refreshToken?: string;
  /** Absolute expiry in epoch ms. */
  expiresAt: number;
  /** The Google account's email (from the id_token) — labels the connection. */
  email?: string;
};

function baseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}

export function googleRedirectUri(): string {
  return process.env.GOOGLE_REDIRECT_URI ?? `${baseUrl()}/api/oauth/google/callback`;
}

export function buildGoogleAuthUrl(opts: { scopes: string[]; state: string }): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not set");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: ["openid", "email", ...opts.scopes].join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    // select_account: always show the account chooser, so a user with several Google
    // accounts can pick which one to connect (instead of Google silently reusing the
    // signed-in session and creating two identical-looking connections).
    prompt: "consent select_account",
    state: opts.state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  id_token?: string;
};

/**
 * The account email from an id_token's payload. Decoded without signature checks —
 * fine here because the token came straight from Google's token endpoint over TLS
 * and is used only to label the connection, never for authorization.
 */
function emailFromIdToken(idToken: string | undefined): string | undefined {
  if (!idToken) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as { email?: unknown };
    return typeof payload.email === "string" && payload.email.includes("@") ? payload.email : undefined;
  } catch {
    return undefined;
  }
}

export async function exchangeGoogleCode(code: string): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    code,
    client_id: reqEnv("GOOGLE_CLIENT_ID"),
    client_secret: reqEnv("GOOGLE_CLIENT_SECRET"),
    redirect_uri: googleRedirectUri(),
    grant_type: "authorization_code",
  });
  const res = await fetchJson<GoogleTokenResponse>(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token,
    expiresAt: Date.now() + res.expires_in * 1000,
    email: emailFromIdToken(res.id_token),
  };
}

export async function refreshGoogleToken(refreshToken: string): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: reqEnv("GOOGLE_CLIENT_ID"),
    client_secret: reqEnv("GOOGLE_CLIENT_SECRET"),
    grant_type: "refresh_token",
  });
  const res = await fetchJson<GoogleTokenResponse>(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token ?? refreshToken,
    expiresAt: Date.now() + res.expires_in * 1000,
  };
}

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}
