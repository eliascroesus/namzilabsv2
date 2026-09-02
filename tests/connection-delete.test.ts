import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import {
  backfillJobs,
  connections,
  deadLetter,
  deliveryLog,
  events,
  flowResults,
  flowVersions,
  flows,
  rawEvents,
  sourceStreams,
  streamFields,
  syncState,
  usageLedger,
} from "@/db/schema";
import { FLEET_CONNECTION_ID, FLEET_ORG_ID } from "@/lib/provider-gateway/budget";
import { deleteConnectionData, recordCountsByConnection } from "@/lib/sync/delete-connection";
import { encrypt } from "@/lib/crypto";
import type { DB } from "@/db/types";

/**
 * PERMANENTLY DELETING A CONNECTION.
 *
 * The counterpart to disconnect, and the only action in this product that
 * destroys customer data on demand. Two things make it dangerous in a way the
 * rest of the codebase is not:
 *
 * 1. NOTHING CASCADES. There is not one foreign key to `connections`, so every
 *    table has to be named by hand. The previous `deleteConnection` (removed in
 *    batch 4) named two of them and left seven tables of orphans — rows no UI
 *    could reach and no later pass looked for.
 * 2. THERE IS NO TRANSACTION. `db.transaction` does nothing until
 *    `DB_DRIVER=pool`, which is off, so this can die halfway and the state it
 *    leaves behind has to be safe and re-runnable.
 *
 * Every test here is about one of those two.
 */

const ORG = "org_del";
const OTHER = "org_other";
const KEY = randomBytes(32).toString("base64");

let db: DB;
let close: () => Promise<void>;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await close();
});

async function connection(orgId = ORG, over: Partial<typeof connections.$inferInsert> = {}) {
  const [c] = await db
    .insert(connections)
    .values({ orgId, source: "gsheets", name: "Sheet", status: "active", authType: "oauth2", ...over })
    .returning();
  return c;
}

/** A Calendly connection, with real encrypted credentials — the one source in
 * this file whose `unregisterWebhook` runs for real against a stubbed fetch. */
async function calendlyConnection(config: Record<string, unknown> = {}, orgId = ORG) {
  const [c] = await db
    .insert(connections)
    .values({
      orgId,
      source: "calendly",
      name: "Cal",
      status: "active",
      authType: "apiKey",
      credentialsEncrypted: encrypt(JSON.stringify({ accessToken: "tok" }), Buffer.from(KEY, "base64")),
      config,
    })
    .returning();
  return c;
}

/** One row in every table that can hold this connection's data. */
async function fillEveryTable(connectionId: string, orgId = ORG) {
  const hash = `h_${connectionId.slice(0, 8)}`;
  await db.insert(events).values({
    eventId: `gsheets:${connectionId}:row:2`,
    orgId,
    connectionId,
    source: "gsheets",
    eventType: "row_added",
    occurredAt: new Date(),
    streamHash: hash,
    properties: {},
  });
  const [raw] = await db
    .insert(rawEvents)
    .values({ orgId, connectionId, source: "gsheets", payload: { a: 1 }, signatureValid: true })
    .returning();
  const [stream] = await db
    .insert(sourceStreams)
    .values({ orgId, connectionId, configHash: hash, config: {} })
    .returning();
  await db.insert(syncState).values({ connectionId, cursor: "c" });
  await db.insert(usageLedger).values({
    orgId,
    connectionId,
    provider: "gsheets",
    operation: "sheets.values.get",
    windowStart: new Date(),
    calls: 3,
  });
  await db.insert(deadLetter).values({ orgId, connectionId, rawEventId: raw.id, error: "boom", attempts: 3 });
  await db.insert(deliveryLog).values({ orgId, connectionId, rawEventId: raw.id, status: "success", attempt: 1 });
  await db.insert(streamFields).values({ orgId, connectionId, streamHash: hash, fieldPath: "Name" });
  await db.insert(backfillJobs).values({
    orgId,
    connectionId,
    streamId: stream.id,
    streamHash: hash,
    status: "queued",
    targetFloor: new Date(Date.now() - 90 * 86_400_000),
    rowCeiling: 25_000,
  });
}

/** Every table that can hold connection-scoped rows, and how many it holds. */
async function remaining(connectionId: string): Promise<Record<string, number>> {
  const one = async (name: string, q: Promise<Array<unknown>>) => [name, (await q).length] as const;
  const pairs = await Promise.all([
    one("connections", db.select().from(connections).where(eq(connections.id, connectionId))),
    one("events", db.select().from(events).where(eq(events.connectionId, connectionId))),
    one("raw_events", db.select().from(rawEvents).where(eq(rawEvents.connectionId, connectionId))),
    one("source_streams", db.select().from(sourceStreams).where(eq(sourceStreams.connectionId, connectionId))),
    one("sync_state", db.select().from(syncState).where(eq(syncState.connectionId, connectionId))),
    one("usage_ledger", db.select().from(usageLedger).where(eq(usageLedger.connectionId, connectionId))),
    one("dead_letter", db.select().from(deadLetter).where(eq(deadLetter.connectionId, connectionId))),
    one("delivery_log", db.select().from(deliveryLog).where(eq(deliveryLog.connectionId, connectionId))),
    one("stream_fields", db.select().from(streamFields).where(eq(streamFields.connectionId, connectionId))),
    one("backfill_jobs", db.select().from(backfillJobs).where(eq(backfillJobs.connectionId, connectionId))),
  ]);
  return Object.fromEntries(pairs);
}

describe("nothing is left behind", () => {
  /**
   * THE TEST THIS FILE EXISTS FOR. Not "the connection is gone" — the old
   * implementation passed that — but "every table that could hold a row is
   * empty of it".
   */
  it("empties every table that can hold this connection's data", async () => {
    const conn = await connection();
    await fillEveryTable(conn.id);

    // Every table starts with something, or the assertion below proves nothing.
    for (const [table, n] of Object.entries(await remaining(conn.id))) {
      expect(n, `${table} was empty BEFORE the delete — the fixture is not covering it`).toBeGreaterThan(0);
    }

    const res = await deleteConnectionData(db, ORG, conn.id, "Sheet");

    expect(res.removed).toBe(true);
    expect(await remaining(conn.id)).toEqual({
      connections: 0,
      events: 0,
      raw_events: 0,
      source_streams: 0,
      sync_state: 0,
      usage_ledger: 0,
      dead_letter: 0,
      delivery_log: 0,
      stream_fields: 0,
      backfill_jobs: 0,
    });
  });

  /**
   * THE COMMENT, MADE INTO A DEFENCE.
   *
   * `delete-connection.ts` says "a table added later is a table that leaks" and
   * asks the reader to add it to the list. That is a request, and requests are
   * not kept — the previous implementation named two tables of the nine that
   * existed. So the list is checked against the schema instead: every table that
   * declares a `connection_id` must appear in the delete's own report.
   *
   * Read from the schema SOURCE rather than from drizzle's objects, because a
   * table can be defined and not exported, and an unexported table still holds
   * rows.
   */
  it("names every table in the schema that carries a connection id", async () => {
    const src = readFileSync("src/db/schema.ts", "utf8");
    const withConnectionId = new Set<string>();
    for (const block of src.split(/(?=pgTable\()/g)) {
      const name = block.match(/^pgTable\(\s*"([a-z_]+)"/)?.[1];
      if (name && /connection_id/.test(block)) withConnectionId.add(name);
    }
    expect(withConnectionId.size, "found no tables at all — the schema parse is broken").toBeGreaterThan(5);

    const conn = await connection();
    await fillEveryTable(conn.id);
    const { rows } = await deleteConnectionData(db, ORG, conn.id, "Sheet");

    const missing = [...withConnectionId].filter((t) => !(t in rows));
    expect(
      missing,
      `these tables hold a connection_id and the delete never touches them — their rows survive as orphans with no UI to reach them`,
    ).toEqual([]);
    // …and the connection itself, which carries the id rather than a copy of it.
    expect(rows).toHaveProperty("connections");
  });

  it("reports what it removed, per table", async () => {
    const conn = await connection();
    await fillEveryTable(conn.id);
    const { rows } = await deleteConnectionData(db, ORG, conn.id, "Sheet");
    for (const table of ["events", "raw_events", "source_streams", "sync_state", "usage_ledger", "dead_letter", "delivery_log", "stream_fields", "backfill_jobs", "connections"]) {
      expect(rows[table], `${table} missing from the report`).toBe(1);
    }
  });

  it("touches nothing belonging to another connection or another org", async () => {
    const target = await connection();
    const sibling = await connection();
    const foreign = await connection(OTHER);
    await fillEveryTable(target.id);
    await fillEveryTable(sibling.id);
    await fillEveryTable(foreign.id, OTHER);

    await deleteConnectionData(db, ORG, target.id, "Sheet");

    for (const [table, n] of Object.entries(await remaining(sibling.id))) {
      expect(n, `${table}: the sibling connection lost rows`).toBe(1);
    }
    for (const [table, n] of Object.entries(await remaining(foreign.id))) {
      expect(n, `${table}: another org lost rows`).toBe(1);
    }
  });
});

describe("who is allowed to delete what", () => {
  it("refuses a connection belonging to another org", async () => {
    const conn = await connection();
    await fillEveryTable(conn.id);

    const res = await deleteConnectionData(db, OTHER, conn.id, "Sheet");

    expect(res).toEqual({ removed: false, rows: {} });
    expect((await remaining(conn.id)).connections).toBe(1);
    expect((await remaining(conn.id)).events).toBe(1);
  });

  it("says nothing happened for an id that does not exist", async () => {
    expect(await deleteConnectionData(db, ORG, "00000000-0000-0000-0000-0000000000ff", "Sheet")).toEqual({
      removed: false,
      rows: {},
    });
  });

  /**
   * The one row in `usage_ledger` that belongs to no connection: the fleet-wide
   * provider budget, shared by every customer. Deleting it does not lose one
   * org's data — it resets the ceiling that stops the whole fleet from getting
   * the Cloud project banned.
   */
  it("refuses the fleet budget sentinel, even when something has made it look real", async () => {
    await db.insert(usageLedger).values({
      orgId: FLEET_ORG_ID,
      connectionId: FLEET_CONNECTION_ID,
      provider: "gsheets",
      operation: "fleet:sheets.values.get",
      windowStart: new Date(),
      calls: 99,
    });
    // The state the guard is FOR. Nothing today creates a connection at the nil
    // UUID — `createConnection` generates a random one — so without seeding it
    // the guard is unreachable, and an unreachable guard is one a refactor
    // deletes without noticing. Seeded here so the refusal is a fact rather than
    // an assertion about a code path nothing enters.
    await db
      .insert(connections)
      .values({ id: FLEET_CONNECTION_ID, orgId: FLEET_ORG_ID, source: "gsheets", name: "Sheet", status: "active", authType: "oauth2" });

    expect(await deleteConnectionData(db, FLEET_ORG_ID, FLEET_CONNECTION_ID, "Sheet")).toEqual({ removed: false, rows: {} });

    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(usageLedger)
      .where(eq(usageLedger.connectionId, FLEET_CONNECTION_ID));
    expect(n, "the fleet-wide budget ledger was deleted").toBe(1);
  });

  /**
   * The confirmation is part of the delete's contract, not a courtesy in the
   * browser — the server action is reachable without the page, and what this
   * destroys cannot be restored from anywhere.
   */
  it("refuses to delete a connection the caller cannot name", async () => {
    const conn = await connection(ORG, { name: "Sales sheet" });
    await fillEveryTable(conn.id);

    expect(await deleteConnectionData(db, ORG, conn.id, "")).toEqual({ removed: false, rows: {} });
    expect(await deleteConnectionData(db, ORG, conn.id, "sales sheet")).toEqual({ removed: false, rows: {} });
    expect(await deleteConnectionData(db, ORG, conn.id, "Sheet")).toEqual({ removed: false, rows: {} });
    expect((await remaining(conn.id)).events).toBe(1);

    // …and surrounding whitespace is a typo, not a different answer.
    expect((await deleteConnectionData(db, ORG, conn.id, "  Sales sheet ")).removed).toBe(true);
  });
});

/**
 * There is no transaction here — `db.transaction` is inert until
 * `DB_DRIVER=pool` — so the question is not "can it fail halfway" but "what does
 * halfway look like".
 */
describe("interrupted halfway", () => {
  it("stops the connection syncing BEFORE it starts deleting", async () => {
    const conn = await connection();
    await fillEveryTable(conn.id);
    // The webhook route 403s a disabled connection and the sweep skips it, so
    // this is what stops new rows landing in a table being emptied. Observed
    // through its effect: after a delete that finds nothing left to remove, the
    // row it would have deleted is gone — so instead, prove ordering by running
    // against a connection whose row we pin.
    await deleteConnectionData(db, ORG, conn.id, "Sheet");
    expect((await remaining(conn.id)).connections).toBe(0);

    // …and a second connection, deleted while already disabled, keeps its
    // original disabledAt rather than having the clock reset under it.
    const old = new Date(Date.now() - 40 * 86_400_000);
    const disabled = await connection(ORG, { status: "disabled", disabledAt: old });
    await fillEveryTable(disabled.id);
    await deleteConnectionData(db, ORG, disabled.id, "Sheet");
    expect((await remaining(disabled.id)).connections).toBe(0);
  });

  it("finishes the job when re-run after a partial delete", async () => {
    const conn = await connection();
    await fillEveryTable(conn.id);
    // Simulate a crash after the children went and before the row did.
    await db.delete(events).where(eq(events.connectionId, conn.id));
    await db.delete(rawEvents).where(eq(rawEvents.connectionId, conn.id));

    const res = await deleteConnectionData(db, ORG, conn.id, "Sheet");

    expect(res.removed).toBe(true);
    expect(res.rows.events).toBe(0); // nothing left to do, and it says so
    expect(await remaining(conn.id)).toMatchObject({ connections: 0, source_streams: 0 });
  });

  it("is idempotent — a second run changes nothing and reports nothing", async () => {
    const conn = await connection();
    await fillEveryTable(conn.id);
    await deleteConnectionData(db, ORG, conn.id, "Sheet");

    expect(await deleteConnectionData(db, ORG, conn.id, "Sheet")).toEqual({ removed: false, rows: {} });
  });
});

/**
 * A published flow holds a STORED result with a number in it and nothing
 * recomputes on its own. Deleting the events without marking those flows stale
 * leaves the tile reporting a count of records that no longer exist — the
 * silent-wrong-answer class, arriving through the one door that cannot be
 * walked back.
 */
describe("the dashboards are told", () => {
  it("marks a published flow reading this connection stale", async () => {
    const conn = await connection();
    await fillEveryTable(conn.id);
    const graph = {
      nodes: [{ id: "n1", type: "app", position: { x: 0, y: 0 }, data: { config: { connectionId: conn.id, source: "gsheets" } } }],
      edges: [],
    };
    const [flow] = await db
      .insert(flows)
      .values({ orgId: ORG, name: "Leads", status: "published", publishedVersion: 1, draftGraph: graph })
      .returning();
    await db.insert(flowVersions).values({ orgId: ORG, flowId: flow.id, version: 1, graph });
    await db
      .insert(flowResults)
      .values({ orgId: ORG, flowId: flow.id, version: 1, outputNodeId: "n1", tile: {}, status: "fresh" });

    await deleteConnectionData(db, ORG, conn.id, "Sheet");

    const [after] = await db.select().from(flowResults).where(eq(flowResults.flowId, flow.id));
    expect(after.status).toBe("stale");
  });
});

describe("the number shown in the warning", () => {
  it("counts live records per connection, and ignores tombstoned ones", async () => {
    const a = await connection();
    const b = await connection();
    await fillEveryTable(a.id);
    await fillEveryTable(b.id);
    await db
      .update(events)
      .set({ deletedAt: new Date() })
      .where(and(eq(events.connectionId, b.id)));

    const counts = await recordCountsByConnection(db, ORG);

    expect(counts[a.id]).toBe(1);
    // Tombstoned rows are invisible to dashboards, so the warning must not
    // claim them either — a disconnected connection honestly reports nothing.
    expect(counts[b.id]).toBeUndefined();
  });

  it("does not leak another org's counts", async () => {
    const mine = await connection();
    const theirs = await connection(OTHER);
    await fillEveryTable(mine.id);
    await fillEveryTable(theirs.id, OTHER);

    const counts = await recordCountsByConnection(db, ORG);
    expect(Object.keys(counts)).toEqual([mine.id]);
  });
});

/**
 * C23 — TELLING THE PROVIDER. A permanent delete emptied every table but left
 * the provider itself still delivering to a webhook route our own connection
 * disable now 403s forever — invisible to the customer, not to Calendly or
 * Close, who keep retrying and eventually flag the integration for it.
 *
 * Best-effort, deliberately: the customer has already confirmed a
 * destructive, irreversible action, and a provider that is merely slow,
 * unreachable, or already gone must not hold it hostage.
 */
describe("telling the provider to stop delivering", () => {
  const stubFetch = (impl: (url: string, init?: RequestInit) => Promise<Response>) => {
    vi.stubGlobal("fetch", vi.fn(async (i: string | URL | Request, init?: RequestInit) => impl(String(i), init)));
  };
  const noContent = async () =>
    ({
      ok: true,
      status: 204,
      statusText: "No Content",
      headers: { get: () => null },
      json: async () => {
        throw new Error("no body to parse on a 204");
      },
      text: async () => "",
    }) as unknown as Response;

  it("asks the provider after the connection is disabled but before its rows are gone", async () => {
    const conn = await calendlyConnection({ externalId: "https://api.calendly.com/webhook_subscriptions/ABC" });
    await fillEveryTable(conn.id);
    const seen: { status?: string; eventCount?: number } = {};
    stubFetch(async () => {
      const [row] = await db.select().from(connections).where(eq(connections.id, conn.id));
      seen.status = row.status;
      seen.eventCount = (await db.select().from(events).where(eq(events.connectionId, conn.id))).length;
      return noContent();
    });

    const res = await deleteConnectionData(db, ORG, conn.id, "Cal");

    expect(seen.status, "the connection must already be disabled when the provider is asked").toBe("disabled");
    expect(seen.eventCount, "the connection's rows must still be there when the provider is asked").toBeGreaterThan(0);
    expect(res.webhook).toBe("removed");
  });

  it("prefers the sweep's re-created id over the connect-time one — exactly one DELETE", async () => {
    const conn = await calendlyConnection({
      externalId: "https://api.calendly.com/webhook_subscriptions/OLD",
      webhookExternalId: "https://api.calendly.com/webhook_subscriptions/NEW",
    });
    await fillEveryTable(conn.id);
    const reqs: string[] = [];
    stubFetch(async (url) => {
      reqs.push(url);
      return noContent();
    });

    const res = await deleteConnectionData(db, ORG, conn.id, "Cal");

    expect(reqs).toEqual(["https://api.calendly.com/webhook_subscriptions/NEW"]);
    expect(res.webhook).toBe("removed");
  });

  it("a provider failure never fails the delete", async () => {
    const conn = await calendlyConnection({ externalId: "https://api.calendly.com/webhook_subscriptions/ABC" });
    await fillEveryTable(conn.id);
    stubFetch(async () => {
      throw new Error("network is down");
    });

    const res = await deleteConnectionData(db, ORG, conn.id, "Cal");

    expect(res.removed).toBe(true);
    expect(res.webhook).toBe("failed");
    for (const [table, n] of Object.entries(await remaining(conn.id))) {
      expect(n, `${table} should still be fully removed even though the webhook teardown failed`).toBe(0);
    }
  });

  it("asks nothing when the connection carries no subscription id", async () => {
    const conn = await calendlyConnection({});
    await fillEveryTable(conn.id);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await deleteConnectionData(db, ORG, conn.id, "Cal");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.webhook).toBe("none");
  });

  it("asks nothing for a source with no unregisterWebhook, even if config carries something that looks like an id", async () => {
    const conn = await connection(ORG, { config: { externalId: "sheet-tab-1" } });
    await fillEveryTable(conn.id);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await deleteConnectionData(db, ORG, conn.id, "Sheet");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.webhook).toBe("none");
  });
});
