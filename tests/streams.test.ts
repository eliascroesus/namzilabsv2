import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb } from "./helpers/testdb";
import { connections, events, sourceStreams } from "@/db/schema";
import { normalizeStreamConfig, streamConfigHash, hasStreamConfig } from "@/lib/sync/stream-hash";
import { ensureStreamsForGraph, streamRefsOfGraph } from "@/lib/sync/streams";
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
