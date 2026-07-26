import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createTestDb } from "./helpers/testdb";
import { connections, events, flows, flowVersions, sourceStreams } from "@/db/schema";
import { normalizeStreamConfig, streamConfigHash, hasStreamConfig } from "@/lib/sync/stream-hash";
import { ensureStreamsForGraph, pruneOrphanStreams, referencedStreamKeys, streamRefsOfGraph } from "@/lib/sync/streams";
import { runFlow } from "@/lib/flow/engine";
import { parseGraph } from "@/lib/flow/types";
import type { DB } from "@/db/types";

const ORG = "org_streams";

describe("stream-hash — deterministic stream identity", () => {
  it("normalizes: drops empties/objects, trims, sorts keys", () => {
    expect(normalizeStreamConfig({ range: "", spreadsheetId: " X ", junk: { a: 1 }, n: 5 }, "gsheets")).toEqual({ n: "5", spreadsheetId: "X" });
    expect(normalizeStreamConfig(null, "gsheets")).toEqual({});
  });
  it("hashes equal configs equally regardless of key order or empties", () => {
    const a = streamConfigHash({ spreadsheetId: "X", range: "Tab1" }, "gsheets");
    const b = streamConfigHash({ range: "Tab1", spreadsheetId: "X", extra: "" }, "gsheets");
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
    expect(streamConfigHash({ spreadsheetId: "X", range: "Tab2" }, "gsheets")).not.toBe(a);
  });
  it("hasStreamConfig is false for empty/blank configs", () => {
    expect(hasStreamConfig({}, "gsheets")).toBe(false);
    expect(hasStreamConfig({ spreadsheetId: "" }, "gsheets")).toBe(false);
    expect(hasStreamConfig({ spreadsheetId: "X" }, "gsheets")).toBe(true);
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
    expect(rows[0].configHash).toBe(streamConfigHash({ spreadsheetId: "SHEET_A", range: "Tab1" }, "gsheets"));
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
    const hashA = streamConfigHash(cfgA, "gsheets");
    const hashB = streamConfigHash(cfgB, "gsheets");

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

/**
 * A stream created by a step that has since changed is an ORPHAN: nothing can
 * read it, and the sweep still polls it every cycle against the connection's
 * per-minute budget. Calendly made that acute — its meeting type used to be
 * part of the stream identity, so clicking through the dropdown left a stream
 * per click, each re-walking the same account.
 */
describe("pruneOrphanStreams — stop paying for streams no flow reads", () => {
  let db: DB;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => {
    await close();
  });

  async function seed() {
    const [conn] = await db
      .insert(connections)
      .values({ orgId: ORG, source: "gsheets", name: "Sheets", status: "active", authType: "oauth2" })
      .returning({ id: connections.id });
    const graph = {
      nodes: [{ id: "a1", type: "app", data: { config: { connectionId: conn.id, source: "gsheets", sourceConfig: { spreadsheetId: "KEEP", range: "Tab1" } } } }],
      edges: [],
    };
    await db.insert(flows).values({ orgId: ORG, name: "F", draftGraph: graph });
    await ensureStreamsForGraph(db, ORG, parseGraph(graph));
    // …and a stream from an earlier edit of that step, referenced by nothing.
    const orphanHash = streamConfigHash({ spreadsheetId: "GONE", range: "Tab1" }, "gsheets");
    await db.insert(sourceStreams).values({ orgId: ORG, connectionId: conn.id, configHash: orphanHash, config: { spreadsheetId: "GONE", range: "Tab1" } });
    await db.insert(events).values({
      eventId: "gsheets:orphan-row",
      orgId: ORG,
      connectionId: conn.id,
      source: "gsheets",
      streamHash: orphanHash,
      eventType: "row_added",
      occurredAt: new Date(),
      properties: {},
    });
    return { connId: conn.id, keepHash: streamConfigHash({ spreadsheetId: "KEEP", range: "Tab1" }, "gsheets"), orphanHash };
  }

  const statusOf = async (hash: string) =>
    (await db.select().from(sourceStreams).where(eq(sourceStreams.configHash, hash)).limit(1))[0]?.status;

  it("disables the unreferenced stream and leaves the referenced one alone", async () => {
    const { keepHash, orphanHash } = await seed();
    const res = await pruneOrphanStreams(db, ORG);
    expect(res.disabled).toBe(1);
    expect(await statusOf(orphanHash)).toBe("disabled");
    expect(await statusOf(keepHash)).toBe("active");
  });

  it("keeps the orphan's rows by default — a half-finished edit must not delete an import", async () => {
    await seed();
    const res = await pruneOrphanStreams(db, ORG);
    expect(res.retired).toBe(0);
    const live = await db.select().from(events).where(isNull(events.deletedAt));
    expect(live).toHaveLength(1);
  });

  it("retires them only when explicitly asked (the cleanup script)", async () => {
    await seed();
    const res = await pruneOrphanStreams(db, ORG, { retireRows: true });
    expect(res.retired).toBe(1);
    expect(await db.select().from(events).where(isNull(events.deletedAt))).toHaveLength(0);
  });

  it("re-activates a disabled stream when a flow references it again", async () => {
    const { connId, orphanHash } = await seed();
    await pruneOrphanStreams(db, ORG);
    expect(await statusOf(orphanHash)).toBe("disabled");

    // The user edits the step back to the resource they had before.
    await ensureStreamsForGraph(
      db,
      ORG,
      parseGraph({
        nodes: [{ id: "a1", type: "app", data: { config: { connectionId: connId, source: "gsheets", sourceConfig: { spreadsheetId: "GONE", range: "Tab1" } } } }],
        edges: [],
      }),
    );
    expect(await statusOf(orphanHash)).toBe("active");
  });

  /**
   * `flow_versions` grows by a row per publish, forever, and each row holds a
   * whole graph. Reading every one of them made this cost scale with a team's
   * publishing history rather than with what is actually running — which is why
   * it no longer runs on the draft autosave either.
   */
  it("counts the CURRENT published version, not every version ever published", async () => {
    const [conn] = await db
      .insert(connections)
      .values({ orgId: ORG, source: "gsheets", name: "Sheets", status: "active", authType: "oauth2" })
      .returning({ id: connections.id });
    const graphFor = (sheet: string) => ({
      nodes: [{ id: "a1", type: "app", data: { config: { connectionId: conn.id, source: "gsheets", sourceConfig: { spreadsheetId: sheet, range: "Tab1" } } } }],
      edges: [],
    });
    // Draft and v2 read SHEET_NEW; v1 is history and reads SHEET_OLD.
    const [flow] = await db
      .insert(flows)
      .values({ orgId: ORG, name: "F", draftGraph: graphFor("SHEET_NEW"), status: "published", publishedVersion: 2 })
      .returning({ id: flows.id });
    await db.insert(flowVersions).values({ flowId: flow.id, orgId: ORG, version: 1, graph: graphFor("SHEET_OLD") });
    await db.insert(flowVersions).values({ flowId: flow.id, orgId: ORG, version: 2, graph: graphFor("SHEET_NEW") });

    const keys = await referencedStreamKeys(db, ORG, () => "gsheets");
    expect(keys.has(`${conn.id}:${streamConfigHash({ spreadsheetId: "SHEET_NEW", range: "Tab1" }, "gsheets")}`)).toBe(true);
    expect(keys.has(`${conn.id}:${streamConfigHash({ spreadsheetId: "SHEET_OLD", range: "Tab1" }, "gsheets")}`)).toBe(false);
  });
});
