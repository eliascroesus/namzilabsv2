import { describe, it, expect } from "vitest";
import { createOAuthState, parseOAuthState, isValidOAuthState } from "@/lib/oauth-state";

describe("google oauth state (CSRF protection)", () => {
  it("round-trips a random nonce and the source", () => {
    const { state, nonce } = createOAuthState("gcal");
    const parsed = parseOAuthState(state);
    expect(parsed.nonce).toBe(nonce);
    expect(parsed.source).toBe("gcal");
    expect(nonce.length).toBeGreaterThan(20); // cryptographically random
  });

  it("validates a matching nonce", () => {
    const { state, nonce } = createOAuthState("gsheets");
    expect(isValidOAuthState(state, nonce)).toBe(true);
  });

  it("rejects a mismatched nonce", () => {
    const { state } = createOAuthState("gsheets");
    expect(isValidOAuthState(state, "different-nonce")).toBe(false);
  });

  it("rejects a missing cookie nonce", () => {
    const { state } = createOAuthState("gsheets");
    expect(isValidOAuthState(state, undefined)).toBe(false);
  });

  it("rejects malformed state", () => {
    expect(isValidOAuthState("%%%not-valid%%%", "anything")).toBe(false);
  });

  it("generates unique nonces each call", () => {
    expect(createOAuthState("gsheets").nonce).not.toBe(createOAuthState("gsheets").nonce);
  });
});
