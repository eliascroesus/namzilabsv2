import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { flows, flowVersions, flowResults } from "@/db/schema";
import { markStaleForSource, resultsVersion } from "@/lib/flow/materialize";
import { streamConfigHash } from "@/lib/sync/stream-hash";
import type { DB } from "@/db/types";

/**
 * G.1 (stream-scoped invalidation) and G.4 (results-version beacon): a change
 * in spreadsheet A must not recompute flows reading only spreadsheet B, and
 * the version string must move exactly when results move.
 */

const ORG = "org_stale";
const CFG_A = { spreadsheetId: "SHEET_A", range: "Tab1" };
const CFG_B = { spreadsheetId: "SHEET_B", range: "Tab1" };

let db: DB;
let close: () => Promise<void>;
let connId: string;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  connId = await seedConnection(db, { orgId: ORG, source: "gsheets" });
});
afterEach(async () => {
  await close();
});

async function publishFlow(name: string, sourceConfig: Record<string, unknown> | null): Promise<string> {
  const [flow] = await db
    .insert(flows)
    .values({ orgId: ORG, name, status: "published", publishedVersion: 1 })
    .returning({ id: flows.id });
  await db.insert(flowVersions).values({
    orgId: ORG,
    flowId: flow.id,
    version: 1,
    graph: {
      nodes: [{ id: "a1", type: "app", data: { config: { connectionId: connId, source: "gsheets", ...(sourceConfig ? { sourceConfig } : {}) } } }],
      edges: [],
    },
  });
  await db.insert(flowResults).values({
    orgId: ORG,
    flowId: flow.id,
    version: 1,
    outputNodeId: "a1",
    tile: {},
    status: "fresh",
    computedAt: new Date("2026-07-01T00:00:00Z"),
  });
  return flow.id;
}

async function statusOf(flowId: string): Promise<string> {
  const [r] = await db.select().from(flowResults).where(eq(flowResults.flowId, flowId));
  return r.status;
}

describe("G.1 — staleness is scoped to the streams that changed", () => {
  it("a change in stream A stales the A-flow and the whole-connection flow, not the B-flow", async () => {
    const flowA = await publishFlow("reads A", CFG_A);
    const flowB = await publishFlow("reads B", CFG_B);
    const flowAll = await publishFlow("reads whole connection", null);

    const affected = await markStaleForSource(db, ORG, "gsheets", connId, [streamConfigHash(CFG_A, "gsheets")]);
    expect(affected.sort()).toEqual([flowA, flowAll].sort());
    expect(await statusOf(flowA)).toBe("stale");
    expect(await statusOf(flowAll)).toBe("stale");
    expect(await statusOf(flowB)).toBe("fresh"); // untouched — no wasted recompute
  });

  it("callers without stream knowledge (webhook path) keep source-level matching", async () => {
    const flowA = await publishFlow("reads A", CFG_A);
    const flowB = await publishFlow("reads B", CFG_B);
    const affected = await markStaleForSource(db, ORG, "gsheets", connId);
    expect(affected.sort()).toEqual([flowA, flowB].sort());
  });
});

describe("G.4 — results-version beacon", () => {
  it("moves on recompute, staleness flip and tile count; stays put otherwise", async () => {
    const flowA = await publishFlow("reads A", CFG_A);
    const v1 = await resultsVersion(db, ORG);
    expect(await resultsVersion(db, ORG)).toBe(v1); // stable when nothing changes

    // Staleness flip moves it.
    await markStaleForSource(db, ORG, "gsheets", connId, [streamConfigHash(CFG_A, "gsheets")]);
    const v2 = await resultsVersion(db, ORG);
    expect(v2).not.toBe(v1);

    // Recompute (fresh + newer computedAt) moves it again.
    await db
      .update(flowResults)
      .set({ status: "fresh", computedAt: new Date("2026-07-02T00:00:00Z") })
      .where(eq(flowResults.flowId, flowA));
    const v3 = await resultsVersion(db, ORG);
    expect(v3).not.toBe(v2);

    // A new tile moves it; another org's world does not exist in this version.
    await publishFlow("reads B", CFG_B);
    const v4 = await resultsVersion(db, ORG);
    expect(v4).not.toBe(v3);
    // Five components since Phase 8: tiles, non-fresh, last computed, plus the
    // running-import count and how far back the deepest one has reached. An
    // import advancing changes no flow_results column, so without those last
    // two an open dashboard would never refresh its "still importing" label.
    expect(await resultsVersion(db, "org_other")).toBe("0.0.0.0.0");
  });
});
