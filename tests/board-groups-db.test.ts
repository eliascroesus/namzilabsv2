import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestDb } from "./helpers/testdb";
import { dashboardGroups, dashboardTilePlacements, dashboardViews } from "@/db/schema";
import { forgetTilePlacements, listBoardGroups, listBoardViews, listTilePlacements } from "@/lib/board/store";
import type { DB } from "@/db/types";

/**
 * THE BOARD'S READS, AGAINST REAL SQL.
 *
 * Two orgs with IDENTICAL shapes in both, which is the adversarial-fixture
 * discipline `tenant-isolation.test.ts` sets: a reader that forgot its
 * `where org_id` passes every single-tenant test ever written.
 *
 * The projection assertions are the `dashboard-tiles.test.ts` rule applied to
 * new queries — these run on every twelve-second freshness poll in every open
 * tab, so a wide column added to either table later must not silently ride
 * along on the hottest page in the product.
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

async function seedBoth() {
  await db.insert(dashboardGroups).values([
    { id: "a1", orgId: A, name: "Revenue", color: "green", pos: "i", sortKey: "manual" },
    { id: "a2", orgId: A, name: "Pipeline", color: "blue", pos: "r", sortKey: "name_asc" },
    { id: "b1", orgId: B, name: "Revenue", color: "green", pos: "i", sortKey: "manual" },
  ]);
  await db.insert(dashboardTilePlacements).values([
    { orgId: A, tileKey: "flow:f1:n1", groupId: "a1", pos: "i" },
    { orgId: A, tileKey: "metric:m1", groupId: null, pos: "r" },
    { orgId: B, tileKey: "flow:f1:n1", groupId: "b1", pos: "i" },
  ]);
}

describe("the board reads are org-scoped", () => {
  it("shows one workspace nothing of another's, for identical rows", async () => {
    await seedBoth();
    const ga = await listBoardGroups(db, A, null);
    const gb = await listBoardGroups(db, B, null);
    expect(ga.map((g) => g.id).sort()).toEqual(["a1", "a2"]);
    expect(gb.map((g) => g.id)).toEqual(["b1"]);

    const byKey = (rows: Awaited<ReturnType<typeof listTilePlacements>>) =>
      Object.fromEntries(rows.map((p) => [p.tileKey, p.groupId]));
    // Both orgs placed the SAME tile key — the composite primary key is
    // (org_id, tile_key), so this is legal and each must see only its own.
    expect(byKey(await listTilePlacements(db, A, null))).toEqual({ "flow:f1:n1": "a1", "metric:m1": null });
    expect(byKey(await listTilePlacements(db, B, null))).toEqual({ "flow:f1:n1": "b1" });
  });

  it("returns an empty list for a workspace with no board, not another's", async () => {
    await seedBoth();
    expect(await listBoardGroups(db, "org_never_seen", null)).toEqual([]);
    expect(await listTilePlacements(db, "org_never_seen", null)).toEqual([]);
  });
});

describe("the board reads carry only what the board uses", () => {
  it("projects five group columns and three placement columns", async () => {
    await seedBoth();
    const [g] = await listBoardGroups(db, A, null);
    // `created_at` / `updated_at` / `org_id` are deliberately absent: nothing
    // on the board renders them, and this query runs every twelve seconds.
    expect(Object.keys(g).sort()).toEqual(["color", "id", "name", "pos", "sortKey"]);

    const [p] = await listTilePlacements(db, A, null);
    expect(Object.keys(p).sort()).toEqual(["groupId", "pos", "tileKey"]);
  });

  it("does not order in SQL — the collation would disagree with the client", async () => {
    /**
     * The whole point of sorting these keys in JS. `arrangeBoard` compares them
     * as bytes; an `ORDER BY pos` under a non-C collation would produce a
     * different answer for the same rows, and the board would order itself one
     * way on the server and another in the browser.
     *
     * Asserted against the source because the failure is a query AGREEING with
     * the client today and diverging the day someone widens the alphabet.
     */
    const store = readFileSync(join(process.cwd(), "src/lib/board/store.ts"), "utf8");
    expect(store).not.toMatch(/orderBy/);
  });
});

describe("the schema's own guarantees", () => {
  it("keeps `pos` collated C, so Postgres and JS cannot disagree", async () => {
    // Belt to the alphabet's braces. Pinned against the MIGRATION rather than
    // the live column, because PGlite may default to C anyway and a behavioural
    // check would pass locally while proving nothing about Neon.
    const migration = readFileSync(join(process.cwd(), "drizzle/0026_dashboard_groups.sql"), "utf8");
    expect(migration.match(/"pos" text COLLATE "C" NOT NULL/g)).toHaveLength(2);
  });

  it("allows one placement per tile per org and VIEW, and upserts rather than duplicating", async () => {
    await db.insert(dashboardGroups).values({ id: "g", orgId: A, name: "G", color: "grey", pos: "i" });
    await db.insert(dashboardTilePlacements).values({ orgId: A, tileKey: "flow:f:n", groupId: "g", pos: "i" });
    await expect(
      db.insert(dashboardTilePlacements).values({ orgId: A, tileKey: "flow:f:n", groupId: null, pos: "r" }),
    ).rejects.toThrow();

    // The path a drag actually takes: one statement, no read-modify-write. The
    // conflict target is the (org, VIEW, tile) index — the view is part of the
    // key now, and naming the old pair errors rather than silently inserting a
    // duplicate, which is how this test caught the swap.
    await db
      .insert(dashboardTilePlacements)
      .values({ orgId: A, tileKey: "flow:f:n", groupId: null, pos: "r" })
      .onConflictDoUpdate({
        target: [dashboardTilePlacements.orgId, dashboardTilePlacements.viewId, dashboardTilePlacements.tileKey],
        set: { groupId: null, pos: "r" },
      });
    expect(await listTilePlacements(db, A, null)).toEqual([{ tileKey: "flow:f:n", groupId: null, pos: "r" }]);
  });

  it("returns a group's tiles to Ungrouped when the group row is deleted", async () => {
    /**
     * ON DELETE SET NULL, doing the job an action should not have to be trusted
     * with. Even if the delete path forgot to re-home the tiles, they land in
     * the ungrouped row rather than pointing at a group that is gone — and a
     * metric is never removed by a layout act.
     */
    await db.insert(dashboardGroups).values({ id: "g", orgId: A, name: "G", color: "grey", pos: "i" });
    await db.insert(dashboardTilePlacements).values([
      { orgId: A, tileKey: "flow:f:n1", groupId: "g", pos: "i" },
      { orgId: A, tileKey: "flow:f:n2", groupId: "g", pos: "r" },
    ]);
    await db.delete(dashboardGroups).where(sql`id = 'g'`);

    const after = await listTilePlacements(db, A, null);
    expect(after).toHaveLength(2);
    expect(after.every((p) => p.groupId === null)).toBe(true);
  });

  it("keeps a placement whose tile is gone, because republishing brings it back", async () => {
    /**
     * Stated as a test so nobody "tidies" it away. `tile_key` has no foreign
     * key and cannot have one: materializeFlow deletes the flow_results row of
     * an Output that left the published set, so a reference would make
     * republishing a flow destroy the customer's layout. The placement outlives
     * its tile ON PURPOSE, and `arrangeBoard` drops it from the render.
     */
    await db.insert(dashboardGroups).values({ id: "g", orgId: A, name: "G", color: "grey", pos: "i" });
    await db.insert(dashboardTilePlacements).values({ orgId: A, tileKey: "flow:gone:n1", groupId: "g", pos: "i" });
    // Nothing in the schema references flow_results from here, so there is no
    // cascade to fire and the row simply stays.
    expect(await listTilePlacements(db, A, null)).toHaveLength(1);
  });
});

describe("a failed read is a load error, never an empty board", () => {
  it("rejects rather than resolving to []", async () => {
    // The `publishedFlowTiles` contract, extended: an empty array here would
    // render an ungrouped board over a customer's real arrangement and call
    // that their layout.
    await db.execute(sql`DROP TABLE ${dashboardGroups} CASCADE`);
    await expect(listBoardGroups(db, A, null)).rejects.toThrow();
  });
});

describe("forgetting a deleted metric's place", () => {
  it("clears one flow's tiles and leaves another flow's alone", async () => {
    /**
     * THE ONLY CLEANUP PATH. One flow can publish several tiles, so the prefix
     * has to sweep them all — and the trailing colon is what stops deleting
     * flow "ab" from also forgetting flow "abc", which is the kind of bug that
     * only shows up once a workspace has enough flows for the ids to collide.
     */
    await db.insert(dashboardTilePlacements).values([
      { orgId: A, tileKey: "flow:ab:n1", groupId: null, pos: "i" },
      { orgId: A, tileKey: "flow:ab:n2", groupId: null, pos: "j" },
      { orgId: A, tileKey: "flow:abc:n1", groupId: null, pos: "k" },
      { orgId: A, tileKey: "metric:m1", groupId: null, pos: "m" },
      { orgId: B, tileKey: "flow:ab:n1", groupId: null, pos: "i" },
    ]);

    await forgetTilePlacements(db, A, "flow:ab:");
    expect((await listTilePlacements(db, A, null)).map((p) => p.tileKey).sort()).toEqual(["flow:abc:n1", "metric:m1"]);
    // And never another workspace's, even for the identical key.
    expect(await listTilePlacements(db, B, null)).toHaveLength(1);
  });

  it("clears a classic metric by its own key", async () => {
    await db.insert(dashboardTilePlacements).values([
      { orgId: A, tileKey: "metric:m1", groupId: null, pos: "i" },
      { orgId: A, tileKey: "metric:m2", groupId: null, pos: "j" },
    ]);
    await forgetTilePlacements(db, A, "metric:m1");
    expect((await listTilePlacements(db, A, null)).map((p) => p.tileKey)).toEqual(["metric:m2"]);
  });

  it("does not treat a wildcard in the key as a wildcard", async () => {
    // The pattern is BOUND as a parameter, so a flow id carrying a % cannot
    // widen the match into everything the workspace has.
    await db.insert(dashboardTilePlacements).values([
      { orgId: A, tileKey: "metric:keepme", groupId: null, pos: "i" },
    ]);
    await forgetTilePlacements(db, A, "metric:%");
    expect(await listTilePlacements(db, A, null)).toHaveLength(1);
  });
});

describe("views", () => {
  it("keeps each view's arrangement to itself", async () => {
    /**
     * The whole point of a view: the same metrics, arranged differently. A tile
     * holds a placement in EACH view, which is why the view is part of the key.
     */
    await db.insert(dashboardViews).values({ id: "v2", orgId: A, name: "Ops", pos: "i" });
    await db.insert(dashboardGroups).values([
      { id: "gd", orgId: A, name: "Default column", color: "grey", pos: "i" },
      { id: "g2", orgId: A, name: "Ops column", color: "blue", pos: "i", viewId: "v2" },
    ]);
    await db.insert(dashboardTilePlacements).values([
      { orgId: A, tileKey: "metric:m1", groupId: "gd", pos: "i" },
      { orgId: A, tileKey: "metric:m1", groupId: "g2", pos: "z", viewId: "v2" },
    ]);

    // NULL is the default view, and it is asked for with IS NULL — `= NULL` is
    // never true and would hand back an empty board.
    expect((await listBoardGroups(db, A, null)).map((g) => g.id)).toEqual(["gd"]);
    expect((await listBoardGroups(db, A, "v2")).map((g) => g.id)).toEqual(["g2"]);
    expect(await listTilePlacements(db, A, null)).toEqual([{ tileKey: "metric:m1", groupId: "gd", pos: "i" }]);
    expect(await listTilePlacements(db, A, "v2")).toEqual([{ tileKey: "metric:m1", groupId: "g2", pos: "z" }]);
  });

  it("refuses a second placement for one tile in the SAME view", async () => {
    /**
     * NULLS NOT DISTINCT, which the schema declaration cannot express and the
     * migration has to. Without it Postgres treats two NULL view_ids as
     * different, so a tile could hold two placements in the default view and
     * both would be stored — the board would then show it twice, or once,
     * depending on row order.
     */
    await db.insert(dashboardTilePlacements).values({ orgId: A, tileKey: "metric:m1", groupId: null, pos: "i" });
    await expect(
      db.insert(dashboardTilePlacements).values({ orgId: A, tileKey: "metric:m1", groupId: null, pos: "z" }),
    ).rejects.toThrow();
    expect(await listTilePlacements(db, A, null)).toHaveLength(1);
  });

  it("takes a view's columns and positions with it when the view is deleted", async () => {
    // ON DELETE CASCADE on both, so a deleted tab cannot leave rows nothing can
    // ever read again — the default view is NULL and is never a target here.
    await db.insert(dashboardViews).values({ id: "v2", orgId: A, name: "Ops", pos: "i" });
    await db.insert(dashboardGroups).values({ id: "g2", orgId: A, name: "Ops", color: "blue", pos: "i", viewId: "v2" });
    await db.insert(dashboardTilePlacements).values([
      { orgId: A, tileKey: "metric:keep", groupId: null, pos: "i" },
      { orgId: A, tileKey: "metric:go", groupId: "g2", pos: "i", viewId: "v2" },
    ]);
    await db.delete(dashboardViews).where(sql`id = 'v2'`);

    expect(await listBoardGroups(db, A, "v2")).toEqual([]);
    expect((await listTilePlacements(db, A, null)).map((p) => p.tileKey)).toEqual(["metric:keep"]);
  });

  it("lists only its own workspace's views", async () => {
    await db.insert(dashboardViews).values([
      { id: "a1", orgId: A, name: "Ops", pos: "i" },
      { id: "b1", orgId: B, name: "Theirs", pos: "i" },
    ]);
    expect((await listBoardViews(db, A)).map((v) => v.name)).toEqual(["Ops"]);
    expect((await listBoardViews(db, B)).map((v) => v.name)).toEqual(["Theirs"]);
  });
});
