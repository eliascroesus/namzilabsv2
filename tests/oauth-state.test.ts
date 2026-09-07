import { describe, it, expect } from "vitest";
import { createOAuthState, parseOAuthState, isValidOAuthState } from "@/lib/oauth-state";

describe("oauth state (CSRF protection, provider and source carried inside)", () => {
  it("round-trips a random nonce, the provider and the source", () => {
    const { state, nonce } = createOAuthState({ provider: "google", source: "gcal" });
    expect(parseOAuthState(state)).toEqual({ nonce, provider: "google", source: "gcal" });
    expect(nonce.length).toBeGreaterThan(20);
  });
  it("validates a matching nonce and rejects a mismatch, a missing cookie, and garbage", () => {
    const { state, nonce } = createOAuthState({ provider: "google", source: "gsheets" });
    expect(isValidOAuthState(state, nonce)).toBe(true);
    expect(isValidOAuthState(state, "different-nonce")).toBe(false);
    expect(isValidOAuthState(state, undefined)).toBe(false);
    expect(isValidOAuthState("not-base64-json", nonce)).toBe(false);
    expect(parseOAuthState("not-base64-json")).toEqual({ nonce: null, provider: null, source: null });
  });
  it("refuses a source the provider does not own", () => {
    const { state } = createOAuthState({ provider: "google", source: "close" });
    expect(parseOAuthState(state).source).toBeNull();
  });
});
