import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestDb } from "./helpers/testdb";
import { dashboardTiles, dashboardViews } from "@/db/schema";
import { listBoardTiles } from "@/lib/board/tiles-store";
import { listBoardViews } from "@/lib/board/store";
import type { DB } from "@/db/types";

/**
 * THE CUSTOM CANVAS'S READ, AND THE ONE RULE ITS TABLE BREAKS.
 *
 * `dashboard_tile_placements` is keyed `(org, view, tile_key)`, so a metric
 * appears on a board exactly once — which is the right shape for columns and
 * the wrong one for a canvas. This table's identity is the row's own `id`
 * precisely so one metric can be a headline number, a trend and a breakdown
 * side by side, and the test below is what stops someone "tidying" that into a
 * composite key and quietly forbidding the feature.
 *
 * Two orgs with IDENTICAL shapes, the adversarial-fixture discipline
 * `tenant-isolation.test.ts` sets: a reader that forgot its `where org_id`
 * passes every single-tenant test ever written.
 */

const A = "org_a";
const B = "org_b";

let db: DB;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

const view = (id: string, orgId: string, kind: "groups" | "custom" = "custom") => ({
  id,
  orgId,
  name: "Canvas",
  pos: "i",
  kind,
});

const tile = (id: string, orgId: string, viewId: string, over: Partial<typeof base> = {}) => ({ ...base, ...over, id, orgId, viewId });
const base = { tileKey: "flow:f1:o1", chart: "number", config: {}, x: 0, y: 0, w: 3, h: 4 };

async function seedBoth() {
  await db.insert(dashboardViews).values([view("va", A), view("vb", B)]);
  await db.insert(dashboardTiles).values([
    tile("ta1", A, "va"),
    tile("ta2", A, "va", { chart: "bar", x: 3, w: 6, h: 6 }),
    tile("tb1", B, "vb"),
  ]);
}

describe("listBoardTiles", () => {
  it("shows one org nothing of the other's, on identically shaped data", async () => {
    await seedBoth();
    expect((await listBoardTiles(db, A, "va")).map((t) => t.id).sort()).toEqual(["ta1", "ta2"]);
    expect((await listBoardTiles(db, B, "vb")).map((t) => t.id)).toEqual(["tb1"]);
  });

  it("will not read another org's view even when handed its id", async () => {
    await seedBoth();
    // The id arrives from a browser. One belonging to another workspace must
    // find NOTHING rather than something — the discipline every read here holds.
    expect(await listBoardTiles(db, A, "vb")).toEqual([]);
  });

  it("returns exactly the columns the canvas draws, and no others", async () => {
    await seedBoth();
    const [t] = await listBoardTiles(db, A, "va");
    // `select()` would put every future column on the hottest page in the
    // product, on every twelve-second poll. The `dashboard-tiles.test.ts` rule.
    expect(Object.keys(t).sort()).toEqual(["chart", "config", "h", "id", "tileKey", "w", "x", "y"]);
  });

  it("hands back an empty object rather than null for a tile with no config", async () => {
    await seedBoth();
    const [t] = await listBoardTiles(db, A, "va");
    expect(t.config).toEqual({});
  });
});

describe("the same metric, more than once — the whole reason this table exists", () => {
  it("accepts one tile_key twice on one view, as different charts", async () => {
    /**
     * A placement cannot do this: `dashboard_placements_key_uq` is
     * `(org_id, view_id, tile_key)`. Here the primary key is the row's own id,
     * so "revenue as a number and as a trend, side by side" is representable —
     * and that is the entire point of the second table.
     */
    await db.insert(dashboardViews).values(view("v1", A));
    await db.insert(dashboardTiles).values([
      tile("t1", A, "v1", { tileKey: "flow:f1:o1", chart: "number" }),
      tile("t2", A, "v1", { tileKey: "flow:f1:o1", chart: "bar", y: 4 }),
      tile("t3", A, "v1", { tileKey: "flow:f1:o1", chart: "category", y: 10 }),
    ]);
    const rows = await listBoardTiles(db, A, "v1");
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.tileKey))).toEqual(new Set(["flow:f1:o1"]));
    expect(rows.map((r) => r.chart).sort()).toEqual(["bar", "category", "number"]);
  });
});

describe("what the schema guarantees, rather than what an action remembers", () => {
  it("refuses a tile that belongs to no view", async () => {
    // `view_id` is NOT NULL here and nullable on both neighbouring tables,
    // where NULL means the default view. The default view is always a groups
    // view and can hold none of these, so the state cannot exist.
    await expect(
      db.insert(dashboardTiles).values({ ...base, id: "x", orgId: A, viewId: null as unknown as string }),
    ).rejects.toThrow();
  });

  it("takes a view's tiles with it when the view is deleted", async () => {
    await seedBoth();
    await db.delete(dashboardViews).where(eq(dashboardViews.id, "va"));
    // The FOREIGN KEY's doing, not an action's. Two deletes could half-succeed;
    // one delete cannot.
    expect(await listBoardTiles(db, A, "va")).toEqual([]);
    expect(await listBoardTiles(db, B, "vb")).toHaveLength(1);
  });

  it("does not touch a tile when its METRIC goes away", async () => {
    await seedBoth();
    // There is deliberately no foreign key on `tile_key`: materializeFlow
    // deletes and recreates flow_results rows on every republish, so one would
    // let republishing a flow destroy a customer's layout. The tile dangles,
    // keeps its box, and the renderer says the metric is gone.
    const rows = await listBoardTiles(db, A, "va");
    expect(rows.every((r) => r.tileKey === "flow:f1:o1")).toBe(true);
  });
});

describe("the view's kind rides the read the page already does", () => {
  it("comes back on listBoardViews, so the page needs no second query", async () => {
    await db.insert(dashboardViews).values([view("v1", A, "custom"), view("v2", A, "groups")]);
    const rows = await listBoardViews(db, A);
    expect(new Map(rows.map((r) => [r.id, r.kind]))).toEqual(new Map([["v1", "custom"], ["v2", "groups"]]));
  });

  it("reads an unrecognised stored kind as the board every workspace already had", async () => {
    await db.insert(dashboardViews).values({ ...view("v1", A), kind: "gallery" });
    expect((await listBoardViews(db, A))[0].kind).toBe("groups");
  });
});

describe("the read stays inside its budget", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/board/tiles-store.ts"), "utf8");
  const store = readFileSync(join(process.cwd(), "src/lib/board/store.ts"), "utf8");

  it("is one narrow query, with no ordering and no joins", () => {
    expect(src.match(/\.select\(\{/g) ?? []).toHaveLength(1);
    expect(src).not.toMatch(/\.select\(\)/);
    // `compact` returns canonical reading order and has to run anyway; sorting
    // in SQL would be the same work done twice, in the place that costs egress.
    expect(src).not.toMatch(/orderBy/);
    expect(src).not.toMatch(/innerJoin|leftJoin|count\(/);
  });

  it("did not move into store.ts, whose budget comment counts three", () => {
    // That module's header describes three reads firing on every poll, and the
    // argument depends on the number. This one is conditional and mutually
    // exclusive with two of them, so it lives beside rather than in.
    //
    // Counted BEFORE `adoptDefaultView`, which added a fourth select to that
    // file that is not on the poll path at all — it runs inside the transaction
    // that renames the default board, once per workspace. Counting the whole
    // file would make this assertion drift every time a write is added there,
    // which is the opposite of what it guards.
    const pollReads = store.slice(0, store.indexOf("export async function adoptDefaultView"));
    expect(pollReads.match(/\.select\(\{/g) ?? []).toHaveLength(3);
  });
});
