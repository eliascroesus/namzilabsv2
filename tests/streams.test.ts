import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { connections, events, sourceStreams } from "@/db/schema";
import { normalizeStreamConfig, streamConfigHash, hasStreamConfig } from "@/lib/sync/stream-hash";
import { ensureStreamsForGraph, streamRefsOfGraph, ensureFreshStream } from "@/lib/sync/streams";
import { encrypt } from "@/lib/crypto";
import { runFlow } from "@/lib/flow/engine";
import { parseGraph } from "@/lib/flow/types";
import type { DB } from "@/db/types";

const ORG = "org_streams";

describe("stream-hash — deterministic stream identity", () => {
  it("normalizes: drops empties/objects, trims, sorts keys", () => {
    expect(normalizeStreamConfig({ range: "", spreadsheetId: " X ", junk: { a: 1 }, n: 5 })).toEqual({ n: "5", spreadsheetId: "X" });
    expect(normalizeStreamConfig(null)).toEqual({});
  });
  it("hashes equal configs equally regardless of key order or empties", () => {
    const a = streamConfigHash({ spreadsheetId: "X", range: "Tab1" });
    const b = streamConfigHash({ range: "Tab1", spreadsheetId: "X", extra: "" });
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
    expect(streamConfigHash({ spreadsheetId: "X", range: "Tab2" })).not.toBe(a);
  });
  it("hasStreamConfig is false for empty/blank configs", () => {
    expect(hasStreamConfig({})).toBe(false);
    expect(hasStreamConfig({ spreadsheetId: "" })).toBe(false);
    expect(hasStreamConfig({ spreadsheetId: "X" })).toBe(true);
  });
});

describe("streams — flow save registers resources; engine reads per-stream", () => {
  let db: DB;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => {
    await close();
  });

  async function seedGsheetsConnection(): Promise<string> {
    const [row] = await db
      .insert(connections)
      .values({ orgId: ORG, source: "gsheets", name: "Sheets", status: "active", authType: "oauth2" })
      .returning({ id: connections.id });
    return row.id;
  }

  const appGraph = (connectionId: string, sourceConfig: Record<string, unknown>) =>
    parseGraph({
      nodes: [{ id: "a1", type: "app", data: { config: { connectionId, source: "gsheets", sourceConfig } } }],
      edges: [],
    });

  it("ensureStreamsForGraph creates one stream per distinct resource, idempotently", async () => {
    const connId = await seedGsheetsConnection();
    const g = appGraph(connId, { spreadsheetId: "SHEET_A", range: "Tab1" });
    const first = await ensureStreamsForGraph(db, ORG, g);
    expect(first.created).toBe(1);
    const again = await ensureStreamsForGraph(db, ORG, g);
    expect(again.created).toBe(0);
    const rows = await db.select().from(sourceStreams);
    expect(rows).toHaveLength(1);
    expect(rows[0].configHash).toBe(streamConfigHash({ spreadsheetId: "SHEET_A", range: "Tab1" }));
    expect(rows[0].config).toEqual({ range: "Tab1", spreadsheetId: "SHEET_A" });
  });

  it("ignores app steps without a resource and non-stream sources", async () => {
    const connId = await seedGsheetsConnection();
    const g = parseGraph({
      nodes: [
        { id: "a1", type: "app", data: { config: { connectionId: connId, source: "gsheets", sourceConfig: {} } } },
        { id: "a2", type: "app", data: { config: { connectionId: connId, source: "close", sourceConfig: { x: "1" } } } },
      ],
      edges: [],
    });
    expect(streamRefsOfGraph(g, () => "gsheets")).toHaveLength(0 + 0); // empty cfg + non-stream source
    const r = await ensureStreamsForGraph(db, ORG, g);
    expect(r.created).toBe(0);
  });

  it("execApp reads only its own stream's events", async () => {
    const connId = await seedGsheetsConnection();
    const cfgA = { spreadsheetId: "SHEET_A", range: "Tab1" };
    const cfgB = { spreadsheetId: "SHEET_B", range: "Tab1" };
    const hashA = streamConfigHash(cfgA);
    const hashB = streamConfigHash(cfgB);

    const mk = (streamHash: string | null, n: number) =>
      db.insert(events).values({
        eventId: `gsheets:${connId}:${streamHash ?? "x"}:row:${n}:${randomUUID()}`,
        orgId: ORG,
        connectionId: connId,
        source: "gsheets",
        eventType: "row_added",
        occurredAt: new Date(),
        properties: { n },
        streamHash,
      });
    await mk(hashA, 1);
    await mk(hashA, 2);
    await mk(hashA, 3);
    await mk(hashB, 1);
    await mk(null, 9); // legacy/webhook row, no stream

    const res = await runFlow({ db, orgId: ORG }, appGraph(connId, cfgA));
    const a1 = res.nodes.get("a1")!;
    expect(a1.status).toBe("ok");
    expect(a1.recordsOut).toBe(3); // only SHEET_A/Tab1 rows

    const resB = await runFlow({ db, orgId: ORG }, appGraph(connId, cfgB));
    expect(resB.nodes.get("a1")!.recordsOut).toBe(1);

    // No resource chosen → the whole connection (back-compat for connection-scoped sources).
    const resAll = await runFlow({ db, orgId: ORG }, appGraph(connId, {}));
    expect(resAll.nodes.get("a1")!.recordsOut).toBe(5);
  });
});

describe("ensureFreshStream — inline freshness for Test / field pickers", () => {
  const KEY = randomBytes(32).toString("base64");
  const CONFIG = { spreadsheetId: "S1", range: "Tab1" };
  let SHEET: string[][] = [];
  let fetchCount = 0;
  let db: DB;
  let close: () => Promise<void>;
  let connId: string;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = KEY;
  });

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    SHEET = [
      ["name", "email"],
      ["Alice", "alice@acme.com"],
    ];
    fetchCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (!url.includes("/values/")) throw new Error(`unexpected fetch: ${url}`);
        fetchCount += 1;
        return { ok: true, status: 200, statusText: "OK", json: async () => ({ values: SHEET }), text: async () => "" } as unknown as Response;
      }),
    );
    const [row] = await db
      .insert(connections)
      .values({
        orgId: ORG,
        source: "gsheets",
        name: "Sheets",
        status: "active",
        authType: "oauth2",
        credentialsEncrypted: encrypt(JSON.stringify({ accessToken: "tok", expiresAt: Date.now() + 3_600_000 }), Buffer.from(KEY, "base64")),
      })
      .returning({ id: connections.id });
    connId = row.id;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await close();
  });

  it("first use PRIMES: registers the stream and mirrors the resource inline", async () => {
    const r = await ensureFreshStream(db, ORG, connId, CONFIG);
    expect(r).toEqual({ ok: true });
    expect(fetchCount).toBe(1);
    const [stream] = await db.select().from(sourceStreams);
    expect(stream.configHash).toBe(streamConfigHash(CONFIG));
    expect(stream.lastPolledAt).not.toBeNull();
    expect(await db.select().from(events)).toHaveLength(1);
  });

  it("a fresh stream (younger than maxAgeMs) is NOT re-polled — Tests stay snappy", async () => {
    await ensureFreshStream(db, ORG, connId, CONFIG);
    const r = await ensureFreshStream(db, ORG, connId, CONFIG); // default 60s gate
    expect(r).toEqual({ ok: true });
    expect(fetchCount).toBe(1); // no second read
  });

  it("a stale stream re-reads the source, so a Test sees the sheet as it is NOW", async () => {
    await ensureFreshStream(db, ORG, connId, CONFIG);
    SHEET[1] = ["Alice", "alice@newco.com"]; // user edits their sheet…
    const r = await ensureFreshStream(db, ORG, connId, CONFIG, { maxAgeMs: 0 }); // …and the gate has aged out
    expect(r).toEqual({ ok: true });
    expect(fetchCount).toBe(2);
    const rows = await db.select().from(events);
    expect((rows[0].properties as Record<string, unknown>).email).toBe("alice@newco.com");
  });

  it("returns {ok:false, error} instead of throwing when the source is down (the Test surface renders it)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("google is unreachable");
      }),
    );
    const r = await ensureFreshStream(db, ORG, connId, CONFIG);
    expect(r).toEqual({ ok: false, error: "google is unreachable" });
    const [stream] = await db.select().from(sourceStreams);
    expect(stream.status).toBe("error");
  });

  it("no-ops (ok) for a connection-scoped source or an empty resource config", async () => {
    expect(await ensureFreshStream(db, ORG, connId, {})).toEqual({ ok: true });
    expect(fetchCount).toBe(0);
    const [close_] = await db
      .insert(connections)
      .values({ orgId: ORG, source: "close", name: "Close", status: "active", authType: "apiKey" })
      .returning({ id: connections.id });
    expect(await ensureFreshStream(db, ORG, close_.id, { x: "1" })).toEqual({ ok: true });
    expect(fetchCount).toBe(0);
  });

  it("fails soft with a clear error when the connection is gone", async () => {
    await db.delete(sourceStreams);
    await db.delete(connections).where(eq(connections.id, connId));
    const r = await ensureFreshStream(db, ORG, connId, CONFIG);
    expect(r).toEqual({ ok: false, error: "This step's connected account no longer exists." });
  });
});
