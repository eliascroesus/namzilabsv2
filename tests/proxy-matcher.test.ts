import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("proxy matcher", () => {
  it("leaves the MCP endpoint and the well-known documents outside the cookie wall", () => {
    const src = readFileSync("src/proxy.ts", "utf8");
    const m = /matcher:\s*\["([^"]+)"\]/.exec(src);
    expect(m).not.toBeNull();
    const pattern = m![1].replace(/\\\\/g, "\\");
    expect(pattern).toContain("api/mcp");
    expect(pattern).toContain("\\.well-known");
    const re = new RegExp(`^${pattern}$`);
    expect(re.test("/api/mcp")).toBe(false);
    expect(re.test("/.well-known/oauth-protected-resource")).toBe(false);
    expect(re.test("/dashboard")).toBe(true);
  });
});
