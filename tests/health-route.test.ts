import { describe, it, expect, afterEach, vi } from "vitest";
import { GET } from "@/app/api/health/route";

/**
 * /api/health sits OUTSIDE the auth proxy (an uptime monitor has no session)
 * and used to hand every anonymous caller the configured-env-var list by name
 * plus the raw database error string — which can carry the Neon hostname. The
 * contract now: status is always public (a monitor tells up from down), the
 * WHY is gated behind HEALTH_CHECK_TOKEN, and a missing token fails CLOSED.
 *
 * The database is unreachable under vitest, which is exactly what exercises
 * the `databaseError` capture being withheld from anonymous callers.
 */

afterEach(() => vi.unstubAllEnvs());

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
    const body = (await res.json()) as { checks?: { missingRequired?: string[] } };
    expect(body.checks).toBeDefined();
    expect(Array.isArray(body.checks?.missingRequired)).toBe(true);
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
});
