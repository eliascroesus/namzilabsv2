import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import {
  dashboardGroups,
  dashboardTilePlacements,
  dashboardTiles,
  dashboardViews,
  rankAssignments,
  workspaceRanks,
} from "@/db/schema";
import type { DB } from "@/db/types";

let db: DB;
let close: () => Promise<void>;
let ctx = { orgId: "org_a", userId: "user_1", role: "member" as string | undefined };

vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDb: () => db, getReadDb: () => db }));
vi.mock("@/lib/auth", () => ({ requireOrg: async () => ctx }));

const { duplicateCustomTileAction, duplicateViewAction } = await import("@/app/dashboard/board-actions");

const A = "org_a";
const B = "org_b";

/**
 * COPYING AN ARRANGEMENT WITHOUT COPYING WHAT IT POINTS AT.
 *
 * A view is the thing customers are most reluctant to experiment with — it is
 * shared, and a bad afternoon of dragging is visible to everyone — so the
 * answer is a copy to try it on. Two things make that harder than it sounds:
 *
 *   THE GROUPS BRANCH HAS AN ID REMAP. Placements point AT groups, so copying
 *   them with their original `group_id` cross-links the new view's tiles into
 *   the ORIGINAL's columns. Recolour a group on the copy and it moves on the
 *   original; delete the original and the copy's placements go with it. The
 *   test below is the one that catches that, and it catches it by asserting on
 *   the original as well as the copy.
 *
 *   A PARTIAL COPY IS WORSE THAN A FAILURE, and worse in a specific way: a
 *   failed duplicate announces itself, while a view holding two of its eleven
 *   charts looks like a finished view somebody made badly. The customer cannot
 *   tell it is half. Hence one transaction, and hence the rollback test.
 */

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  ctx = { orgId: A, userId: "user_1", role: "member" };
  await db.insert(dashboardViews).values([
    { id: "canvas", orgId: A, name: "Canvas", pos: "i", kind: "custom" },
    { id: "cols", orgId: A, name: "Columns", pos: "r", kind: "groups" },
    { id: "theirs", orgId: B, name: "Theirs", pos: "i", kind: "custom" },
  ]);
});
afterEach(async () => {
  await close();
  vi.unstubAllEnvs();
});

const tilesOf = (viewId: string) => db.select().from(dashboardTiles).where(eq(dashboardTiles.viewId, viewId));
const viewsOf = (orgId: string) => db.select().from(dashboardViews).where(eq(dashboardViews.orgId, orgId));

async function seedTile(over: Partial<typeof dashboardTiles.$inferInsert> = {}) {
  const id = crypto.randomUUID();
  await db.insert(dashboardTiles).values({
    id,
    orgId: A,
    viewId: "canvas",
    tileKey: "flow:f1:o1",
    chart: "number",
    config: { color: "teal", precision: 2 },
    x: 0,
    y: 0,
    w: 3,
    h: 4,
    ...over,
  });
  return id;
}

describe("duplicating one chart", () => {
  it("copies what it is and lands it beside the original", async () => {
    const id = await seedTile();
    const r = await duplicateCustomTileAction(id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const rows = await tilesOf("canvas");
    expect(rows).toHaveLength(2);
    const copy = rows.find((t) => t.id !== id)!;
    expect(copy.id).not.toBe(id);
    expect(copy.tileKey).toBe("flow:f1:o1");
    expect(copy.chart).toBe("number");
    expect(copy.config).toEqual({ color: "teal", precision: 2 });
    expect({ w: copy.w, h: copy.h }).toEqual({ w: 3, h: 4 });
    // Beside: same row, one width to the right.
    expect({ x: copy.x, y: copy.y }).toEqual({ x: 3, y: 0 });
  });

  it("falls below when the row has no room to the right", async () => {
    // A tile at x=6 with w=6 reaches the right edge, so `x + w` would overflow.
    const id = await seedTile({ x: 6, w: 6 });
    const r = await duplicateCustomTileAction(id);
    expect(r.ok).toBe(true);
    const copy = (await tilesOf("canvas")).find((t) => t.id !== id)!;
    expect(copy.x).toBe(6);
    expect(copy.y).toBeGreaterThan(0);
  });

  it("runs the result through the same packer everything else uses", async () => {
    /**
     * The copy is placed APPROXIMATELY and the packer decides for real, so a
     * duplicate lands exactly where dropping one there would have. Here the
     * slot beside the original is taken, so the copy cannot stay at x+w — and
     * nothing may end up overlapping.
     */
    const id = await seedTile();
    await seedTile({ x: 3, y: 0 });
    const r = await duplicateCustomTileAction(id);
    expect(r.ok).toBe(true);

    const rows = await tilesOf("canvas");
    expect(rows).toHaveLength(3);
    for (const a of rows) {
      for (const b of rows) {
        if (a.id === b.id) continue;
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart, `${a.id} and ${b.id} overlap`).toBe(true);
      }
    }
  });

  it("refuses when the view is full, and writes nothing", async () => {
    vi.stubEnv("MAX_BOARD_TILES_PER_VIEW", "2");
    const id = await seedTile();
    await seedTile({ x: 3 });
    const r = await duplicateCustomTileAction(id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("limit of 2");
    expect(await tilesOf("canvas")).toHaveLength(2);
  });

  it("refuses another org's chart, even handed its real id", async () => {
    const id = crypto.randomUUID();
    await db.insert(dashboardTiles).values({
      id,
      orgId: B,
      viewId: "theirs",
      tileKey: "flow:f9:o1",
      chart: "number",
      config: {},
      x: 0,
      y: 0,
      w: 3,
      h: 4,
    });
    // Sabotage: drop the `eq(orgId)` from the re-wall and this copies a chart
    // off another workspace's board onto this one.
    expect((await duplicateCustomTileAction(id)).ok).toBe(false);
    expect(await tilesOf("theirs")).toHaveLength(1);
  });

  it("refuses a caller whose rank does not allow rearranging the board", async () => {
    const id = await seedTile();
    await db.insert(workspaceRanks).values({ id: "rank_viewer", orgId: A, name: "Viewer", allMetrics: true });
    await db.insert(rankAssignments).values({ orgId: A, userId: "user_1", rankId: "rank_viewer" });
    expect((await duplicateCustomTileAction(id)).ok).toBe(false);
    expect(await tilesOf("canvas")).toHaveLength(1);
  });
});

describe("duplicating a custom view", () => {
  it("copies every box and every config, under new ids", async () => {
    const a = await seedTile();
    const b = await seedTile({ x: 3, y: 2, w: 6, h: 5, chart: "bar", config: { showLabels: true } });

    const r = await duplicateViewAction("canvas");
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const [view] = await db.select().from(dashboardViews).where(eq(dashboardViews.id, r.viewId));
    expect(view.name).toBe("Canvas (copy)");
    expect(view.kind).toBe("custom");

    const copies = await tilesOf(r.viewId);
    expect(copies).toHaveLength(2);
    // Same arrangement...
    expect(copies.map((t) => `${t.chart}@${t.x},${t.y},${t.w},${t.h}`).sort()).toEqual(
      (await tilesOf("canvas")).map((t) => `${t.chart}@${t.x},${t.y},${t.w},${t.h}`).sort(),
    );
    expect(copies.find((t) => t.chart === "bar")!.config).toEqual({ showLabels: true });
    // ...under ids of its own, or editing the copy would edit the original.
    for (const c of copies) expect([a, b]).not.toContain(c.id);
  });

  it("copies an empty view without inventing a row", async () => {
    const r = await duplicateViewAction("canvas");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await tilesOf(r.viewId)).toHaveLength(0);
  });
});

describe("duplicating a groups view", () => {
  async function seedColumns() {
    await db.insert(dashboardGroups).values([
      { id: "g1", orgId: A, viewId: "cols", name: "Acquisition", color: "teal", pos: "i", sortKey: "manual" },
      { id: "g2", orgId: A, viewId: "cols", name: "Retention", color: "olive", pos: "r", sortKey: "value_desc" },
    ]);
    await db.insert(dashboardTilePlacements).values([
      { orgId: A, viewId: "cols", tileKey: "flow:f1:o1", groupId: "g1", pos: "i" },
      { orgId: A, viewId: "cols", tileKey: "flow:f2:o1", groupId: "g2", pos: "i" },
      // An UNGROUPED placement: it must stay ungrouped rather than acquiring one.
      { orgId: A, viewId: "cols", tileKey: "metric:m1", groupId: null, pos: "r" },
    ]);
  }

  const groupsOf = (viewId: string) => db.select().from(dashboardGroups).where(eq(dashboardGroups.viewId, viewId));
  const placementsOf = (viewId: string) =>
    db.select().from(dashboardTilePlacements).where(eq(dashboardTilePlacements.viewId, viewId));

  it("remaps every group id, so the copy's tiles sit in the COPY's columns", async () => {
    await seedColumns();
    const r = await duplicateViewAction("cols");
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const newGroups = await groupsOf(r.viewId);
    expect(newGroups.map((g) => g.name).sort()).toEqual(["Acquisition", "Retention"]);
    expect(newGroups.map((g) => g.color).sort()).toEqual(["olive", "teal"]);
    expect(newGroups.find((g) => g.name === "Retention")!.sortKey).toBe("value_desc");
    // New ids, or recolouring a column on the copy recolours it on the original.
    for (const g of newGroups) expect(["g1", "g2"]).not.toContain(g.id);

    const newPlacements = await placementsOf(r.viewId);
    expect(newPlacements).toHaveLength(3);

    /**
     * THE CROSS-LINK, ASSERTED DIRECTLY. Not one placement on the copy may
     * point at a group belonging to the original. Sabotage: copy the rows with
     * `groupId: p.groupId` and this fails on all three.
     */
    const mine = new Set(newGroups.map((g) => g.id));
    for (const p of newPlacements) {
      expect(["g1", "g2"], `${p.tileKey} still points at the original's column`).not.toContain(p.groupId);
      if (p.groupId != null) expect(mine.has(p.groupId), `${p.tileKey} points outside this view`).toBe(true);
    }

    // The mapping is preserved, not merely renumbered: each tile is in the
    // column with the same NAME it was in before.
    const nameOf = new Map(newGroups.map((g) => [g.id, g.name]));
    const byKey = new Map(newPlacements.map((p) => [p.tileKey, p.groupId ? nameOf.get(p.groupId) : null]));
    expect(byKey.get("flow:f1:o1")).toBe("Acquisition");
    expect(byKey.get("flow:f2:o1")).toBe("Retention");
    expect(byKey.get("metric:m1")).toBeNull();
  });

  it("leaves the original untouched", async () => {
    await seedColumns();
    await duplicateViewAction("cols");
    const original = await placementsOf("cols");
    expect(original.map((p) => p.groupId).sort()).toEqual(["g1", "g2", null]);
    expect((await groupsOf("cols")).map((g) => g.id).sort()).toEqual(["g1", "g2"]);
  });
});

describe("what duplicating refuses", () => {
  it("refuses another org's view", async () => {
    expect((await duplicateViewAction("theirs")).ok).toBe(false);
    expect(await viewsOf(A)).toHaveLength(2);
  });

  it("refuses when the workspace is at its view cap", async () => {
    vi.stubEnv("MAX_BOARD_VIEWS_PER_ORG", "3");
    // Two rows plus the default view that has none = the cap.
    const r = await duplicateViewAction("canvas");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("limit of 3 views");
    // Two rows + the row-less default view = three, which is the cap.
    expect(await viewsOf(A)).toHaveLength(2);
  });

  it("refuses a view holding more charts than one may hold", async () => {
    vi.stubEnv("MAX_BOARD_TILES_PER_VIEW", "1");
    await seedTile();
    await seedTile({ x: 3 });
    const r = await duplicateViewAction("canvas");
    expect(r.ok).toBe(false);
    expect(await viewsOf(A)).toHaveLength(2);
  });

  it("leaves NOTHING behind when the copy fails part-way", async () => {
    /**
     * THE REASON THIS IS ONE STATEMENT. A view holding two of its eleven charts
     * looks like a finished view somebody made badly — the customer cannot tell
     * it is half, so they trust it or repair it by hand.
     *
     * IT USED TO BE ONE TRANSACTION, and this test used to inject its failure by
     * spying on `db.transaction` and proxying the `tx` handle. That test was
     * green against code that COULD NOT WORK IN PRODUCTION: the deployed driver
     * is `neon-http`, which is stateless and answers `transaction()` with
     * `throw new Error("No transactions support in neon-http driver")`, while
     * PGlite — a real embedded Postgres with sessions — ran it happily. The
     * suite was greener than the app by construction, so duplicating a view has
     * never once worked for a customer.
     *
     * The copy is now a single data-modifying CTE, and this asserts the property
     * that replaced the rollback: a statement that aborts writes NOTHING, which
     * is Postgres's own guarantee rather than a driver feature.
     *
     * THE FAILURE IS REAL, NOT MOCKED. `crypto.randomUUID` is pinned to one
     * value, so both copied tiles are minted with the same primary key and the
     * second row violates it — Postgres aborts the whole statement after the
     * view row inside it would have been written. Nothing is stubbed to throw;
     * the database does the refusing, which is the only version of this test
     * that can fail if the atomicity is lost.
     */
    await seedTile();
    await seedTile({ x: 3 });
    const before = await viewsOf(A);

    const spy = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("11111111-2222-4333-8444-555555555555");
    const r = await duplicateViewAction("canvas");
    spy.mockRestore();

    expect(r.ok).toBe(false);
    // Sabotage: split the CTE back into two statements and the view row
    // survives here — an empty "Canvas (copy)" nobody asked for.
    expect(await viewsOf(A)).toHaveLength(before.length);
    expect(await db.select().from(dashboardTiles).where(and(eq(dashboardTiles.orgId, A)))).toHaveLength(2);
  });
});
