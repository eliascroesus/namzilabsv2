import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { connections, deadLetter, deliveryLog, events, rawEvents } from "@/db/schema";
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
 * And what gets written that way is PERMANENT as far as anything automatic goes:
 * webhook rows land at generation 0 with a null `stream_hash`, and every SWEEP's
 * soft-delete is generation-guarded or stream-hash-scoped, because the
 * append-only guarantee depends on it. No sweep cleans up an injected row. (One
 * operator-invoked tool does reach generation 0 — disconnect, which retires a
 * whole connection's rows whatever their generation — so "permanent" means "no
 * automatic repair", not "literally unreachable".)
 */

const KEY = randomBytes(32).toString("base64");
let db: DB;
let close: () => Promise<void>;

vi.mock("@/db/client", () => ({ getDb: () => db }));
const sent: Array<{ name: string; data: Record<string, unknown> }> = [];
let sendShouldFail = false;
vi.mock("@/inngest/client", () => ({
  inngest: {
    send: async (e: { name: string; data: Record<string, unknown> }) => {
      if (sendShouldFail) throw new Error("inngest unreachable");
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
  sendShouldFail = false;
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
});

/**
 * Close's scheme: `close-sig-hash = HMAC-SHA256(fromhex(secret), timestamp + rawBody)`.
 * The secret is hex (the connector refuses anything else), and the timestamp must
 * be CURRENT — it is signed and doubles as replay protection.
 */
const CLOSE_SECRET = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const signClose = (secret: string, body: unknown) => {
  const t = String(Math.floor(Date.now() / 1000));
  const hash = createHmac("sha256", Buffer.from(secret, "hex"))
    .update(`${t}${JSON.stringify(body)}`, "utf8")
    .digest("hex");
  return { "close-sig-timestamp": t, "close-sig-hash": hash };
};
const CLOSE_EVENT = { event: { id: "ev_1", object_type: "activity.call", action: "created" } };

describe("inbound webhook authentication", () => {
  it("rejects an unsigned POST to a connector that requires a signature", async () => {
    const id = await seed({ source: "close", secret: CLOSE_SECRET });
    const res = await post(id, CLOSE_EVENT);
    expect(res.status).toBe(401);
    expect(await db.select().from(rawEvents)).toHaveLength(0);
  });

  it("accepts a correctly signed POST", async () => {
    const id = await seed({ source: "close", secret: CLOSE_SECRET });
    const res = await post(id, CLOSE_EVENT, signClose(CLOSE_SECRET, CLOSE_EVENT));
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
    const id = await seed({ source: "close", secretCiphertext: "not-valid-ciphertext" });
    const res = await post(id, CLOSE_EVENT, signClose(CLOSE_SECRET, CLOSE_EVENT));
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

    const signed = await seed({ source: "close", secret: CLOSE_SECRET });
    await post(signed, CLOSE_EVENT, signClose(CLOSE_SECRET, CLOSE_EVENT));
    const [verified] = await db.select().from(rawEvents).where(eq(rawEvents.connectionId, signed));
    expect(verified.signatureValid).toBe(true);
  });

  it("does not reset the sweep backoff for a request it rejected", async () => {
    const id = await seed({ source: "close", secret: CLOSE_SECRET });
    const far = new Date(Date.now() + 6 * 3_600_000);
    await db.update(connections).set({ nextSweepAt: far, consecutiveNoOpSweeps: 40 }).where(eq(connections.id, id));

    await post(id, CLOSE_EVENT); // unsigned → 401
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
    // Calendly's scheme: HMAC over `${t}.${rawBody}`. `t` must be CURRENT —
    // it is inside the signed payload and now doubles as replay protection,
    // so a fixture pinned to a past date is correctly rejected as a replay.
    const raw = JSON.stringify(body);
    const t = String(Math.floor(Date.now() / 1000));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createHmac } = require("node:crypto") as typeof import("node:crypto");
    const v1 = createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
    return { "calendly-webhook-signature": `t=${t},v1=${v1}` };
  };

  it("sweeps the connection on an authenticated payload — through the queue that ALWAYS runs", async () => {
    const id = await seed({ source: "calendly", secret: "cal_secret" });
    const body = { event: "invitee.created" };

    const res = await post(id, body, sign("cal_secret", body));

    expect(res.status).toBe(202);
    // sync/connection.requested, NOT ingest/reconcile.requested. The
    // reconcile worker is singleton-skip, so the old event vanished whenever
    // this connection's sweep was mid-flight — the doorbell rang into a void.
    // The sync queue queues per connection and always runs (the sender rule
    // in inngest/client.ts).
    const swept = sent.filter((e) => e.name === "sync/connection.requested");
    expect(swept).toHaveLength(1);
    expect(swept[0].data).toMatchObject({ connectionId: id, mode: "incremental" });
    expect(sent.filter((e) => e.name === "ingest/reconcile.requested")).toHaveLength(0);
  });

  /**
   * THE constraint. Records written from here land at generation 0 with a null
   * `stream_hash`, and no SWEEP can retire that class — every sweep's
   * soft-delete is generation-guarded or stream-hash-scoped — so they would be
   * unreachable duplicates of the rows the poll writes properly, with no
   * automatic route to removing them.
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
    expect(sent.filter((e) => e.name === "sync/connection.requested")).toHaveLength(0);
  });

  it("does not sweep when the secret cannot be read", async () => {
    const id = await seed({ source: "calendly", secretCiphertext: "not-decryptable" });

    const res = await post(id, { event: "invitee.created" });

    expect(res.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  /**
   * THE regression this batch adds. Cadence promotion already runs before the
   * send, so the row is never at risk — what an un-guarded send breaks is the
   * RESPONSE: `inngest.send` throwing propagates straight out of the handler,
   * and the provider sees a 500 for a delivery that needed nothing stored.
   * REVERT THE GUARD AND THIS FAILS: `post()` rejects instead of resolving.
   */
  it("still 202s and still promotes cadence when inngest.send throws", async () => {
    const id = await seed({ source: "calendly", secret: "cal_secret" });
    const far = new Date(Date.now() + 6 * 3_600_000);
    await db.update(connections).set({ nextSweepAt: far, consecutiveNoOpSweeps: 40 }).where(eq(connections.id, id));
    sendShouldFail = true;
    const body = { event: "invitee.created" };

    const res = await post(id, body, sign("cal_secret", body));

    expect(res.status).toBe(202);
    const [after] = await db.select().from(connections).where(eq(connections.id, id));
    expect(after.nextSweepAt?.getTime()).toBeLessThan(far.getTime());
    expect(after.consecutiveNoOpSweeps).toBe(0);
  });
});

/**
 * C.1 — an Inngest outage must never orphan the raw row.
 *
 * Before this guard, `inngest.send` threw straight out of the handler: Vercel
 * turned that into a 500, and the payload the route HAD already stored sat in
 * `raw_events` with nothing ever queued to process it — invisible even to the
 * DLQ page, because dead-lettering only ever ran from inside the processor
 * this event never reached. REVERT THE GUARD AND THIS FAILS: the row is
 * stored, no dead_letter/delivery_log row exists, and the route throws instead
 * of returning 202.
 */
describe("an Inngest enqueue failure does not orphan the raw row", () => {
  it("dead-letters the raw event and still 202s when inngest.send throws", async () => {
    const id = await seed({ source: "webhook", secret: null });
    sendShouldFail = true;

    const res = await post(id, { hello: "world" });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, queued: false });
    expect(typeof body.rawEventId).toBe("string");

    // The raw row is NOT orphaned — it is dead-lettered and replayable, same
    // as any other processing failure.
    const [raw] = await db.select().from(rawEvents).where(eq(rawEvents.connectionId, id));
    expect(raw).toBeTruthy();
    expect(raw.id).toBe(body.rawEventId);

    const dlq = await db.select().from(deadLetter).where(eq(deadLetter.rawEventId, raw.id));
    expect(dlq).toHaveLength(1);
    expect(dlq[0].error).toContain("enqueue failed");
    expect(dlq[0].attempts).toBe(0);

    const log = await db.select().from(deliveryLog).where(eq(deliveryLog.rawEventId, raw.id));
    expect(log.filter((l) => l.status === "failed")).toHaveLength(1);
  });

  it("does not process the event inline when the enqueue fails — no event exists yet", async () => {
    const id = await seed({ source: "webhook", secret: null });
    sendShouldFail = true;

    await post(id, { id: "e1", type: "booked" });

    // Fast-ack stays fast-ack: a queue outage is not a license to do the slow
    // work synchronously inside the request.
    expect(await db.select().from(events)).toHaveLength(0);
  });

  it("promotes cadence too, exactly as the success path does", async () => {
    const id = await seed({ source: "webhook", secret: null });
    const far = new Date(Date.now() + 6 * 3_600_000);
    await db.update(connections).set({ nextSweepAt: far, consecutiveNoOpSweeps: 40 }).where(eq(connections.id, id));
    sendShouldFail = true;

    const res = await post(id, { hello: "world" });

    expect(res.status).toBe(202);
    const [after] = await db.select().from(connections).where(eq(connections.id, id));
    expect(after.nextSweepAt?.getTime()).toBeLessThan(far.getTime());
    expect(after.consecutiveNoOpSweeps).toBe(0);
  });
});
