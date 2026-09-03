import { describe, it, expect, afterEach, vi } from "vitest";
import { mcpEnabled, authkitDomain, mcpResourceUrl } from "@/lib/mcp/env";

afterEach(() => vi.unstubAllEnvs());

describe("mcp env", () => {
  it("is off unless MCP_ENABLED is exactly '1'", () => {
    vi.stubEnv("MCP_ENABLED", "");
    expect(mcpEnabled()).toBe(false);
    vi.stubEnv("MCP_ENABLED", "true");
    expect(mcpEnabled()).toBe(false);
    vi.stubEnv("MCP_ENABLED", "1");
    expect(mcpEnabled()).toBe(true);
  });
  it("derives the resource URL from APP_BASE_URL unless overridden", () => {
    vi.stubEnv("APP_BASE_URL", "https://app.namzilabs.com");
    vi.stubEnv("MCP_RESOURCE_URL", "");
    expect(mcpResourceUrl()).toBe("https://app.namzilabs.com/api/mcp");
    vi.stubEnv("MCP_RESOURCE_URL", "https://mcp.example.com/api/mcp");
    expect(mcpResourceUrl()).toBe("https://mcp.example.com/api/mcp");
  });
  it("throws when neither MCP_RESOURCE_URL nor APP_BASE_URL is set to derive a default from", () => {
    vi.stubEnv("APP_BASE_URL", "");
    vi.stubEnv("MCP_RESOURCE_URL", "");
    expect(() => mcpResourceUrl()).toThrow(/MCP_RESOURCE_URL|APP_BASE_URL/);
  });
  it("strips a trailing slash from the AuthKit domain and refuses an empty one", () => {
    vi.stubEnv("WORKOS_AUTHKIT_DOMAIN", "https://x.authkit.app/");
    expect(authkitDomain()).toBe("https://x.authkit.app");
    vi.stubEnv("WORKOS_AUTHKIT_DOMAIN", "");
    expect(() => authkitDomain()).toThrow(/WORKOS_AUTHKIT_DOMAIN/);
  });
});
