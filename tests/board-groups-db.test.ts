import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestDb } from "./helpers/testdb";
import { dashboardGroups, dashboardTilePlacements } from "@/db/schema";
import { listBoardGroups, listTilePlacements } from "@/lib/board/store";
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
    const ga = await listBoardGroups(db, A);
    const gb = await listBoardGroups(db, B);
    expect(ga.map((g) => g.id).sort()).toEqual(["a1", "a2"]);
    expect(gb.map((g) => g.id)).toEqual(["b1"]);

    const byKey = (rows: Awaited<ReturnType<typeof listTilePlacements>>) =>
      Object.fromEntries(rows.map((p) => [p.tileKey, p.groupId]));
    // Both orgs placed the SAME tile key — the composite primary key is
    // (org_id, tile_key), so this is legal and each must see only its own.
    expect(byKey(await listTilePlacements(db, A))).toEqual({ "flow:f1:n1": "a1", "metric:m1": null });
    expect(byKey(await listTilePlacements(db, B))).toEqual({ "flow:f1:n1": "b1" });
  });

  it("returns an empty list for a workspace with no board, not another's", async () => {
    await seedBoth();
    expect(await listBoardGroups(db, "org_never_seen")).toEqual([]);
    expect(await listTilePlacements(db, "org_never_seen")).toEqual([]);
  });
});

describe("the board reads carry only what the board uses", () => {
  it("projects five group columns and three placement columns", async () => {
    await seedBoth();
    const [g] = await listBoardGroups(db, A);
    // `created_at` / `updated_at` / `org_id` are deliberately absent: nothing
    // on the board renders them, and this query runs every twelve seconds.
    expect(Object.keys(g).sort()).toEqual(["color", "id", "name", "pos", "sortKey"]);

    const [p] = await listTilePlacements(db, A);
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

  it("allows one placement per tile per org, and upserts rather than duplicating", async () => {
    await db.insert(dashboardGroups).values({ id: "g", orgId: A, name: "G", color: "grey", pos: "i" });
    await db.insert(dashboardTilePlacements).values({ orgId: A, tileKey: "flow:f:n", groupId: "g", pos: "i" });
    await expect(
      db.insert(dashboardTilePlacements).values({ orgId: A, tileKey: "flow:f:n", groupId: null, pos: "r" }),
    ).rejects.toThrow();

    // The path a drag actually takes: one statement, no read-modify-write.
    await db
      .insert(dashboardTilePlacements)
      .values({ orgId: A, tileKey: "flow:f:n", groupId: null, pos: "r" })
      .onConflictDoUpdate({
        target: [dashboardTilePlacements.orgId, dashboardTilePlacements.tileKey],
        set: { groupId: null, pos: "r" },
      });
    expect(await listTilePlacements(db, A)).toEqual([{ tileKey: "flow:f:n", groupId: null, pos: "r" }]);
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

    const after = await listTilePlacements(db, A);
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
    expect(await listTilePlacements(db, A)).toHaveLength(1);
  });
});

describe("a failed read is a load error, never an empty board", () => {
  it("rejects rather than resolving to []", async () => {
    // The `publishedFlowTiles` contract, extended: an empty array here would
    // render an ungrouped board over a customer's real arrangement and call
    // that their layout.
    await db.execute(sql`DROP TABLE ${dashboardGroups} CASCADE`);
    await expect(listBoardGroups(db, A)).rejects.toThrow();
  });
});
