import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { dashboardGroups, dashboardTilePlacements, dashboardViews } from "@/db/schema";
import { adoptDefaultView, listBoardGroups, listBoardViews, listTilePlacements } from "@/lib/board/store";
import type { DB } from "@/db/types";

/**
 * ADOPTING THE DEFAULT BOARD, AGAINST REAL SQL.
 *
 * This is the one change in this pass that moves a customer's STORED LAYOUT, so
 * it is driven against PGlite with the production migrations applied rather than
 * asserted from source. The failure modes it exists to catch are all silent:
 *
 *   · `= NULL` instead of `IS NULL` adopts nothing and reports success, which
 *     shows the customer an empty board under their own board's new name.
 *   · Adopting one org's rows while standing in another is the tenant bug every
 *     reader in this file's neighbour is written to catch.
 *   · A second adoption minting a second row leaves the strip showing the same
 *     board twice.
 *   · Re-pointing the groups but not the placements, or the reverse, leaves half
 *     an arrangement — which reads as a board somebody made badly rather than as
 *     a failure.
 *
 * TWO ORGS WITH IDENTICAL SHAPES, the adversarial-fixture discipline
 * `board-groups-db.test.ts` sets: a mutation that forgot its `where org_id`
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

/** The board every workspace starts with: groups and placements at `view_id IS NULL`. */
async function seedDefaultBoards() {
  await db.insert(dashboardGroups).values([
    { id: "a1", orgId: A, name: "Revenue", color: "green", pos: "i", sortKey: "manual" },
    { id: "a2", orgId: A, name: "Pipeline", color: "blue", pos: "r", sortKey: "manual" },
    { id: "b1", orgId: B, name: "Revenue", color: "green", pos: "i", sortKey: "manual" },
  ]);
  await db.insert(dashboardTilePlacements).values([
    { orgId: A, tileKey: "flow:f1:n1", groupId: "a1", pos: "i" },
    { orgId: A, tileKey: "metric:m1", groupId: null, pos: "r" },
    { orgId: B, tileKey: "flow:f1:n1", groupId: "b1", pos: "i" },
  ]);
}

describe("adopting the default view", () => {
  it("mints one row, flags it, and carries the whole board onto it", async () => {
    await seedDefaultBoards();
    const id = await adoptDefaultView(db, A, "Sales");

    const views = await listBoardViews(db, A);
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ id, name: "Sales", kind: "groups", isDefault: true });

    // The arrangement moved WHOLE: both groups and both placements.
    const groups = await listBoardGroups(db, A, id);
    expect(groups.map((g) => g.id).sort()).toEqual(["a1", "a2"]);
    const placements = await listTilePlacements(db, A, id);
    expect(placements.map((p) => p.tileKey).sort()).toEqual(["flow:f1:n1", "metric:m1"]);
    // …including the ungrouped one, whose `group_id` is null and which is easy
    // to lose to a predicate that conflates "no group" with "no view".
    expect(placements.find((p) => p.tileKey === "metric:m1")?.groupId).toBeNull();
  });

  it("leaves nothing behind at view_id IS NULL", async () => {
    await seedDefaultBoards();
    await adoptDefaultView(db, A, "Sales");
    // If this still returned rows, the board would be reachable by no tab at all
    // — the page stops rendering the null board once an org has adopted.
    expect(await listBoardGroups(db, A, null)).toEqual([]);
    expect(await listTilePlacements(db, A, null)).toEqual([]);
  });

  it("touches nothing belonging to another workspace", async () => {
    await seedDefaultBoards();
    await adoptDefaultView(db, A, "Sales");

    // B never adopted: its board is exactly where it was, and it has no view.
    expect(await listBoardViews(db, B)).toEqual([]);
    expect((await listBoardGroups(db, B, null)).map((g) => g.id)).toEqual(["b1"]);
    expect((await listTilePlacements(db, B, null)).map((p) => p.tileKey)).toEqual(["flow:f1:n1"]);
  });

  it("is idempotent — a second rename updates the row rather than minting another", async () => {
    await seedDefaultBoards();
    const first = await adoptDefaultView(db, A, "Sales");
    const second = await adoptDefaultView(db, A, "Revenue ops");

    expect(second).toBe(first);
    const views = await listBoardViews(db, A);
    expect(views).toHaveLength(1);
    expect(views[0].name).toBe("Revenue ops");
    // And the board did not move a second time, or get stranded by the update.
    expect((await listBoardGroups(db, A, first)).map((g) => g.id).sort()).toEqual(["a1", "a2"]);
  });

  it("refuses a second default row at the database level", async () => {
    await seedDefaultBoards();
    await adoptDefaultView(db, A, "Sales");
    // The partial unique index from migration 0029. Two tabs renaming at once
    // both read "no default yet"; the loser has to fail rather than leave the
    // strip showing one board under two names.
    await expect(
      db.insert(dashboardViews).values({
        id: "sneaky",
        orgId: A,
        name: "Also default",
        pos: "z",
        kind: "groups",
        isDefault: true,
      }),
    ).rejects.toThrow();
  });

  it("sorts the adopted board before every view the workspace already had", async () => {
    await seedDefaultBoards();
    await db.insert(dashboardViews).values([
      { id: "v1", orgId: A, name: "Ops", pos: "i", kind: "groups" },
      { id: "v2", orgId: A, name: "Team", pos: "r", kind: "custom" },
    ]);
    const id = await adoptDefaultView(db, A, "Sales");

    const order = (await listBoardViews(db, A)).sort((x, y) => (x.pos < y.pos ? -1 : x.pos > y.pos ? 1 : 0));
    // The synthetic tab it replaces was always leftmost; a rename that also
    // moved the tab would read as two changes for one action.
    expect(order.map((v) => v.id)).toEqual([id, "v1", "v2"]);
  });

  it("adopts an empty board without inventing rows for it", async () => {
    // A workspace that never made a group still has a default board, and
    // renaming it must work rather than throw on an empty update.
    const id = await adoptDefaultView(db, A, "Sales");
    expect((await listBoardViews(db, A))[0]).toMatchObject({ id, name: "Sales", isDefault: true });
    expect(await listBoardGroups(db, A, id)).toEqual([]);
  });

  it("does not flag a workspace's other views as default", async () => {
    await seedDefaultBoards();
    await adoptDefaultView(db, A, "Sales");
    await db.insert(dashboardViews).values({ id: "v1", orgId: A, name: "Ops", pos: "z", kind: "groups" });
    const rows = await db.select().from(dashboardViews).where(eq(dashboardViews.orgId, A));
    expect(rows.filter((r) => r.isDefault)).toHaveLength(1);
  });
});
