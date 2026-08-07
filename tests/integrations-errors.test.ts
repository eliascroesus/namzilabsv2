import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { integrationsErrorMessage } from "@/app/integrations/error-messages";

/**
 * The OAuth callback redirected to /integrations with error codes for as long
 * as it has existed, and the page rendered none of them — a failed Google
 * connection looked identical to a page load, minus the connection the user
 * expected. This pins the two files together at the SOURCE level (the
 * timeout-budgets pattern): a new redirect code without copy fails here, so
 * an error can never ship silent again.
 */
describe("every error code a redirect can carry has human copy", () => {
  const emitters = [
    "src/app/api/oauth/google/callback/route.ts",
    "src/app/api/oauth/google/start/route.ts",
  ];

  it("finds the known codes in the callback source (guards the regex going stale)", () => {
    const codes = new Set(
      emitters.flatMap((p) => [...readFileSync(p, "utf8").matchAll(/error=([a-z_]+)/g)].map((m) => m[1])),
    );
    expect(codes.has("oauth_denied")).toBe(true);
    expect(codes.size).toBeGreaterThanOrEqual(3);
  });

  it("maps every emitted code to copy that is not the generic fallback", () => {
    const generic = integrationsErrorMessage("__unknown__");
    for (const path of emitters) {
      for (const m of readFileSync(path, "utf8").matchAll(/error=([a-z_]+)/g)) {
        const msg = integrationsErrorMessage(m[1]);
        expect(msg, `${path} redirects with ?error=${m[1]} but error-messages.ts has no specific copy for it`).not.toBe(generic);
        expect(msg.length).toBeGreaterThan(20);
      }
    }
  });

  it("an unknown code still gets safe generic copy, never an echo of the code as prose", () => {
    const msg = integrationsErrorMessage("weird_new_code");
    expect(msg).toContain("Nothing was connected");
    expect(msg).not.toContain("weird_new_code");
  });
});
