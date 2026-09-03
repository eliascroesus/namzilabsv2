import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("mcp-handler", () => ({
  createMcpHandler: () => async () => new Response("mcp", { status: 200 }),
  withMcpAuth: (h: (r: Request) => Promise<Response>, verify: (r: Request, t?: string) => Promise<unknown>) => async (req: Request) => {
    const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
    return (await verify(req, token)) ? h(req) : new Response("", { status: 401, headers: { "www-authenticate": 'Bearer resource_metadata="https://app.example/.well-known/oauth-protected-resource"' } });
  },
  protectedResourceHandler: ({ authServerUrls }: { authServerUrls: string[] }) => async () => Response.json({ resource: "https://wrong", authorization_servers: authServerUrls }),
  metadataCorsOptionsRequestHandler: () => async () => new Response(null, { status: 204 }),
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

beforeEach(() => { vi.stubEnv("MCP_ENABLED", "1"); vi.stubEnv("WORKOS_AUTHKIT_DOMAIN", "https://x.authkit.app"); vi.stubEnv("MCP_RESOURCE_URL", "https://app.example/api/mcp"); });
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
  it("names this resource, the AuthKit server and the scopes, at both locations", async () => {
    const root = await import("@/app/.well-known/oauth-protected-resource/route");
    const scoped = await import("@/app/.well-known/oauth-protected-resource/api/mcp/route");
    for (const mod of [root, scoped]) {
      const body = await (await mod.GET(new Request("https://app.example/.well-known/oauth-protected-resource"))).json();
      expect(body).toMatchObject({ resource: "https://app.example/api/mcp", authorization_servers: ["https://x.authkit.app"], bearer_methods_supported: ["header"], scopes_supported: ["openid", "profile", "email", "offline_access"] });
    }
  });
  it("is absent while MCP_ENABLED is off", async () => {
    vi.stubEnv("MCP_ENABLED", "");
    const { GET } = await import("@/app/.well-known/oauth-protected-resource/route");
    expect((await GET(new Request("https://app.example/.well-known/oauth-protected-resource"))).status).toBe(404);
  });
});
