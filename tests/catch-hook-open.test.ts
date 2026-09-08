import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { createTestDb } from "./helpers/testdb";
import { connections, rawEvents } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * THE CATCH-HOOK'S ONE PROMISE: point any app at this URL and it works.
 *
 * It did not. `catchHookConnector` documents itself as open until a secret
 * exists, but `createConnection` minted a random secret for every `instant`
 * source — so every custom-webhook connection was born signed, and the plain
 * unsigned POST that is the entire point of a catch-all URL was rejected 401
 * and discarded. Nothing surfaced it: the sender saw an error, the customer saw
 * an empty flow.
 *
 * These tests hold the promise open from both ends — the factory that creates
 * the connection, and the route that receives the delivery.
 */

const KEY = randomBytes(32).toString("base64");
let db: DB;
let close: () => Promise<void>;

vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDb: () => db, getReadDb: () => db }));
vi.mock("@/inngest/client", () => ({ inngest: { send: async () => {} } }));

const { POST, GET } = await import("@/app/api/webhooks/[connectionId]/route");
const { createConnection, enableWebhookSigning, getSigningSecret, previewLatest } = await import("@/lib/connections");

beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  process.env.ENCRYPTION_KEY = KEY;
});
afterEach(async () => {
  await close();
});

const ORG = "org_hook";
const url = (id: string, qs = "") => `https://app.example/api/webhooks/${id}${qs}`;
const post = (id: string, body: string, headers: Record<string, string> = {}, qs = "") =>
  POST(new Request(url(id, qs), { method: "POST", body, headers }), { params: Promise.resolve({ connectionId: id }) });
const get = (id: string, qs = "") => GET(new Request(url(id, qs)), { params: Promise.resolve({ connectionId: id }) });

const newHook = async () => (await createConnection({ orgId: ORG, source: "webhook", name: "Catch hook" })).id;
const storedPayload = async (id: string) => {
  const [row] = await db.select().from(rawEvents).where((await import("drizzle-orm")).eq(rawEvents.connectionId, id));
  return row?.payload as Record<string, unknown> | undefined;
};

describe("a new catch-hook is open", () => {
  it("mints no signing secret, so the URL alone is the credential", async () => {
    const id = await newHook();
    const [conn] = await db.select().from(connections).where((await import("drizzle-orm")).eq(connections.id, id));
    expect(conn.signingSecretEncrypted).toBeNull();
    expect(getSigningSecret(conn)).toBeNull();
  });

  it("accepts a plain unsigned JSON POST — the thing a catch-all URL exists for", async () => {
    const id = await newHook();
    const res = await post(id, JSON.stringify({ email: "a@b.io", amount: 10 }), { "content-type": "application/json" });
    expect(res.status).toBe(202);
    expect(await storedPayload(id)).toMatchObject({ email: "a@b.io", amount: 10 });
  });

  it("accepts a FORM-encoded POST and stores readable fields, not one opaque string", async () => {
    const id = await newHook();
    const res = await post(id, "email=a%40b.io&amount=10", { "content-type": "application/x-www-form-urlencoded" });
    expect(res.status).toBe(202);
    const p = await storedPayload(id);
    expect(p).toMatchObject({ email: "a@b.io", amount: "10" });
    expect(p).not.toHaveProperty("_raw");
  });

  it("merges the query string, and the body still wins a collision", async () => {
    const id = await newHook();
    await post(id, JSON.stringify({ source: "body" }), { "content-type": "application/json" }, "?source=query&tenant=acme");
    expect(await storedPayload(id)).toMatchObject({ source: "body", tenant: "acme" });
  });
});

describe("the verification handshake", () => {
  it("echoes a challenge so a platform will save the URL", async () => {
    const id = await newHook();
    const res = await get(id, "?hub.mode=subscribe&hub.challenge=abc123");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("abc123");
  });

  it("answers a bare GET, which is what pasting the URL in a browser does", async () => {
    const id = await newHook();
    const res = await get(id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ready: true });
  });

  it("still 404s an unknown connection, so a public URL is no oracle", async () => {
    const res = await get("00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });
});

describe("signing is an opt-in, and it bites once taken", () => {
  it("turning it on mints a secret and closes the endpoint to unsigned deliveries", async () => {
    const id = await newHook();
    expect((await post(id, JSON.stringify({ a: 1 }), { "content-type": "application/json" })).status).toBe(202);

    const secret = await enableWebhookSigning(ORG, id);
    expect(secret).toMatch(/^whsec_/);

    const res = await post(id, JSON.stringify({ a: 2 }), { "content-type": "application/json" });
    expect(res.status).toBe(401);

    const { createHmac } = await import("node:crypto");
    const body = JSON.stringify({ a: 3 });
    const sig = createHmac("sha256", secret!).update(body).digest("hex");
    const ok = await post(id, body, { "content-type": "application/json", "x-namzilabs-signature": sig });
    expect(ok.status).toBe(202);
  });

  it("is idempotent: asking twice keeps the secret the customer already copied", async () => {
    const id = await newHook();
    const first = await enableWebhookSigning(ORG, id);
    expect(await enableWebhookSigning(ORG, id)).toBe(first);
  });
});

describe("seeing what arrived", () => {
  /**
   * The loop Zapier's catch hook is built on: send one delivery, look at what
   * landed, map the fields. Preview used to answer a webhook-only source with
   * "send a test event instead" — telling someone to do the one thing that
   * produces the answer, and then refusing to show it. There is no provider to
   * call here, but there is nothing to call: the delivery is in our own table.
   */
  it("shows the last delivery as the record it became", async () => {
    const id = await newHook();
    await post(
      id,
      JSON.stringify({ id: "evt_1", event_type: "sale", email: "buyer@b.io", amount: 25, occurred_at: "2026-03-04T05:06:07Z" }),
      { "content-type": "application/json" },
    );
    const [ev] = await previewLatest(ORG, id, 3);
    expect(ev).toMatchObject({ eventType: "sale", subject: "buyer@b.io", value: 25 });
    expect(ev.occurredAt.toISOString()).toBe("2026-03-04T05:06:07.000Z");
  });

  it("reads a form-encoded delivery back just as readably", async () => {
    const id = await newHook();
    await post(id, "id=7&event_type=signup&email=a%40b.io", { "content-type": "application/x-www-form-urlencoded" });
    const [ev] = await previewLatest(ORG, id, 3);
    expect(ev).toMatchObject({ eventType: "signup", subject: "a@b.io" });
  });

  it("says plainly that nothing has arrived, rather than that preview is unavailable", async () => {
    const id = await newHook();
    await expect(previewLatest(ORG, id, 3)).rejects.toThrow(/Nothing has arrived here yet/);
  });

  it("distinguishes 'arrived but produced nothing' from 'nothing arrived'", async () => {
    // A delivery the mapper cannot turn into a countable record is the failure
    // worth naming: an empty table would read as "it never got here".
    const id = await newHook();
    await post(id, "<order><id>7</id></order>", { "content-type": "application/xml" });
    const rows = await previewLatest(ORG, id, 3);
    // The catch-hook maps ANY object, so an unparseable body still becomes a
    // record — carrying `_raw`, which is exactly what someone needs to see.
    expect(rows[0].properties).toMatchObject({ _raw: "<order><id>7</id></order>" });
  });
});
