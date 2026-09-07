import { describe, it, expect, beforeAll } from "vitest";
import { OAUTH_PROVIDERS, oauthProviderFor } from "@/lib/oauth/providers";
import { buildAuthUrl, redirectUriFor } from "@/lib/oauth/flow";

beforeAll(() => {
  process.env.GOOGLE_CLIENT_ID = "cid";
  process.env.APP_BASE_URL = "https://app.example.com";
  delete process.env.GOOGLE_REDIRECT_URI;
});

describe("the Google provider reproduces the retired google-oauth.ts byte for byte", () => {
  const google = OAUTH_PROVIDERS.google;
  it("resolves for both Google sources and for nothing else", () => {
    expect(oauthProviderFor("gsheets")).toBe(google);
    expect(oauthProviderFor("gcal")).toBe(google);
    expect(oauthProviderFor("close")).toBeUndefined();
    expect(oauthProviderFor("nope")).toBeUndefined();
  });
  it("keeps the registered redirect URI", () => {
    expect(redirectUriFor(google)).toBe("https://app.example.com/api/oauth/google/callback");
    process.env.GOOGLE_REDIRECT_URI = "https://x/cb";
    expect(redirectUriFor(google)).toBe("https://x/cb");
    delete process.env.GOOGLE_REDIRECT_URI;
  });
  it("builds the exact authorize URL the old builder produced (params, order, scopes)", () => {
    const state = "abc";
    expect(buildAuthUrl(google, { source: "gsheets", state })).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth?" +
        new URLSearchParams({
          client_id: "cid",
          redirect_uri: "https://app.example.com/api/oauth/google/callback",
          response_type: "code",
          scope: "openid email https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.readonly",
          access_type: "offline",
          include_granted_scopes: "true",
          prompt: "consent select_account",
          state,
        }).toString(),
    );
    expect(buildAuthUrl(google, { source: "gcal", state })).toContain("scope=openid+email+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.readonly&");
  });
  it("refuses to build without a client id", () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect(() => buildAuthUrl(google, { source: "gcal", state: "s" })).toThrow("GOOGLE_CLIENT_ID is not set");
    process.env.GOOGLE_CLIENT_ID = "cid";
  });
});
