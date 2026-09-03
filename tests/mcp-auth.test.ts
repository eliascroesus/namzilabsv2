import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";

const verify = vi.fn();
vi.mock("jose", () => ({ createRemoteJWKSet: () => ({}), jwtVerify: (...a: unknown[]) => verify(...a) }));

import { verifyMcpToken, bindingKeyOf } from "@/lib/mcp/auth";

beforeEach(() => { vi.stubEnv("WORKOS_AUTHKIT_DOMAIN", "https://x.authkit.app"); vi.stubEnv("MCP_RESOURCE_URL", "https://app.example/api/mcp"); verify.mockReset(); });
afterEach(() => vi.unstubAllEnvs());

const req = new Request("https://app.example/api/mcp");

describe("verifyMcpToken", () => {
  it("returns undefined without a token and never calls jose", async () => {
    expect(await verifyMcpToken(req, undefined)).toBeUndefined();
    expect(verify).not.toHaveBeenCalled();
  });
  it("verifies issuer and audience and maps sub to userId", async () => {
    verify.mockResolvedValue({ payload: { sub: "user_1", exp: 4102444800, org_id: "org_a" } });
    const auth = await verifyMcpToken(req, "tok");
    expect(verify).toHaveBeenCalledWith("tok", expect.anything(), { issuer: "https://x.authkit.app", audience: "https://app.example/api/mcp" });
    expect(auth?.extra.userId).toBe("user_1");
    expect(auth?.extra.orgIdClaim).toBe("org_a");
    expect(auth?.expiresAt).toBe(4102444800);
  });
  it("returns undefined when jose rejects (wrong audience, expired, bad signature)", async () => {
    verify.mockRejectedValue(new Error("unexpected \"aud\" claim value"));
    expect(await verifyMcpToken(req, "tok")).toBeUndefined();
  });
  it("prefers client_id, then azp, then sid, then a token hash for the binding key", () => {
    expect(bindingKeyOf({ client_id: "c" }, "t")).toBe("client:c");
    expect(bindingKeyOf({ azp: "a" }, "t")).toBe("client:a");
    expect(bindingKeyOf({ sid: "s" }, "t")).toBe("session:s");
    expect(bindingKeyOf({}, "t")).toBe(`token:${createHash("sha256").update("t").digest("hex")}`);
  });
  it("never puts the raw token into the binding key", () => {
    expect(bindingKeyOf({}, "secret-token")).not.toContain("secret-token");
  });
});
