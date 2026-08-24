import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { flowResults, flows } from "@/db/schema";
import { calendarFlowTiles, publishedFlowTiles } from "@/lib/flow/materialize";
import type { DB } from "@/db/types";

/**
 * The dashboard's tile read, extracted out of a bare `catch {}` whose
 * rationale ("flow_results may not exist before migration 0002") outlived
 * itself by nineteen migrations. Two contracts matter:
 *
 * 1. The row carries the STORED ERROR — a broken tile that renders a red
 *    pill and nothing else tells the customer their number is broken while
 *    withholding the one fact they could act on.
 * 2. A failed read THROWS to the caller. The page turns it into the
 *    load-error banner; swallowing it rendered "No metrics yet." over a
 *    customer's real published tiles on any transient DB failure — the empty
 *    state as a lie.
 */

const ORG = "org_tiles";

let db: DB;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

async function seedFlow(status: "published" | "draft", name: string) {
  const graph = { nodes: [], edges: [], metrics: [] };
  const [flow] = await db
    .insert(flows)
    .values({ orgId: ORG, name, draftGraph: graph, status, publishedVersion: status === "published" ? 1 : null })
    .returning();
  return flow;
}

describe("publishedFlowTiles", () => {
  it("returns published tiles WITH their stored error, and never a draft's", async () => {
    const published = await seedFlow("published", "Broken but published");
    const draft = await seedFlow("draft", "Draft");
    await db.insert(flowResults).values([
      { orgId: ORG, flowId: published.id, version: 1, outputNodeId: "o1", tile: null, status: "error", error: "boom: node f1 failed" },
      { orgId: ORG, flowId: draft.id, version: 1, outputNodeId: "o1", tile: { value: 1 }, status: "fresh" },
    ]);

    const rows = await publishedFlowTiles(db, ORG);

    expect(rows).toHaveLength(1);
    expect(rows[0].flowId).toBe(published.id);
    // THE contract item 1: drop `error` from the select and this fails.
    expect(rows[0].error).toBe("boom: node f1 failed");
  });

  it("is org-scoped", async () => {
    const mine = await seedFlow("published", "Mine");
    await db.insert(flowResults).values({ orgId: ORG, flowId: mine.id, version: 1, outputNodeId: "o1", tile: {}, status: "fresh" });
    expect(await publishedFlowTiles(db, "org_other")).toHaveLength(0);
  });

  it("REJECTS on a failed read instead of deciding silence is acceptable", async () => {
    await db.execute(sql`drop table flow_results`);
    // THE contract item 2: wrap the query in a try/catch inside the helper
    // and this fails — the page's loadError banner is the only place allowed
    // to decide what a failure looks like.
    await expect(publishedFlowTiles(db, ORG)).rejects.toThrow();
  });
});

/**
 * THE TWO READS ARE NARROW ON PURPOSE, AND NOTHING ELSE SAYS SO.
 *
 * One tile row feeds two screens that want opposite halves of it: the board
 * wants the ranges and the sample, the calendar wants the day map. Selecting
 * the whole jsonb for both is the easy shape and it is the expensive one —
 * `byDay` is sixty-odd entries on the query that runs on every dashboard
 * render, and `sample` is up to five whole records on the one that runs on
 * every calendar render, against a database that bills every byte it returns.
 *
 * Both halves are invisible when broken: the dashboard would look identical
 * while shipping the days it ignores, and the calendar identical while
 * shipping records it never draws. So the split is pinned here.
 */
describe("each screen reads only its own half of the tile", () => {
  const TILE = {
    name: "Leads",
    format: "number",
    precision: 0,
    value: 12,
    sample: [{ occurredAt: "2026-08-01T00:00:00Z", properties: { a: 1 } }],
    byRange: { today: { value: 3 } },
    byDay: { "2026-08-01": { value: 3, records: 4 } },
  };

  it("the dashboard gets the ranges and not the day map", async () => {
    const flow = await seedFlow("published", "Board");
    await db.insert(flowResults).values({ orgId: ORG, flowId: flow.id, version: 1, outputNodeId: "o1", tile: TILE, status: "fresh" });

    const [row] = await publishedFlowTiles(db, ORG);
    const tile = row.tile as Record<string, unknown>;
    expect(tile.byRange).toEqual({ today: { value: 3 } });
    expect(tile.value).toBe(12);
    expect(tile).not.toHaveProperty("byDay");
  });

  it("the calendar gets the day map and not the sample records", async () => {
    const flow = await seedFlow("published", "Calendar");
    await db.insert(flowResults).values({ orgId: ORG, flowId: flow.id, version: 1, outputNodeId: "o1", tile: TILE, status: "fresh" });

    const [row] = await calendarFlowTiles(db, ORG);
    const tile = row.tile as Record<string, unknown>;
    expect(tile.byDay).toEqual({ "2026-08-01": { value: 3, records: 4 } });
    // The keys that decide how a day is SPELLED ride along; nothing else does.
    expect(tile.name).toBe("Leads");
    expect(tile.format).toBe("number");
    expect(tile).not.toHaveProperty("sample");
    expect(tile).not.toHaveProperty("byRange");
  });

  it("survives a row whose tile never computed", async () => {
    // `NULL - 'byDay'` is NULL and `NULL -> 'name'` is NULL; both readers treat
    // that as "no stored tile" and fall back. A row like this is the ordinary
    // state of a flow whose first materialize failed.
    const flow = await seedFlow("published", "Never computed");
    await db.insert(flowResults).values({ orgId: ORG, flowId: flow.id, version: 1, outputNodeId: "o1", tile: null, status: "error", error: "boom" });

    expect((await publishedFlowTiles(db, ORG))[0].tile).toBeNull();
    expect((await calendarFlowTiles(db, ORG))[0].tile).toMatchObject({ name: null, byDay: null });
  });
});
