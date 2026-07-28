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
const sent: Array<{ name: string; data: Record<string, unknown> }> = [];
vi.mock("@/inngest/client", () => ({
  inngest: {
    send: async (e: { name: string; data: Record<string, unknown> }) => {
      sent.push(e);
    },
  },
}));

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
  sent.length = 0;
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

/**
 * 4b — a stream-scoped source's webhook is a DOORBELL.
 *
 * It was 202-ignored before verification even ran, on sound reasoning: a
 * connection-level payload carries no stream identity, so its records cannot be
 * attributed. What was wrong was discarding the SIGNAL along with the payload —
 * an authenticated POST proves this connection changed, and that is worth
 * acting on even when its contents are not usable.
 */
describe("a stream-scoped webhook rings the bell without delivering anything", () => {
  const sign = (secret: string, body: unknown) => {
    // Calendly's scheme: HMAC over `${t}.${rawBody}`.
    const raw = JSON.stringify(body);
    const t = "1700000000";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createHmac } = require("node:crypto") as typeof import("node:crypto");
    const v1 = createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
    return { "calendly-webhook-signature": `t=${t},v1=${v1}` };
  };

  it("sweeps the connection on an authenticated payload", async () => {
    const id = await seed({ source: "calendly", secret: "cal_secret" });
    const body = { event: "invitee.created" };

    const res = await post(id, body, sign("cal_secret", body));

    expect(res.status).toBe(202);
    const swept = sent.filter((e) => e.name === "ingest/reconcile.requested");
    expect(swept).toHaveLength(1);
    expect(swept[0].data).toMatchObject({ connectionId: id, jitterMs: 0 });
  });

  /**
   * THE constraint. Records written from here land at generation 0 with a null
   * `stream_hash`, and every one of the seven soft-delete sites skips that
   * class by construction — so they would be permanent, unreachable duplicates
   * of the rows the poll writes properly.
   */
  it("stores nothing and never enqueues ingestion", async () => {
    const id = await seed({ source: "calendly", secret: "cal_secret" });
    const body = { event: "invitee.created" };

    await post(id, body, sign("cal_secret", body));

    expect(await db.select().from(rawEvents).where(eq(rawEvents.connectionId, id))).toHaveLength(0);
    expect(sent.filter((e) => e.name === "ingest/raw.received")).toHaveLength(0);
  });

  /**
   * The doorbell is only worth anything if it is authenticated. Anyone who can
   * POST to the URL could otherwise force a sweep on demand — a free way to
   * spend someone else's provider budget.
   */
  it("does not sweep on an unsigned payload", async () => {
    const id = await seed({ source: "calendly", secret: "cal_secret" });

    const res = await post(id, { event: "invitee.created" });

    expect(res.status).toBe(401);
    expect(sent.filter((e) => e.name === "ingest/reconcile.requested")).toHaveLength(0);
  });

  it("does not sweep when the secret cannot be read", async () => {
    const id = await seed({ source: "calendly", secretCiphertext: "not-decryptable" });

    const res = await post(id, { event: "invitee.created" });

    expect(res.status).toBe(401);
    expect(sent).toHaveLength(0);
  });
});
