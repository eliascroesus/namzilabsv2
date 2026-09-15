import { catalogEntry } from "@/connectors/catalog";

export type OAuthTokens = { accessToken: string; refreshToken?: string; expiresAt: number; email?: string };

export type OAuthProvider = {
  key: string;
  /** Display name for messages: "Google access has expired…". */
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  /**
   * WHERE TO HAND THE GRANT BACK, if the provider has such an endpoint.
   *
   * Deleting our copy of a token is not the same act as ending the customer's
   * authorisation. Without this, a workspace that has been destroyed leaves
   * "Namzilabs" sitting in the customer's Google account permissions forever —
   * we can no longer use it, and they have no way to know that, so the only
   * honest state is to say so to the provider.
   *
   * Optional because not every provider offers one. Absent means the grant can
   * only be withdrawn from the provider's own settings, which is a fact about
   * them rather than a thing to paper over.
   */
  revokeUrl?: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  /** The scopes to request for a given source (one provider can back several). */
  scopesFor: (source: string) => string[];
  /** Extra authorize-URL params, appended after `scope` and before `state`. */
  authParams?: Record<string, string>;
  /** "standard" = refresh_token grant at `tokenUrl`; "none" = tokens do not expire. */
  refresh: "standard" | "none";
  /** A label for the connection from the raw token response (Google: the id_token's email). */
  identity?: (raw: Record<string, unknown>) => string | undefined;
};

const GOOGLE_SCOPES: Record<string, string[]> = {
  gsheets: ["https://www.googleapis.com/auth/spreadsheets.readonly", "https://www.googleapis.com/auth/drive.readonly"],
  gcal: ["https://www.googleapis.com/auth/calendar.readonly"],
};

function emailFromIdToken(idToken: unknown): string | undefined {
  if (typeof idToken !== "string") return undefined;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as { email?: unknown };
    return typeof payload.email === "string" && payload.email.includes("@") ? payload.email : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every OAuth provider the app can send a customer to. Adding one is one
 * entry here plus its client id and secret in the environment; the start and
 * callback routes, the state cookie and token refresh are shared.
 */
export const OAUTH_PROVIDERS: Record<string, OAuthProvider> = {
  google: {
    key: "google",
    name: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    scopesFor: (source) => ["openid", "email", ...(GOOGLE_SCOPES[source] ?? [])],
    authParams: { access_type: "offline", include_granted_scopes: "true", prompt: "consent select_account" },
    refresh: "standard",
    identity: (raw) => emailFromIdToken(raw["id_token"]),
  },
};

export function oauthProvider(key: string | null | undefined): OAuthProvider | undefined {
  return key ? OAUTH_PROVIDERS[key] : undefined;
}

/** The provider a source authenticates through, from its catalog entry. */
export function oauthProviderFor(source: string | null | undefined): OAuthProvider | undefined {
  const entry = catalogEntry(source ?? "");
  if (!entry) return undefined;
  if (entry.connect === "google") return OAUTH_PROVIDERS.google;
  if (entry.connect === "oauth") return oauthProvider(entry.oauthProvider);
  return undefined;
}
