import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("mcp-handler", () => ({
  createMcpHandler: () => async () => new Response("mcp", { status: 200 }),
  withMcpAuth: (h: (r: Request) => Promise<Response>, verify: (r: Request, t?: string) => Promise<unknown>, opts: { resourceUrl?: string; resourceMetadataPath?: string }) => async (req: Request) => {
    const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
    return (await verify(req, token)) ? h(req) : new Response("", { status: 401, headers: { "www-authenticate": `Bearer resource_metadata="${opts.resourceUrl}${opts.resourceMetadataPath}"` } });
  },
  generateProtectedResourceMetadata: ({ authServerUrls, resourceUrl, additionalMetadata }: { authServerUrls: string[]; resourceUrl: string; additionalMetadata?: Record<string, unknown> }) => ({ resource: resourceUrl, authorization_servers: authServerUrls, ...additionalMetadata }),
  // The real helper (node_modules/mcp-handler/dist/index.js) answers 200, not
  // 204 — the mock had drifted from it.
  metadataCorsOptionsRequestHandler: () => () => new Response(null, { status: 200, headers: { "access-control-allow-origin": "*" } }),
}));
vi.mock("@/lib/mcp/auth", () => ({ verifyMcpToken: async (_r: Request, t?: string) => (t === "good" ? { token: t, clientId: "c", scopes: [], extra: { userId: "u", orgIdClaim: null, bindingKey: "k" } } : undefined) }));
// The route's module graph reaches workspace.ts's top-level `@workos-inc/authkit-nextjs`
// import (register.ts -> tools/workspaces.ts -> context.ts -> workspace.ts) even though
// this file never exercises that path — mcp-handler is mocked above, so the real
// handler this file imports never calls into it. Mocked only so the import graph
// resolves under vitest, same as every other test that imports anything importing
// workspace.ts (see tests/mcp-context.test.ts, tests/mcp-workspace-tools.test.ts).
vi.mock("@workos-inc/authkit-nextjs", () => ({
  getWorkOS: () => ({ userManagement: { listOrganizationMemberships: async () => ({ data: [] }) }, organizations: { getOrganization: async (id: string) => ({ id, name: `Org ${id}` }) } }),
}));

beforeEach(() => {
  // /api/mcp/route.ts memoizes its `withMcpAuth` handler on first use so a
  // deploy without MCP variables never throws at import — but that means the
  // module now carries state across calls. Reset the module registry so each
  // test's dynamic import gets a fresh, unmemoized module reflecting THIS
  // test's stubbed env, not whatever an earlier test in this file resolved.
  vi.resetModules();
  vi.stubEnv("MCP_ENABLED", "1"); vi.stubEnv("WORKOS_AUTHKIT_DOMAIN", "https://x.authkit.app"); vi.stubEnv("MCP_RESOURCE_URL", "https://app.example/api/mcp");
});
afterEach(() => vi.unstubAllEnvs());

describe("/api/mcp", () => {
  it("is a 404 while MCP_ENABLED is off", async () => {
    vi.stubEnv("MCP_ENABLED", "");
    const { POST } = await import("@/app/api/mcp/route");
    expect((await POST(new Request("https://app.example/api/mcp", { method: "POST" }))).status).toBe(404);
  });
  it("answers 401 with the resource-metadata challenge when no token is sent", async () => {
    const { POST } = await import("@/app/api/mcp/route");
    const res = await POST(new Request("https://app.example/api/mcp", { method: "POST" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/resource_metadata=/);
  });
  it("names THIS resource's origin in the 401 challenge, from MCP_RESOURCE_URL rather than the request", async () => {
    vi.stubEnv("MCP_RESOURCE_URL", "https://custom.example/api/mcp");
    const { POST } = await import("@/app/api/mcp/route");
    const res = await POST(new Request("https://app.example/api/mcp", { method: "POST" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('resource_metadata="https://custom.example/.well-known/oauth-protected-resource"');
  });
  it("refuses a foreign browser Origin", async () => {
    const { POST } = await import("@/app/api/mcp/route");
    const res = await POST(new Request("https://app.example/api/mcp", { method: "POST", headers: { origin: "https://evil.example", authorization: "Bearer good" } }));
    expect(res.status).toBe(403);
  });
  it("serves the request with a good token", async () => {
    const { POST } = await import("@/app/api/mcp/route");
    expect((await POST(new Request("https://app.example/api/mcp", { method: "POST", headers: { authorization: "Bearer good" } }))).status).toBe(200);
  });
});

describe("/.well-known/oauth-protected-resource", () => {
  it("names this resource, the AuthKit server and the scopes, at both locations, with CORS headers", async () => {
    const root = await import("@/app/.well-known/oauth-protected-resource/route");
    const scoped = await import("@/app/.well-known/oauth-protected-resource/api/mcp/route");
    for (const mod of [root, scoped]) {
      const res = await mod.GET(new Request("https://app.example/.well-known/oauth-protected-resource"));
      const body = await res.json();
      expect(body).toMatchObject({ resource: "https://app.example/api/mcp", authorization_servers: ["https://x.authkit.app"], bearer_methods_supported: ["header"], scopes_supported: ["openid", "profile", "email", "offline_access"] });
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }
  });
  it("is absent while MCP_ENABLED is off", async () => {
    vi.stubEnv("MCP_ENABLED", "");
    const { GET } = await import("@/app/.well-known/oauth-protected-resource/route");
    expect((await GET(new Request("https://app.example/.well-known/oauth-protected-resource"))).status).toBe(404);
  });
  it("answers OPTIONS with the CORS handler at both locations while enabled, and 404 while disabled", async () => {
    const root = await import("@/app/.well-known/oauth-protected-resource/route");
    const scoped = await import("@/app/.well-known/oauth-protected-resource/api/mcp/route");
    for (const mod of [root, scoped]) {
      const res = await mod.OPTIONS();
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }
    vi.stubEnv("MCP_ENABLED", "");
    expect((await root.OPTIONS()).status).toBe(404);
    expect((await scoped.OPTIONS()).status).toBe(404);
  });
});
