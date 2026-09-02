import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { connections } from "@/db/schema";
import { calendlyConnector } from "@/connectors/calendly";
import { catalogEntry } from "@/connectors/catalog";
import { reconcileConnection } from "@/ingestion/reconcile";
import { registerConnector } from "@/connectors/registry";
import { decrypt } from "@/lib/crypto";
import type { Connector } from "@/connectors/types";
import type { DB } from "@/db/types";

/**
 * O7 — Calendly's instant path, end to end. Its `verifySignature` was
 * complete and correct from the day it shipped and had NEVER RUN: the
 * catalog flags were off, so no signing secret was ever stored and every
 * delivery 401'd before the doorbell. These pin the pieces that turn it on:
 * registration (org-scoped, returns the signing key exactly once),
 * subscription health with RE-CREATION (Calendly has no re-activate verb),
 * the plan-gated graceful degrade, and reconcile persisting a re-created
 * subscription's new key.
 */

const KEY = randomBytes(32).toString("base64");

let db: DB;
let close: () => Promise<void>;

// createConnection reads getDb() and dispatches a first sync through Inngest;
// the degrade test must depend on neither (org-caps.test.ts precedent).
vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDb: () => db, getReadDb: () => db }));
vi.mock("@/inngest/client", () => ({ inngest: { send: async () => {} } }));

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  process.env.ENCRYPTION_KEY = KEY;
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await close();
  registerConnector((await import("@/connectors/calendly")).calendlyConnector);
  registerConnector((await import("@/connectors/close")).closeConnector);
});

const jsonRes = (data: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { get: () => null },
    json: async () => data,
    text: async () => JSON.stringify(data),
  }) as unknown as Response;

const ME = { resource: { uri: "https://api.calendly.com/users/U1", current_organization: "https://api.calendly.com/organizations/O1" } };

describe("catalog flip", () => {
  it("calendly is instant + autoWebhook + webhookOptional — hybrid, poll primary", () => {
    const entry = catalogEntry("calendly")!;
    expect(entry.instant).toBe(true);
    expect(entry.autoWebhook).toBe(true);
    expect(entry.webhookOptional).toBe(true);
    expect(entry.poll).toBe(true); // the poll stays — reconciliation is the spine
  });
});

describe("registerWebhook", () => {
  it("creates ONE org-scoped subscription over every mapped event and returns the signing key", async () => {
    const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/users/me")) return jsonRes(ME);
        if (url.includes("/webhook_subscriptions") && (init?.method ?? "GET") === "POST") {
          posts.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
          return jsonRes({ resource: { uri: "https://api.calendly.com/webhook_subscriptions/W1", signing_key: "cal_signing_key" } });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const res = await calendlyConnector.registerWebhook!({
      connectionId: "c1",
      webhookUrl: "https://app.example/api/webhooks/c1",
      credentials: { accessToken: "tok" },
    });

    expect(res).toEqual({ signingSecret: "cal_signing_key", externalId: "https://api.calendly.com/webhook_subscriptions/W1" });
    expect(posts).toHaveLength(1);
    expect(posts[0].body.scope).toBe("organization");
    expect(posts[0].body.organization).toBe(ME.resource.current_organization);
    expect(posts[0].body.events).toEqual([
      "invitee.created",
      "invitee.canceled",
      "invitee_no_show.created",
      "invitee_no_show.deleted",
      "routing_form_submission.created",
    ]);
  });
});

describe("verifyWebhookSubscription", () => {
  const verify = (fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, recentlyRejecting = false) => {
    vi.stubGlobal("fetch", vi.fn(async (i: string | URL | Request, init?: RequestInit) => fetchImpl(String(i), init)));
    return calendlyConnector.verifyWebhookSubscription!({
      connectionId: "c1",
      webhookUrl: "https://app.example/api/webhooks/c1",
      credentials: { accessToken: "tok" },
      recentlyRejecting,
    });
  };

  it("active subscription at our URL → healthy, nothing re-created", async () => {
    const v = await verify(async (url) => {
      if (url.includes("/users/me")) return jsonRes(ME);
      if (url.includes("/webhook_subscriptions"))
        return jsonRes({ collection: [{ uri: "W1", callback_url: "https://app.example/api/webhooks/c1", state: "active" }] });
      throw new Error(`unexpected: ${url}`);
    });
    expect(v).toEqual({ healthy: true, reregistered: false });
  });

  it("missing + clean endpoint → RE-CREATES and carries the NEW key back", async () => {
    const v = await verify(async (url, init) => {
      if (url.includes("/users/me")) return jsonRes(ME);
      if (url.includes("/webhook_subscriptions") && (init?.method ?? "GET") === "POST")
        return jsonRes({ resource: { uri: "W2", signing_key: "new_key" } });
      if (url.includes("/webhook_subscriptions")) return jsonRes({ collection: [] });
      throw new Error(`unexpected: ${url}`);
    });
    // Calendly has no re-activate verb: report-only here would condemn a
    // lost subscription to permanent "failed" with manual reconnect as the
    // only cure. The new key rides the result for reconcile to persist.
    expect(v.healthy).toBe(true);
    expect(v.reregistered).toBe(true);
    expect(v.signingSecret).toBe("new_key");
    expect(v.externalId).toBe("W2");
  });

  it("missing + recently-rejecting endpoint → report only (Close's guard)", async () => {
    const v = await verify(async (url) => {
      if (url.includes("/users/me")) return jsonRes(ME);
      if (url.includes("/webhook_subscriptions")) return jsonRes({ collection: [] });
      throw new Error(`unexpected: ${url}`);
    }, true);
    expect(v.healthy).toBe(false);
    expect(v.reregistered).toBe(false);
    expect(v.signingSecret).toBeUndefined();
  });

  it("plan-gated 403 → unsupported, never a failure", async () => {
    const v = await verify(async (url) => {
      if (url.includes("/users/me")) return jsonRes(ME);
      return jsonRes({ message: "upgrade required" }, 403);
    });
    expect(v.unsupported).toBe(true);
    expect(v.healthy).toBe(false);
  });
});

/**
 * C23 — permanent delete tells Calendly to stop delivering. Best-effort and
 * idempotent: a 404 means the subscription is already gone, which is exactly
 * the state being asked for. No `identity()` call here — deleting one known
 * subscription URI needs no lookup of which organization we are, unlike
 * register/verify.
 */
describe("unregisterWebhook", () => {
  const stub = (impl: (url: string, init?: RequestInit) => Promise<Response>) => {
    vi.stubGlobal("fetch", vi.fn(async (i: string | URL | Request, init?: RequestInit) => impl(String(i), init)));
  };

  it("DELETEs the stored subscription URI with the bearer token", async () => {
    const reqs: Array<{ url: string; method: string; auth: string | null }> = [];
    stub(async (url, init) => {
      reqs.push({
        url,
        method: (init?.method ?? "GET").toUpperCase(),
        auth: (init?.headers as Record<string, string> | undefined)?.["authorization"] ?? null,
      });
      return jsonRes({}, 204);
    });

    await calendlyConnector.unregisterWebhook!({
      connectionId: "c1",
      credentials: { accessToken: "tok" },
      externalId: "https://api.calendly.com/webhook_subscriptions/W1",
    });

    expect(reqs).toEqual([{ url: "https://api.calendly.com/webhook_subscriptions/W1", method: "DELETE", auth: "Bearer tok" }]);
  });

  it("builds the URI from a bare id", async () => {
    const reqs: string[] = [];
    stub(async (url) => {
      reqs.push(url);
      return jsonRes({}, 204);
    });

    await calendlyConnector.unregisterWebhook!({ connectionId: "c1", credentials: { accessToken: "tok" }, externalId: "W1" });

    expect(reqs).toEqual(["https://api.calendly.com/webhook_subscriptions/W1"]);
  });

  it("accepts a 204 whose body can't be parsed as JSON", async () => {
    stub(
      async () =>
        ({
          ok: true,
          status: 204,
          statusText: "No Content",
          headers: { get: () => null },
          json: async () => {
            throw new Error("Unexpected end of JSON input");
          },
          text: async () => "",
        }) as unknown as Response,
    );

    await expect(
      calendlyConnector.unregisterWebhook!({
        connectionId: "c1",
        credentials: { accessToken: "tok" },
        externalId: "https://api.calendly.com/webhook_subscriptions/W1",
      }),
    ).resolves.toBeUndefined();
  });

  it("treats a 404 (already gone) as done, not as a failure", async () => {
    stub(async () => jsonRes({ message: "not found" }, 404));

    await expect(
      calendlyConnector.unregisterWebhook!({
        connectionId: "c1",
        credentials: { accessToken: "tok" },
        externalId: "https://api.calendly.com/webhook_subscriptions/W1",
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses a URI outside Calendly's subscription namespace, and touches the network never", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      calendlyConnector.unregisterWebhook!({
        connectionId: "c1",
        credentials: { accessToken: "tok" },
        externalId: "https://evil.example/steal?token=1",
      }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a same-origin URL outside the subscriptions path", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      calendlyConnector.unregisterWebhook!({
        connectionId: "c1",
        credentials: { accessToken: "tok" },
        externalId: "https://api.calendly.com/scheduled_events/E1",
      }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("reconcile persists a re-created subscription's key", () => {
  it("writes the new secret encrypted and reports the check as reregistered", async () => {
    const stub: Connector = {
      source: "calendly",
      authType: "apiKey",
      verifySignature: () => true,
      normalize: () => [],
      poll: async () => ({ records: [], nextCursor: null }),
      verifyWebhookSubscription: async () => ({
        healthy: true,
        reregistered: true,
        signingSecret: "recreated_key",
        externalId: "W9",
      }),
    };
    registerConnector(stub);
    const id = await seedConnection(db, { source: "calendly" });

    const res = await reconcileConnection(db, id);

    expect(res.webhook).toBe("reregistered");
    const [conn] = await db.select().from(connections).where(eq(connections.id, id));
    // THE trap this closes: without the persist, the connection keeps the OLD
    // key against the NEW subscription and every delivery fails silently.
    expect(conn.signingSecretEncrypted).toBeTruthy();
    expect(decrypt(conn.signingSecretEncrypted!, Buffer.from(KEY, "base64"))).toBe("recreated_key");
    expect((conn.config as Record<string, unknown>).webhookExternalId).toBe("W9");
  });

  it("an unsupported verdict leaves no verdict at all — no red strip, no floor widening", async () => {
    const stub: Connector = {
      source: "calendly",
      authType: "apiKey",
      verifySignature: () => true,
      normalize: () => [],
      poll: async () => ({ records: [], nextCursor: null }),
      verifyWebhookSubscription: async () => ({ healthy: false, reregistered: false, unsupported: true, detail: "plan" }),
    };
    registerConnector(stub);
    const id = await seedConnection(db, { source: "calendly" });

    const res = await reconcileConnection(db, id);

    expect(res.webhook).toBeUndefined();
    const [conn] = await db.select().from(connections).where(eq(connections.id, id));
    expect(conn.lastError).toBeNull();
  });
});

describe("connect-time degrade (webhookOptional)", () => {
  it("a failed optional registration leaves the connection ACTIVE with no secret", async () => {
    const { createConnection } = await import("@/lib/connections");
    const failing: Connector = {
      source: "calendly",
      authType: "apiKey",
      verifySignature: () => true,
      normalize: () => [],
      poll: async () => ({ records: [], nextCursor: null }),
      registerWebhook: async () => {
        throw new Error("403 upgrade required");
      },
    };
    registerConnector(failing);

    const conn = await createConnection({ orgId: "org_test", source: "calendly", name: "Cal", authType: "apiKey", credentials: { accessToken: "t" } });

    // THE regression: the old catch set status "error" for EVERY registration
    // failure — a free-plan Calendly connect arrived broken on day one.
    expect(conn.status).toBe("active");
    const [row] = await db.select().from(connections).where(eq(connections.id, conn.id));
    expect(row.status).toBe("active");
    expect(row.signingSecretEncrypted).toBeNull();
    expect(row.lastError).toBeNull();
  });
});

describe("connect-time failure (non-optional autoWebhook)", () => {
  it("a failed registration leaves the connection ACTIVE with lastError, never a terminal error status", async () => {
    const { createConnection } = await import("@/lib/connections");
    // Close is the other autoWebhook catalog entry, and unlike Calendly it is
    // NOT webhookOptional — so this exercises the `else` branch of the same
    // catch. C2: `error` has no automatic way out (the sweep only selects
    // `active` via `dueConnectionsForSweep`, `recordSuccess` only runs inside
    // the sweep, and `reconnectConnection` only accepts `disabled`), so a
    // connect-time registration failure must not park the connection there.
    const failing: Connector = {
      source: "close",
      authType: "apiKey",
      verifySignature: () => true,
      normalize: () => [],
      poll: async () => ({ records: [], nextCursor: null }),
      registerWebhook: async () => {
        throw new Error("401 invalid API key");
      },
    };
    registerConnector(failing);

    const conn = await createConnection({ orgId: "org_test", source: "close", name: "Close", authType: "apiKey", credentials: { apiKey: "k" } });

    expect(conn.status).toBe("active");
    const [row] = await db.select().from(connections).where(eq(connections.id, conn.id));
    expect(row.status).toBe("active");
    expect(row.lastError).toBe("webhook registration failed: 401 invalid API key");
  });
});
