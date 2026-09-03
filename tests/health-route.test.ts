import { describe, it, expect, afterEach, vi } from "vitest";
import { GET } from "@/app/api/health/route";

/**
 * /api/health sits OUTSIDE the auth proxy (an uptime monitor has no session)
 * and used to hand every anonymous caller the configured-env-var list by name
 * plus the raw database error string — which can carry the Neon hostname. The
 * contract now: status is always public (a monitor tells up from down), the
 * WHY is gated behind HEALTH_CHECK_TOKEN, and a missing token fails CLOSED.
 *
 * The database is unreachable under vitest by default: `dbBehavior.resolves`
 * starts `false`, so the mock below throws exactly like the real `getDb()`
 * throws when `DATABASE_URL` is unset — which is exactly what exercises the
 * `databaseError` capture being withheld from anonymous callers. Only the
 * MCP-config tests flip the flag to `true`, since they need `database: "ok"`
 * to isolate config-completeness from database connectivity; every other
 * test in this file leaves it at the default and hits the unreachable branch.
 */
const dbBehavior = vi.hoisted(() => ({ resolves: false }));
vi.mock("@/db/client", () => ({
  getDb: () => ({
    execute: async () => {
      if (dbBehavior.resolves) return [];
      throw new Error("DATABASE_URL is not set");
    },
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  dbBehavior.resolves = false;
});

const anon = () => GET(new Request("https://x.test/api/health"));
const withToken = (t: string) => GET(new Request("https://x.test/api/health", { headers: { "x-health-token": t } }));

describe("/api/health disclosure gating", () => {
  it("anonymous callers get the status and NOTHING else", async () => {
    vi.stubEnv("HEALTH_CHECK_TOKEN", "s3cret");
    const res = await anon();
    const body = (await res.json()) as Record<string, unknown>;
    // THE regression: this body carried checks.missingRequired (env-var names)
    // and checks.databaseError (raw driver error, hostname included).
    expect(Object.keys(body)).toEqual(["status"]);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("DATABASE_URL");
    expect(raw).not.toContain("checks");
  });

  it("the token unlocks the operator detail", async () => {
    vi.stubEnv("HEALTH_CHECK_TOKEN", "s3cret");
    const res = await withToken("s3cret");
    const body = (await res.json()) as {
      checks?: { missingRequired?: string[]; database?: string; databaseError?: string };
    };
    expect(body.checks).toBeDefined();
    expect(Array.isArray(body.checks?.missingRequired)).toBe(true);
    // Locks in the unreachable branch itself (route.ts's catch around
    // `getDb().execute`) rather than relying on it incidentally: DATABASE_URL
    // is never stubbed in this test, so the mocked `execute` throws and this
    // is the assertion that would fail if a mock ever made it resolve anyway.
    expect(body.checks?.database).toBe("unreachable");
    expect(body.checks?.databaseError).toBeDefined();
  });

  it("a wrong token gets the anonymous body", async () => {
    vi.stubEnv("HEALTH_CHECK_TOKEN", "s3cret");
    const body = (await (await withToken("wrong")).json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["status"]);
  });

  it("fails CLOSED: no token configured → even a presented token gets no detail", async () => {
    vi.stubEnv("HEALTH_CHECK_TOKEN", "");
    const body = (await (await withToken("anything")).json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["status"]);
  });

  it("the HTTP status still distinguishes up from down for tokenless monitors", async () => {
    vi.stubEnv("HEALTH_CHECK_TOKEN", "");
    const res = await anon();
    // DB unreachable in tests → unhealthy → 503; the point is the CODE is
    // meaningful without the token, not which code it is here.
    expect(res.status).toBe(503);
    expect(((await res.json()) as { status: string }).status).toBe("unhealthy");
  });

  it("counts the MCP variables only when MCP_ENABLED is on", async () => {
    dbBehavior.resolves = true;
    vi.stubEnv("DATABASE_URL", "x");
    vi.stubEnv("ENCRYPTION_KEY", "x");
    vi.stubEnv("INNGEST_EVENT_KEY", "x");
    vi.stubEnv("INNGEST_SIGNING_KEY", "x");
    vi.stubEnv("APP_BASE_URL", "x");
    vi.stubEnv("HEALTH_CHECK_TOKEN", "t");
    vi.stubEnv("MCP_ENABLED", "");
    vi.stubEnv("WORKOS_AUTHKIT_DOMAIN", "");
    vi.stubEnv("MCP_RESOURCE_URL", "");
    const off = (await (
      await GET(new Request("http://x/api/health", { headers: { "x-health-token": "t" } }))
    ).json()) as { status: string; checks?: { missingForMcp?: string[] } };
    expect(off.status).toBe("ok");

    vi.stubEnv("MCP_ENABLED", "1");
    const on = (await (
      await GET(new Request("http://x/api/health", { headers: { "x-health-token": "t" } }))
    ).json()) as { status: string; checks?: { missingForMcp?: string[] } };
    expect(on.status).toBe("degraded");
    // APP_BASE_URL is set above, so MCP_RESOURCE_URL resolves to its default —
    // WORKOS_AUTHKIT_DOMAIN is the only genuinely missing piece.
    expect(on.checks?.missingForMcp).toEqual(["WORKOS_AUTHKIT_DOMAIN"]);
  });

  it("does not degrade when MCP_RESOURCE_URL is left to its APP_BASE_URL default", async () => {
    dbBehavior.resolves = true;
    vi.stubEnv("DATABASE_URL", "x");
    vi.stubEnv("ENCRYPTION_KEY", "x");
    vi.stubEnv("INNGEST_EVENT_KEY", "x");
    vi.stubEnv("INNGEST_SIGNING_KEY", "x");
    vi.stubEnv("APP_BASE_URL", "https://app.namzilabs.com");
    vi.stubEnv("HEALTH_CHECK_TOKEN", "t");
    vi.stubEnv("MCP_ENABLED", "1");
    vi.stubEnv("WORKOS_AUTHKIT_DOMAIN", "https://x.authkit.app");
    vi.stubEnv("MCP_RESOURCE_URL", "");

    const body = (await (
      await GET(new Request("http://x/api/health", { headers: { "x-health-token": "t" } }))
    ).json()) as { status: string; checks?: { missingForMcp?: string[]; mcpWarning?: string } };
    expect(body.status).toBe("ok");
    expect(body.checks?.missingForMcp).toEqual([]);
    expect(body.checks?.mcpWarning).toBeUndefined();
  });

  it("degrades when neither MCP_RESOURCE_URL nor APP_BASE_URL can resolve a resource URL", async () => {
    dbBehavior.resolves = true;
    vi.stubEnv("DATABASE_URL", "x");
    vi.stubEnv("ENCRYPTION_KEY", "x");
    vi.stubEnv("INNGEST_EVENT_KEY", "x");
    vi.stubEnv("INNGEST_SIGNING_KEY", "x");
    vi.stubEnv("APP_BASE_URL", "");
    vi.stubEnv("HEALTH_CHECK_TOKEN", "t");
    vi.stubEnv("MCP_ENABLED", "1");
    vi.stubEnv("WORKOS_AUTHKIT_DOMAIN", "https://x.authkit.app");
    vi.stubEnv("MCP_RESOURCE_URL", "");

    const body = (await (
      await GET(new Request("http://x/api/health", { headers: { "x-health-token": "t" } }))
    ).json()) as { status: string; checks?: { missingForMcp?: string[]; mcpWarning?: string } };
    expect(body.status).toBe("degraded");
    expect(body.checks?.missingForMcp).toEqual(["MCP_RESOURCE_URL (or APP_BASE_URL)"]);
    expect(body.checks?.mcpWarning).toBeDefined();
  });
});
