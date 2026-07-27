import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { connections, rawEvents } from "@/db/schema";
import { encrypt } from "@/lib/crypto";
import type { DB } from "@/db/types";

/**
 * The inbound webhook route's authentication decisions.
 *
 * Why these are worth a route test rather than a connector unit test: the route
 * decides what `secret` the connector even sees, and the expensive bug lived
 * exactly there. A `decrypt` failure — a rotated `ENCRYPTION_KEY`, corrupted
 * ciphertext — silently produced `secret = null`, which is indistinguishable
 * from "no secret configured". For a fail-open connector that meant an
 * operator's key rotation quietly turned an authenticated endpoint into an
 * anonymous one.
 *
 * And what gets written that way is PERMANENT: webhook rows land at generation 0
 * with a null `stream_hash`, and every soft-delete site in the codebase skips
 * that class by construction, because the append-only guarantee depends on it.
 * There is no sweep that cleans up an injected row.
 */

const KEY = randomBytes(32).toString("base64");
let db: DB;
let close: () => Promise<void>;

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("@/inngest/client", () => ({ inngest: { send: async () => {} } }));

const { POST } = await import("@/app/api/webhooks/[connectionId]/route");

const post = (id: string, body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request(`https://app.example/api/webhooks/${id}`, { method: "POST", body: JSON.stringify(body), headers }), {
    params: Promise.resolve({ connectionId: id }),
  });

async function seed(o: { source: string; secret?: string | null; secretCiphertext?: string }): Promise<string> {
  const [row] = await db
    .insert(connections)
    .values({
      orgId: "org_hook",
      source: o.source,
      name: o.source,
      status: "active",
      authType: "secret",
      signingSecretEncrypted:
        o.secretCiphertext ?? (o.secret ? encrypt(o.secret, Buffer.from(KEY, "base64")) : null),
    })
    .returning({ id: connections.id });
  return row.id;
}

beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
});

describe("inbound webhook authentication", () => {
  it("rejects an unsigned POST to a connector that requires a signature", async () => {
    const id = await seed({ source: "sendblue", secret: "sb_secret" });
    const res = await post(id, { message_handle: "h1" });
    expect(res.status).toBe(401);
    expect(await db.select().from(rawEvents)).toHaveLength(0);
  });

  it("accepts a correctly signed POST", async () => {
    const id = await seed({ source: "sendblue", secret: "sb_secret" });
    const res = await post(id, { message_handle: "h1" }, { "sb-signing-secret": "sb_secret" });
    expect(res.status).toBe(202);
    expect(await db.select().from(rawEvents)).toHaveLength(1);
  });

  /**
   * THE regression. Before, this fell through to `secret = null` and a
   * fail-open connector accepted the request — so a key rotation turned a
   * protected endpoint into an open one, silently, and the rows it wrote could
   * never be removed.
   */
  it("rejects when a secret IS configured but cannot be decrypted", async () => {
    const id = await seed({ source: "sendblue", secretCiphertext: "not-valid-ciphertext" });
    const res = await post(id, { message_handle: "h1" }, { "sb-signing-secret": "anything" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "signing secret unreadable" });
    expect(await db.select().from(rawEvents)).toHaveLength(0);
  });

  /**
   * The catch-hook's open endpoint IS its product — an unsecured URL any tool
   * can POST to. That stays. What must NOT stay is an unreadable secret being
   * treated as no secret: an operator who chose to protect this endpoint keeps
   * that protection through a botched key rotation.
   */
  it("keeps the catch-hook open with no secret, but shut with an unreadable one", async () => {
    const open = await seed({ source: "webhook", secret: null });
    expect((await post(open, { hello: "world" })).status).toBe(202);

    const broken = await seed({ source: "webhook", secretCiphertext: "not-valid-ciphertext" });
    expect((await post(broken, { hello: "world" })).status).toBe(401);
  });

  it("records whether the payload was actually verified, rather than asserting it was", async () => {
    const open = await seed({ source: "webhook", secret: null });
    await post(open, { hello: "world" });
    const [unverified] = await db.select().from(rawEvents).where(eq(rawEvents.connectionId, open));
    // Was hardcoded `true`, so the provenance trail claimed every stored
    // payload had been checked — including the ones nothing checked.
    expect(unverified.signatureValid).toBe(false);

    const signed = await seed({ source: "sendblue", secret: "sb_secret" });
    await post(signed, { message_handle: "h1" }, { "sb-signing-secret": "sb_secret" });
    const [verified] = await db.select().from(rawEvents).where(eq(rawEvents.connectionId, signed));
    expect(verified.signatureValid).toBe(true);
  });

  it("does not reset the sweep backoff for a request it rejected", async () => {
    const id = await seed({ source: "sendblue", secret: "sb_secret" });
    const far = new Date(Date.now() + 6 * 3_600_000);
    await db.update(connections).set({ nextSweepAt: far, consecutiveNoOpSweeps: 40 }).where(eq(connections.id, id));

    await post(id, { message_handle: "h1" }); // unsigned → 401
    const [after] = await db.select().from(connections).where(eq(connections.id, id));
    // An open endpoint plus an unconditional promote would be a free "poll this
    // connection now" primitive for anyone who knows the URL.
    expect(after.nextSweepAt?.getTime()).toBe(far.getTime());
    expect(after.consecutiveNoOpSweeps).toBe(40);
  });
});
