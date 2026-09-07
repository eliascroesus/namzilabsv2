import { randomBytes } from "node:crypto";
import { oauthProvider, oauthProviderFor } from "@/lib/oauth/providers";

export const OAUTH_STATE_COOKIE = "g_oauth_state";

export type OAuthState = { nonce: string | null; provider: string | null; source: string | null };

export function createOAuthState(s: { provider: string; source: string }): { state: string; nonce: string } {
  const nonce = randomBytes(24).toString("base64url");
  const state = Buffer.from(JSON.stringify({ nonce, provider: s.provider, source: s.source })).toString("base64url");
  return { state, nonce };
}

/** Nulls for anything unreadable — a null field sends the callback to `state_mismatch`. */
export function parseOAuthState(state: string | null): OAuthState {
  try {
    const parsed = JSON.parse(Buffer.from(state ?? "", "base64url").toString("utf8")) as { nonce?: unknown; provider?: unknown; source?: unknown };
    const nonce = typeof parsed.nonce === "string" && parsed.nonce.length > 0 ? parsed.nonce : null;
    const provider = typeof parsed.provider === "string" && oauthProvider(parsed.provider) ? parsed.provider : null;
    const source =
      typeof parsed.source === "string" && provider && oauthProviderFor(parsed.source)?.key === provider ? parsed.source : null;
    return { nonce, provider, source };
  } catch {
    return { nonce: null, provider: null, source: null };
  }
}

export function isValidOAuthState(stateParam: string | null, cookieNonce: string | undefined): boolean {
  const { nonce } = parseOAuthState(stateParam);
  if (!nonce || !cookieNonce) return false;
  return nonce === cookieNonce;
}
