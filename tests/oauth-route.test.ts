import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb } from "./helpers/testdb";
import { createOAuthState, OAUTH_STATE_COOKIE } from "@/lib/oauth-state";
import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { registerConnector } from "@/connectors/registry";
import { OAUTH_PROVIDERS } from "@/lib/oauth/providers";
import type { DB } from "@/db/types";

let db: DB;
let close: () => Promise<void>;
let cookie: string | undefined;
vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDb: () => db, getReadDb: () => db }));
vi.mock("@/inngest/client", () => ({ inngest: { send: async () => {} } }));
vi.mock("@/lib/auth", () => ({ getOrgContext: async () => ({ orgId: "org_oauth", userId: "u1" }) }));
vi.mock("@/lib/permissions", () => ({ effectiveAccess: async () => ({ can: () => true }) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (k === OAUTH_STATE_COOKIE && cookie ? { value: cookie } : undefined) }),
}));

// A second provider, so the route is proven generic rather than Google-shaped.
OAUTH_PROVIDERS.acme = {
  key: "acme",
  name: "Acme",
  authorizeUrl: "https://acme.test/authorize",
  tokenUrl: "https://acme.test/token",
  clientIdEnv: "ACME_CLIENT_ID",
  clientSecretEnv: "ACME_CLIENT_SECRET",
  scopesFor: () => ["read"],
  refresh: "standard",
};
CONNECTOR_CATALOG.push({
  source: "acme",
  name: "Acme",
  description: "t",
  connect: "oauth",
  oauthProvider: "acme",
  instant: false,
  poll: true,
  autoWebhook: false,
  credentialFields: [],
});
registerConnector({ source: "acme", authType: "oauth2", verifySignature: () => false, poll: async () => ({ records: [], nextCursor: null }) });

const { GET: start } = await import("@/app/api/oauth/[provider]/start/route");
const { GET: callback } = await import("@/app/api/oauth/[provider]/callback/route");

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
  process.env.ACME_CLIENT_ID = "id";
  process.env.ACME_CLIENT_SECRET = "secret";
  process.env.APP_BASE_URL = "https://app.test";
});
afterEach(async () => {
  await close();
  vi.unstubAllGlobals();
});

const params = (provider: string) => ({ params: Promise.resolve({ provider }) });

describe("/api/oauth/[provider]", () => {
  it("start redirects to the provider's authorize URL with a state cookie", async () => {
    const res = await start(new Request("https://app.test/api/oauth/acme/start?source=acme"), params("acme"));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://acme.test/authorize");
    expect(loc.searchParams.get("scope")).toBe("read");
    expect(res.headers.get("set-cookie")).toContain(OAUTH_STATE_COOKIE);
  });
  it("start refuses an unknown provider and a source that does not belong to the provider", async () => {
    const a = await start(new Request("https://app.test/api/oauth/nope/start?source=acme"), params("nope"));
    expect(a.headers.get("location")).toContain("error=oauth_unknown");
    const b = await start(new Request("https://app.test/api/oauth/acme/start?source=gsheets"), params("acme"));
    expect(b.headers.get("location")).toContain("error=oauth_unknown");
  });
  it("callback exchanges the code and creates the connection named by the catalog entry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => null },
        json: async () => ({ access_token: "at", refresh_token: "rt", expires_in: 3600, token_type: "bearer" }),
        text: async () => "",
      })),
    );
    const { state, nonce } = createOAuthState({ provider: "acme", source: "acme" });
    cookie = nonce;
    const res = await callback(new Request(`https://app.test/api/oauth/acme/callback?code=c&state=${state}`), params("acme"));
    expect(res.headers.get("location")).toMatch(/\/connections\/[0-9a-f-]{36}$/);
    const { connections } = await import("@/db/schema");
    const [row] = await db.select().from(connections);
    expect(row.source).toBe("acme");
    expect(row.authType).toBe("oauth2");
    expect(row.name).toBe("Acme");
  });
  it("callback rejects a state whose nonce does not match the cookie", async () => {
    const { state } = createOAuthState({ provider: "acme", source: "acme" });
    cookie = "other";
    const res = await callback(new Request(`https://app.test/api/oauth/acme/callback?code=c&state=${state}`), params("acme"));
    expect(res.headers.get("location")).toContain("error=state_mismatch");
  });
});
