import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { dashboardTiles, dashboardViews, flowResults, flows, rankAssignments, workspaceRanks } from "@/db/schema";
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

const { addCustomTileAction, deleteCustomTileAction, setCustomTileAction, setCustomTileLayoutAction } =
  await import("@/app/dashboard/board-actions");

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
    // "sunburst" is the example precisely because it is NOT in CHART_IDS —
    // this slot used to read "pie", which the chart kit then made real. The
    // test caught that, which is the point; the guard is membership, so the
    // example has to be something the kit has never claimed to draw.
    expect((await addCustomTileAction("va", "flow:f1:o1", "sunburst")).ok).toBe(false);
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

describe("changing what a chart is", () => {
  const seed = async () => {
    const r = await addCustomTileAction("va", "flow:f1:o1", "number");
    if (!r.ok) throw new Error("setup failed");
    return r.tile.id;
  };
  const row = async (id: string) => (await db.select().from(dashboardTiles).where(eq(dashboardTiles.id, id)))[0];

  it("changes the drawing without touching the metric", async () => {
    const id = await seed();
    expect((await setCustomTileAction(id, { chart: "bar" })).ok).toBe(true);
    const r = await row(id);
    expect(r.chart).toBe("bar");
    expect(r.tileKey).toBe("flow:f1:o1");
  });

  it("repoints at another metric without touching the drawing", async () => {
    const id = await seed();
    expect((await setCustomTileAction(id, { tileKey: "metric:m9" })).ok).toBe(true);
    const r = await row(id);
    expect(r.tileKey).toBe("metric:m9");
    expect(r.chart).toBe("number");
  });

  it("stores a rename, and an empty one CLEARS it", async () => {
    const id = await seed();
    await setCustomTileAction(id, { title: "Revenue, this week" });
    expect((await row(id)).config).toEqual({ title: "Revenue, this week" });
    // Otherwise renaming a flow would silently stop updating a chart that had
    // once been renamed and then renamed back.
    await setCustomTileAction(id, { title: "  " });
    expect((await row(id)).config).toEqual({});
  });

  it("MERGES config on rename — an unrelated key survives", async () => {
    /**
     * THE CLOBBER REGRESSION. This action used to write `{ title }` over the
     * whole bag, harmless while the title was the only key and fatal the day
     * presentation lives there: renaming a tile would silently reset its
     * colour, sort and everything else it carries.
     */
    const id = await seed();
    await db.update(dashboardTiles).set({ config: { color: "teal", limit: 5 } }).where(eq(dashboardTiles.id, id));

    await setCustomTileAction(id, { title: "Renamed" });
    expect((await row(id)).config).toEqual({ color: "teal", limit: 5, title: "Renamed" });

    // Clearing the name removes ONLY the title key.
    await setCustomTileAction(id, { title: "" });
    expect((await row(id)).config).toEqual({ color: "teal", limit: 5 });
  });

  it("refuses a chart it cannot draw, a key it cannot parse, and another org's row", async () => {
    const id = await seed();
    expect((await setCustomTileAction(id, { chart: "sunburst" })).ok).toBe(false);
    expect((await setCustomTileAction(id, { tileKey: "nope" })).ok).toBe(false);
    ctx = { orgId: B, userId: "user_1", role: "member" };
    expect((await setCustomTileAction(id, { chart: "bar" })).ok).toBe(true);
    // Reports success for the zero rows it was allowed to touch; what matters
    // is that the row did not move.
    expect((await row(id)).chart).toBe("number");
  });
});

describe("writing a layout", () => {
  const seedTwo = async () => {
    const a = await addCustomTileAction("va", "flow:f1:o1", "number");
    const b = await addCustomTileAction("va", "flow:f1:o2", "number");
    if (!a.ok || !b.ok) throw new Error("setup failed");
    return [a.tile.id, b.tile.id] as const;
  };

  it("writes every box in one statement, each with its own values", async () => {
    const [a, b] = await seedTwo();
    const r = await setCustomTileLayoutAction("va", [
      { id: a, x: 6, y: 0, w: 6, h: 6 },
      { id: b, x: 0, y: 0, w: 6, h: 4 },
    ]);
    expect(r.ok).toBe(true);
    const rows = await tilesOf("va");
    // Sabotage: put a literal in the upsert's `set` instead of `excluded` and
    // both rows get the first tile's box.
    expect(rows.find((t) => t.id === a)).toMatchObject({ x: 6, w: 6, h: 6 });
    expect(rows.find((t) => t.id === b)).toMatchObject({ x: 0, w: 6, h: 4 });
  });

  it("refuses the WHOLE batch when one id is not on this view", async () => {
    const [a] = await seedTwo();
    const r = await setCustomTileLayoutAction("va", [
      { id: a, x: 6, y: 0, w: 6, h: 6 },
      { id: "someone-elses", x: 0, y: 0, w: 3, h: 4 },
    ]);
    expect(r.ok).toBe(false);
    /**
     * All-or-nothing on purpose. A per-row `where` would write the rows it was
     * allowed to and skip the rest, leaving a compacted grid half-applied —
     * which means overlapping tiles that nothing fixes until the next drag.
     */
    expect((await tilesOf("va")).find((t) => t.id === a)).toMatchObject({ x: 0, w: 3 });
  });

  it("refuses a box that does not fit the grid", async () => {
    const [a] = await seedTwo();
    expect((await setCustomTileLayoutAction("va", [{ id: a, x: 11, y: 0, w: 13, h: 4 }])).ok).toBe(false);
    expect((await setCustomTileLayoutAction("va", [{ id: a, x: -1, y: 0, w: 3, h: 4 }])).ok).toBe(false);
  });

  it("refuses a caller whose rank does not allow it", async () => {
    const [a] = await seedTwo();
    await assignEmptyRank();
    expect((await setCustomTileLayoutAction("va", [{ id: a, x: 6, y: 0, w: 6, h: 6 }])).ok).toBe(false);
  });
});

describe("a new tile starts from the flow's own presentation", () => {
  it("seeds precision and target from the published spec into the tile's config", async () => {
    /**
     * The facts/presentation seam's founding rule: the data source SUGGESTS,
     * the chart DECIDES. The flow's precision and target become the tile's
     * starting config — its own from then on, so a later change on the flow
     * does not silently restyle a tile someone already tuned.
     */
    const [flow] = await db
      .insert(flows)
      .values({ orgId: A, name: "rev", draftGraph: {}, status: "published", publishedVersion: 1 })
      .returning();
    await db.insert(flowResults).values({
      orgId: A,
      flowId: flow.id,
      version: 1,
      outputNodeId: "o1",
      tile: { name: "Revenue", format: "currency", precision: 2, target: 50000 },
      status: "fresh",
    });

    const r = await addCustomTileAction("va", `flow:${flow.id}:o1`, "number");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tile.config).toEqual({ precision: 2, target: 50000 });
  });

  it("seeds nothing when the spec has nothing to say", async () => {
    const [flow] = await db
      .insert(flows)
      .values({ orgId: A, name: "plain", draftGraph: {}, status: "published", publishedVersion: 1 })
      .returning();
    await db.insert(flowResults).values({
      orgId: A,
      flowId: flow.id,
      version: 1,
      outputNodeId: "o1",
      // `target: null` stores jsonb null — the value that punished `->` with a
      // cast error and is exactly why the seed reads `->>`.
      tile: { name: "Leads", format: "number", precision: 0, target: null },
      status: "fresh",
    });

    const r = await addCustomTileAction("va", `flow:${flow.id}:o1`, "number");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tile.config).toEqual({ precision: 0 });
  });

  it("will not seed from another org's flow row", async () => {
    const [flow] = await db
      .insert(flows)
      .values({ orgId: B, name: "theirs", draftGraph: {}, status: "published", publishedVersion: 1 })
      .returning();
    await db.insert(flowResults).values({
      orgId: B,
      flowId: flow.id,
      version: 1,
      outputNodeId: "o1",
      tile: { name: "Theirs", precision: 3, target: 9 },
      status: "fresh",
    });

    // The key parses, the row exists — but it is not ours, so the seed finds
    // nothing and the tile starts clean rather than from a neighbour's spec.
    const r = await addCustomTileAction("va", `flow:${flow.id}:o1`, "number");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tile.config).toEqual({});
  });
});
