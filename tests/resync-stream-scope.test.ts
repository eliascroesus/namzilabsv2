import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { connections, events, sourceStreams } from "@/db/schema";
import { runSync } from "@/lib/sync/resync";
import { streamConfigHash, normalizeStreamConfig } from "@/lib/sync/stream-hash";
import { encrypt } from "@/lib/crypto";
import type { DB } from "@/db/types";

/**
 * Cross-stream tombstoning regression (approval amendment #1).
 *
 * A FULL re-sync of a stream-scoped connection soft-deletes poll-managed rows
 * at an older generation. That delete must be scoped to the streams the run
 * actually re-polled — a blanket connection-wide delete tombstones rows of
 * streams it never read (e.g. a disabled stream), which is data loss.
 */

const ORG = "org_scope";
const KEY = randomBytes(32).toString("base64");
const CFG_A = { spreadsheetId: "SHEET", range: "TabA" };
const CFG_B = { spreadsheetId: "SHEET", range: "TabB" };

// Mutable per-tab fixtures served by the mocked Sheets API.
let TABS: Record<string, string[][]> = {};

let db: DB;
let close: () => Promise<void>;
let connId: string;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  TABS = {
    TabA: [
      ["name"],
      ["a-row-1"],
    ],
    TabB: [
      ["name"],
      ["b-row-1"],
      ["b-row-2"],
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const tab = Object.keys(TABS).find((t) => url.includes(`/values/${t}`));
      if (!tab) throw new Error(`unexpected fetch: ${url}`);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ values: TABS[tab] }),
        text: async () => JSON.stringify({ values: TABS[tab] }),
      } as unknown as Response;
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
      credentialsEncrypted: encrypt(JSON.stringify({ accessToken: "tok" }), Buffer.from(KEY, "base64")),
    })
    .returning({ id: connections.id });
  connId = row.id;
  for (const cfg of [CFG_A, CFG_B]) {
    await db.insert(sourceStreams).values({
      orgId: ORG,
      connectionId: connId,
      configHash: streamConfigHash(cfg, "gsheets"),
      config: normalizeStreamConfig(cfg, "gsheets"),
    });
  }
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await close();
});

async function liveNames(streamHash: string): Promise<string[]> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.connectionId, connId), eq(events.streamHash, streamHash), isNull(events.deletedAt)));
  return rows.map((r) => String((r.properties as Record<string, unknown>).name)).sort();
}

describe("full re-sync scopes soft-delete to the streams it re-polled", () => {
  it("a disabled stream's rows survive another stream's full re-sync", async () => {
    const hashA = streamConfigHash(CFG_A, "gsheets");
    const hashB = streamConfigHash(CFG_B, "gsheets");

    // Initial full import: both streams land at generation 1.
    const r1 = await runSync(db, connId, "full");
    expect(r1.generation).toBe(1);
    expect(await liveNames(hashA)).toEqual(["a-row-1"]);
    expect(await liveNames(hashB)).toEqual(["b-row-1", "b-row-2"]);

    // Pause stream A (user disabled it, or it's simply not being swept).
    await db
      .update(sourceStreams)
      .set({ status: "disabled" })
      .where(and(eq(sourceStreams.connectionId, connId), eq(sourceStreams.configHash, hashA)));

    // Upstream, TabB loses a row; TabA is NOT read this run.
    TABS.TabB = [["name"], ["b-row-1"]];

    const r2 = await runSync(db, connId, "full");
    expect(r2.generation).toBe(2);

    // B was re-polled: its upstream-removed row is tombstoned.
    expect(await liveNames(hashB)).toEqual(["b-row-1"]);
    expect(r2.softDeleted).toBe(1);

    // A was NOT re-polled: its rows MUST survive (the old blanket delete
    // tombstoned them because they were still at generation 1).
    expect(await liveNames(hashA)).toEqual(["a-row-1"]);
  });

  it("full re-sync sweeps legacy generation-0 stream rows (structural exemption: hash, not generation)", async () => {
    const hashA = streamConfigHash(CFG_A, "gsheets");
    // A pre-unification leftover: stream-tagged but generation 0, and its
    // sheet row no longer exists upstream.
    await db.insert(events).values({
      eventId: `gsheets:${connId}:${hashA}:row:99`,
      orgId: ORG,
      connectionId: connId,
      source: "gsheets",
      eventType: "row_added",
      occurredAt: new Date("2026-01-01T00:00:00Z"),
      properties: { name: "ghost" },
      streamHash: hashA,
      syncGeneration: 0,
    });
    // A webhook push row (NULL hash, generation 0) that must survive.
    await db.insert(events).values({
      eventId: `gsheets:${connId}:row:push-1`,
      orgId: ORG,
      connectionId: connId,
      source: "gsheets",
      eventType: "row_added",
      occurredAt: new Date("2026-01-01T00:00:00Z"),
      properties: { name: "push" },
      streamHash: null,
      syncGeneration: 0,
    });

    await runSync(db, connId, "full");

    const [ghost] = await db.select().from(events).where(eq(events.eventId, `gsheets:${connId}:${hashA}:row:99`));
    expect(ghost.deletedAt).not.toBeNull(); // swept on the first full pass
    const [push] = await db.select().from(events).where(eq(events.eventId, `gsheets:${connId}:row:push-1`));
    expect(push.deletedAt).toBeNull(); // structurally exempt (NULL stream_hash)
  });

  it("still tombstones upstream-deleted rows of every re-polled stream", async () => {
    const hashA = streamConfigHash(CFG_A, "gsheets");
    const hashB = streamConfigHash(CFG_B, "gsheets");
    await runSync(db, connId, "full");

    // Both tabs shrink; both streams active → both cleaned.
    TABS.TabA = [["name"]];
    TABS.TabB = [["name"], ["b-row-2"]];
    // gsheets ids are row-number based, so b-row-2 moving up to row 2 keeps that
    // id live while row 3's id disappears — the surviving set is what matters.
    const r = await runSync(db, connId, "full");
    expect(await liveNames(hashA)).toEqual([]);
    expect(await liveNames(hashB)).toEqual(["b-row-2"]);
    expect(r.softDeleted).toBe(2); // TabA row 2 + TabB row 3
  });
});
