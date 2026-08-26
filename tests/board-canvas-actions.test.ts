import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { dashboardTiles, dashboardViews, rankAssignments, workspaceRanks } from "@/db/schema";
import type { DB } from "@/db/types";

/**
 * WHO MAY PUT A CHART ON A BOARD, AND WHOSE BOARD.
 *
 * Every id here arrives from a browser, so the two questions each action has to
 * answer before it writes anything are "may this person" and "is this theirs".
 * The permission half is a rank with no grants; the tenancy half is a second
 * org holding an identically shaped view, which is the fixture discipline
 * `tenant-isolation.test.ts` sets — a write that forgot its `where org_id`
 * passes every single-tenant test ever written.
 */

let db: DB;
let close: () => Promise<void>;
let ctx = { orgId: "org_a", userId: "user_1", role: "member" as string | undefined };

vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDb: () => db, getReadDb: () => db }));
vi.mock("@/lib/auth", () => ({ requireOrg: async () => ctx }));

const { addCustomTileAction, deleteCustomTileAction } = await import("@/app/dashboard/board-actions");

const A = "org_a";
const B = "org_b";

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  ctx = { orgId: A, userId: "user_1", role: "member" };
  await db.insert(dashboardViews).values([
    { id: "va", orgId: A, name: "Canvas", pos: "i", kind: "custom" },
    { id: "cols", orgId: A, name: "Columns", pos: "r", kind: "groups" },
    { id: "vb", orgId: B, name: "Theirs", pos: "i", kind: "custom" },
  ]);
});
afterEach(async () => {
  await close();
  vi.unstubAllEnvs();
});

const tilesOf = (viewId: string) => db.select().from(dashboardTiles).where(eq(dashboardTiles.viewId, viewId));

/** A rank that grants nothing, which is what turns the gate on. */
async function assignEmptyRank() {
  await db.insert(workspaceRanks).values({ id: "rank_viewer", orgId: A, name: "Viewer", allMetrics: true });
  await db.insert(rankAssignments).values({ orgId: A, userId: "user_1", rankId: "rank_viewer" });
}

describe("adding a chart", () => {
  it("writes the row and hands back the box the client should draw", async () => {
    const r = await addCustomTileAction("va", "flow:f1:o1", "bar");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // A bar chart lands six wide and six tall — `defaultSize`, shared with the
    // picker, so the tile arrives the size its chart needs rather than a size
    // the action invented.
    expect(r.tile).toMatchObject({ tileKey: "flow:f1:o1", chart: "bar", x: 0, y: 0, w: 6, h: 6 });
    expect(await tilesOf("va")).toHaveLength(1);
  });

  it("lands the next one at the bottom, so gravity can float it up", async () => {
    await addCustomTileAction("va", "flow:f1:o1", "number");
    const r = await addCustomTileAction("va", "flow:f1:o2", "number");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Placed below everything, at x 0; `compact` then floats it into the gap
    // beside the first rather than starting a lonely new row. One placement
    // algorithm, shared by this action, the drag preview and every render.
    expect(r.tile).toMatchObject({ x: 0, y: 4 });
  });

  it("accepts the same metric twice, as two different charts", async () => {
    // The whole reason this table exists. A placement could not do it.
    await addCustomTileAction("va", "flow:f1:o1", "number");
    const second = await addCustomTileAction("va", "flow:f1:o1", "bar");
    expect(second.ok).toBe(true);
    expect(await tilesOf("va")).toHaveLength(2);
  });

  it("refuses a groups view, which stores its arrangement somewhere else entirely", async () => {
    const r = await addCustomTileAction("cols", "flow:f1:o1", "number");
    expect(r.ok).toBe(false);
    expect(await tilesOf("cols")).toHaveLength(0);
  });

  it("refuses another org's view, even handed its real id", async () => {
    const r = await addCustomTileAction("vb", "flow:f1:o1", "number");
    expect(r.ok).toBe(false);
    // Sabotage: drop the `eq(orgId)` from the re-wall and this writes a chart
    // onto another workspace's dashboard.
    expect(await tilesOf("vb")).toHaveLength(0);
  });

  it("refuses a chart it cannot draw and a key it cannot parse", async () => {
    expect((await addCustomTileAction("va", "flow:f1:o1", "pie")).ok).toBe(false);
    expect((await addCustomTileAction("va", "not-a-key", "number")).ok).toBe(false);
    expect(await tilesOf("va")).toHaveLength(0);
  });

  it("refuses a caller whose rank does not allow rearranging the board", async () => {
    await assignEmptyRank();
    const r = await addCustomTileAction("va", "flow:f1:o1", "number");
    expect(r.ok).toBe(false);
    expect(await tilesOf("va")).toHaveLength(0);
  });

  it("stops at the cap rather than letting a script mint rows", async () => {
    vi.stubEnv("MAX_BOARD_TILES_PER_VIEW", "2");
    expect((await addCustomTileAction("va", "flow:f1:o1", "number")).ok).toBe(true);
    expect((await addCustomTileAction("va", "flow:f1:o2", "number")).ok).toBe(true);
    const third = await addCustomTileAction("va", "flow:f1:o3", "number");
    expect(third.ok).toBe(false);
    expect(await tilesOf("va")).toHaveLength(2);
  });
});

describe("removing a chart", () => {
  it("removes it, and leaves every other chart alone", async () => {
    const a = await addCustomTileAction("va", "flow:f1:o1", "number");
    await addCustomTileAction("va", "flow:f1:o2", "number");
    if (!a.ok) throw new Error("setup failed");

    expect((await deleteCustomTileAction(a.tile.id)).ok).toBe(true);
    const left = await tilesOf("va");
    expect(left).toHaveLength(1);
    expect(left[0].tileKey).toBe("flow:f1:o2");
  });

  it("will not remove another org's chart", async () => {
    await db.insert(dashboardTiles).values({
      id: "theirs",
      orgId: B,
      viewId: "vb",
      tileKey: "flow:f1:o1",
      chart: "number",
      config: {},
      x: 0,
      y: 0,
      w: 3,
      h: 4,
    });
    const r = await deleteCustomTileAction("theirs");
    // Filtered by id AND org, every time — the discipline every mutation in
    // this file follows. It reports success because it deleted the zero rows
    // it was allowed to; what matters is that the row survives.
    expect(r.ok).toBe(true);
    expect(await tilesOf("vb")).toHaveLength(1);
  });

  it("refuses a caller whose rank does not allow it", async () => {
    const a = await addCustomTileAction("va", "flow:f1:o1", "number");
    if (!a.ok) throw new Error("setup failed");
    await assignEmptyRank();
    expect((await deleteCustomTileAction(a.tile.id)).ok).toBe(false);
    expect(await tilesOf("va")).toHaveLength(1);
  });
});
