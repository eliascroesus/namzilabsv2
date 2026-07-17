import { randomBytes } from "node:crypto";

/** Short-lived, httpOnly cookie that binds the OAuth state nonce to the browser session. */
export const OAUTH_STATE_COOKIE = "g_oauth_state";

export type GoogleSource = "gsheets" | "gcal";

/** Create a cryptographically random state carrying a nonce + the (non-sensitive) source. */
export function createOAuthState(source: GoogleSource): { state: string; nonce: string } {
  const nonce = randomBytes(24).toString("base64url");
  const state = Buffer.from(JSON.stringify({ nonce, source })).toString("base64url");
  return { state, nonce };
}

/** Parse a returned state param. `nonce` is null when the state is malformed. */
export function parseOAuthState(state: string | null): { nonce: string | null; source: GoogleSource } {
  try {
    const parsed = JSON.parse(Buffer.from(state ?? "", "base64url").toString("utf8")) as {
      nonce?: unknown;
      source?: unknown;
    };
    return {
      nonce: typeof parsed.nonce === "string" && parsed.nonce.length > 0 ? parsed.nonce : null,
      source: parsed.source === "gcal" ? "gcal" : "gsheets",
    };
  } catch {
    return { nonce: null, source: "gsheets" };
  }
}

/**
 * Validate the returned state against the nonce stored in the session cookie.
 * Rejects missing, malformed, or mismatched state (CSRF protection).
 */
export function isValidOAuthState(stateParam: string | null, cookieNonce: string | undefined): boolean {
  const { nonce } = parseOAuthState(stateParam);
  if (!nonce || !cookieNonce) return false;
  return nonce === cookieNonce;
}
