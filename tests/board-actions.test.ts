import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { dashboardGroups, dashboardTilePlacements, dashboardViews, rankAssignments, workspaceRanks } from "@/db/schema";
import { compareKeys, keyBetween } from "@/lib/board/order";
import type { DB } from "@/db/types";

/**
 * THE ARRANGEMENT ACTIONS, DRIVEN FOR REAL.
 *
 * The gate and the org wall are the two things worth testing here, and neither
 * can be checked by reading the code: a permission check that resolves to
 * allow-all by accident looks identical to one that works, and a query missing
 * its `where org_id` passes every single-tenant test ever written. So these run
 * the actual actions against a real Postgres with a real rank assigned.
 *
 * Same mocking shape as `org-caps.test.ts`: swap the DB handle and the session,
 * leave everything else alone.
 */

let db: DB;
let close: () => Promise<void>;
let ctx = { orgId: "org_a", userId: "user_1", role: "member" as string | undefined };

vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDb: () => db, getReadDb: () => db }));
vi.mock("@/lib/auth", () => ({ requireOrg: async () => ctx }));

const {
  createGroupAction,
  renameGroupAction,
  setGroupColorAction,
  deleteGroupAction,
  setTilePlacementsAction,
  setGroupPositionsAction,
  setGroupSortAction,
  setCalendarMetricAction,
  setViewPositionsAction,
} = await import("@/app/dashboard/board-actions");

const A = "org_a";
const B = "org_b";

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  ctx = { orgId: A, userId: "user_1", role: "member" };
});
afterEach(async () => {
  await close();
  vi.unstubAllEnvs();
});

const groupsOf = (orgId: string) =>
  db.select().from(dashboardGroups).where(eq(dashboardGroups.orgId, orgId));
const placementsOf = (orgId: string) =>
  db.select().from(dashboardTilePlacements).where(eq(dashboardTilePlacements.orgId, orgId));

/** Give the caller a rank that grants nothing, which is what turns the gate on. */
async function assignEmptyRank() {
  await db.insert(workspaceRanks).values({ id: "rank_viewer", orgId: A, name: "Viewer", allMetrics: true });
  await db.insert(rankAssignments).values({ orgId: A, userId: "user_1", rankId: "rank_viewer" });
}

describe("creating a group", () => {
  it("appends to the end of the row, uncoloured, in manual order", async () => {
    const first = await createGroupAction("Revenue");
    const second = await createGroupAction("Pipeline");
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    // A new column arrives at the END, where one is looked for.
    expect(compareKeys(first.group.pos, second.group.pos)).toBeLessThan(0);
    // Grey, not a colour chosen at the moment there is nothing to decide about.
    expect(first.group.color).toBe("grey");
    expect(first.group.sortKey).toBe("manual");
    expect((await groupsOf(A)).map((g) => g.name).sort()).toEqual(["Pipeline", "Revenue"]);
  });

  it("refuses a blank name and a name past the limit", async () => {
    expect(await createGroupAction("   ")).toEqual({ ok: false, error: "A group needs a name." });
    expect(await createGroupAction("x".repeat(61))).toMatchObject({ ok: false });
    expect(await groupsOf(A)).toHaveLength(0);
  });

  it("stops at the cap rather than minting rows forever", async () => {
    vi.stubEnv("MAX_BOARD_GROUPS_PER_ORG", "2");
    expect((await createGroupAction("one")).ok).toBe(true);
    expect((await createGroupAction("two")).ok).toBe(true);
    const third = await createGroupAction("three");
    expect(third.ok).toBe(false);
    expect(third.ok === false && third.error).toMatch(/limit of 2 groups/);
  });
});

describe("the org wall", () => {
  it("will not rename, recolour or delete another workspace's group", async () => {
    await db.insert(dashboardGroups).values({ id: "theirs", orgId: B, name: "Theirs", color: "grey", pos: "i" });

    // Each returns ok — there is nothing to report — and each must touch
    // nothing. A 403 here would confirm the id exists, which is its own leak.
    expect((await renameGroupAction("theirs", "Mine now")).ok).toBe(true);
    expect((await setGroupColorAction("theirs", "red")).ok).toBe(true);
    expect((await deleteGroupAction("theirs")).ok).toBe(true);

    const [theirs] = await groupsOf(B);
    expect(theirs, "another workspace's group was deleted").toBeDefined();
    expect(theirs.name).toBe("Theirs");
    expect(theirs.color).toBe("grey");
  });

  it("will not file a tile into another workspace's column", async () => {
    await db.insert(dashboardGroups).values({ id: "theirs", orgId: B, name: "Theirs", color: "grey", pos: "i" });
    const r = await setTilePlacementsAction([{ tileKey: "flow:f1:n1", groupId: "theirs", pos: "i" }]);
    expect(r).toEqual({ ok: false, error: "Unknown group." });
    expect(await placementsOf(A)).toHaveLength(0);
  });
});

describe("the permission gate", () => {
  it("refuses every arrangement write from a member whose rank lacks create_flows", async () => {
    const mine = await createGroupAction("Mine");
    expect(mine.ok).toBe(true);
    if (!mine.ok) return;

    await assignEmptyRank();

    // Reading is not editing — the board still renders for this member — but
    // every write is refused, at the door rather than in the UI.
    for (const r of [
      await createGroupAction("Nope"),
      await renameGroupAction(mine.group.id, "Nope"),
      await setGroupColorAction(mine.group.id, "red"),
      await deleteGroupAction(mine.group.id),
      await setTilePlacementsAction([{ tileKey: "flow:f1:n1", groupId: null, pos: "i" }]),
    ]) {
      expect(r).toEqual({ ok: false, error: "Your role doesn't allow changing the dashboard layout." });
    }
    expect(await groupsOf(A)).toHaveLength(1);
    expect(await placementsOf(A)).toHaveLength(0);
  });

  it("lets an admin through even when a rank is assigned to them", async () => {
    await assignEmptyRank();
    ctx = { orgId: A, userId: "user_1", role: "admin" };
    expect((await createGroupAction("Admin's")).ok).toBe(true);
  });
});

describe("placing tiles", () => {
  it("upserts in one statement and moves rather than duplicating", async () => {
    const g = await createGroupAction("G");
    if (!g.ok) throw new Error("setup");
    await setTilePlacementsAction([
      { tileKey: "flow:f1:n1", groupId: g.group.id, pos: "i" },
      { tileKey: "metric:m1", groupId: null, pos: "r" },
    ]);
    expect(await placementsOf(A)).toHaveLength(2);

    // The same tile again: it MOVES. Two rows for one tile would be two answers
    // to "where is this", which the composite primary key exists to prevent.
    await setTilePlacementsAction([{ tileKey: "flow:f1:n1", groupId: null, pos: "z" }]);
    const rows = await placementsOf(A);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.tileKey === "flow:f1:n1")).toMatchObject({ groupId: null, pos: "z" });
  });

  it("rejects a position key that would order differently in Postgres than in JS", async () => {
    // Uppercase is the collation hazard; a trailing minimum digit is the
    // two-strings-one-position hazard. Both are refused at the door.
    expect(await setTilePlacementsAction([{ tileKey: "metric:m1", groupId: null, pos: "aA" }])).toMatchObject({ ok: false });
    expect(await setTilePlacementsAction([{ tileKey: "metric:m1", groupId: null, pos: "a0" }])).toMatchObject({ ok: false });
    expect(await placementsOf(A)).toHaveLength(0);
  });

  it("rejects a tile key that is neither a flow tile nor a metric", async () => {
    expect(await setTilePlacementsAction([{ tileKey: "flow:f1", groupId: null, pos: "i" }])).toMatchObject({ ok: false });
    expect(await setTilePlacementsAction([{ tileKey: "nonsense", groupId: null, pos: "i" }])).toMatchObject({ ok: false });
  });

  it("stops at the placement cap", async () => {
    vi.stubEnv("MAX_BOARD_PLACEMENTS_PER_ORG", "2");
    expect(
      (await setTilePlacementsAction([
        { tileKey: "metric:a", groupId: null, pos: "i" },
        { tileKey: "metric:b", groupId: null, pos: "r" },
      ])).ok,
    ).toBe(true);
    expect(await setTilePlacementsAction([{ tileKey: "metric:c", groupId: null, pos: "z" }])).toMatchObject({ ok: false });
  });
});

describe("deleting a group", () => {
  it("re-homes its metrics to the END of the ungrouped row, in order", async () => {
    /**
     * The behaviour the confirmation sentence promises. Order survives so the
     * group's contents stay a run rather than scattering, and they land at the
     * end rather than jumping to the front of a row they were never in.
     */
    const g = await createGroupAction("Doomed");
    if (!g.ok) throw new Error("setup");
    await setTilePlacementsAction([
      { tileKey: "metric:already", groupId: null, pos: "i" },
      { tileKey: "metric:first", groupId: g.group.id, pos: "a" },
      { tileKey: "metric:second", groupId: g.group.id, pos: "m" },
    ]);

    const r = await deleteGroupAction(g.group.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The server says what keys it wrote, so the client cannot compute a
    // second, differing answer.
    expect(r.moved.map((m) => m.tileKey)).toEqual(["metric:first", "metric:second"]);

    const rows = (await placementsOf(A)).sort((a, b) => compareKeys(a.pos, b.pos));
    expect(rows.every((p) => p.groupId === null)).toBe(true);
    expect(rows.map((p) => p.tileKey)).toEqual(["metric:already", "metric:first", "metric:second"]);
    expect(await groupsOf(A)).toHaveLength(0);
  });

  it("never deletes a metric's placement, only its column", async () => {
    const g = await createGroupAction("G");
    if (!g.ok) throw new Error("setup");
    await setTilePlacementsAction([{ tileKey: "flow:f1:n1", groupId: g.group.id, pos: "i" }]);
    await deleteGroupAction(g.group.id);
    // A layout act never destroys a metric, and never forgets one either.
    expect(await placementsOf(A)).toHaveLength(1);
  });
});

describe("ordering the columns", () => {
  it("moves one column without renumbering the others", async () => {
    const a = await createGroupAction("A");
    const b = await createGroupAction("B");
    const c = await createGroupAction("C");
    if (!a.ok || !b.ok || !c.ok) throw new Error("setup");

    // The whole reason for fractional keys: putting A last is ONE row, and B
    // and C keep the keys they already had.
    const after = await setGroupPositionsAction([{ id: a.group.id, pos: "zz" }]);
    expect(after.ok).toBe(true);
    const rows = await groupsOf(A);
    expect(rows.find((r) => r.id === b.group.id)!.pos).toBe(b.group.pos);
    expect(rows.find((r) => r.id === c.group.id)!.pos).toBe(c.group.pos);
    expect(rows.slice().sort((x, y) => compareKeys(x.pos, y.pos)).map((r) => r.name)).toEqual(["B", "C", "A"]);
  });

  it("will not CREATE a column for an id this workspace does not own", async () => {
    /**
     * The reason this is an UPDATE per row rather than an upsert: an upsert
     * keyed on `id` would happily insert a group for an id posted from a
     * browser, and the org filter on each update is what makes that impossible
     * rather than merely unlikely.
     */
    const r = await setGroupPositionsAction([{ id: "not-ours", pos: "i" }]);
    expect(r.ok).toBe(true);
    expect(await groupsOf(A)).toHaveLength(0);
    expect(await groupsOf(B)).toHaveLength(0);
  });
});

describe("how a column sorts itself", () => {
  it("stores the sort and never touches the tiles' own keys", async () => {
    /**
     * The proof that an auto-sort is a VIEW. If it were applied by re-keying,
     * switching back to Manual would leave whatever the sort last decided and
     * there would be no way back to the hand-made arrangement.
     */
    const g = await createGroupAction("G");
    if (!g.ok) throw new Error("setup");
    await setTilePlacementsAction([
      { tileKey: "metric:c", groupId: g.group.id, pos: "a" },
      { tileKey: "metric:a", groupId: g.group.id, pos: "m" },
    ]);
    const before = await placementsOf(A);

    expect((await setGroupSortAction(g.group.id, "name_asc")).ok).toBe(true);
    expect((await groupsOf(A))[0].sortKey).toBe("name_asc");
    expect(await placementsOf(A)).toEqual(before);

    expect((await setGroupSortAction(g.group.id, "manual")).ok).toBe(true);
    expect(await placementsOf(A)).toEqual(before);
  });

  it("refuses a sort that is not one of ours", async () => {
    const g = await createGroupAction("G");
    if (!g.ok) throw new Error("setup");
    expect(await setGroupSortAction(g.group.id, "by_vibes")).toEqual({ ok: false, error: "That sort isn't one of ours." });
    expect((await groupsOf(A))[0].sortKey).toBe("manual");
  });
});

/**
 * A CALENDAR POINTED AT THE METRIC IT IS ALREADY SHOWING.
 *
 * `setCalendarMetricAction` is a data-modifying CTE — a DELETE of the view's
 * placements and an INSERT of the new one, as one statement, because the
 * deployed `neon-http` driver has no transactions (see `newViewCte`).
 *
 * The two halves of such a CTE run against the SAME SNAPSHOT, so the INSERT
 * cannot see what the DELETE removed. Re-selecting the CURRENT metric therefore
 * deleted the row and immediately re-inserted it against a snapshot in which it
 * still existed, and `dashboard_placements_key_uq` fired: the customer got a raw
 * "Failed query: with cleared as ( delete from …" across the top of their board.
 *
 * Switching to a DIFFERENT metric was always fine, which is exactly why this
 * survived — the broken path is the one that looks like it should do nothing.
 * Reproduced against real Postgres before the fix, which is `ON CONFLICT DO
 * UPDATE`. All three assertions below fail without it.
 */
describe("pointing a calendar at a metric", () => {
  const view = async (id: string) =>
    db.insert(dashboardViews).values({ id, orgId: A, name: "Cal", pos: "a0", kind: "calendar" });
  const pick = (id: string, tileKey: string) => {
    const fd = new FormData();
    fd.set("tileKey", tileKey);
    return setCalendarMetricAction(id, fd);
  };
  const keys = async () =>
    (await db.select().from(dashboardTilePlacements)).map((r) => r.tileKey).sort();

  it("switches from one metric to another, keeping exactly one placement", async () => {
    await view("v1");
    expect(await pick("v1", "flow:f1:n1")).toEqual({ ok: true });
    expect(await pick("v1", "flow:f2:n2")).toEqual({ ok: true });
    expect(await keys()).toEqual(["flow:f2:n2"]);
  });

  it("survives being pointed at the metric it already shows", async () => {
    await view("v1");
    await pick("v1", "flow:f1:n1");
    // THE REGRESSION. This returned `{ ok: false }` carrying a duplicate-key
    // error, and the board rendered the SQL.
    expect(await pick("v1", "flow:f1:n1")).toEqual({ ok: true });
    expect(await keys()).toEqual(["flow:f1:n1"]);
  });

  it("still refuses a view that is not a calendar, and one in another org", async () => {
    await db.insert(dashboardViews).values({ id: "v2", orgId: A, name: "Board", pos: "a0", kind: "columns" });
    await db.insert(dashboardViews).values({ id: "v3", orgId: B, name: "Cal", pos: "a0", kind: "calendar" });
    await pick("v2", "flow:f1:n1");
    await pick("v3", "flow:f1:n1");
    expect(await keys()).toEqual([]);
  });
});

/**
 * THE ORDER OF THE VIEWS, AND THE TWO SURFACES IT DRIVES.
 *
 * A reorder writes exactly one row: `keyBetween` mints a key between the moved
 * view's two NEW neighbours, so the others keep the keys they had and two
 * people dragging different views cannot overwrite each other. That is the
 * whole reason `pos` is a fractional string rather than an integer.
 *
 * The tab strip and the rail's nested list under Dashboard both render
 * `viewStrip(views)`, which sorts on this column — so ordering the strip orders
 * the rail, and neither surface knows the other exists.
 */
describe("ordering the views", () => {
  const seed = () =>
    db.insert(dashboardViews).values([
      { id: "v1", orgId: A, name: "A", pos: "a1", kind: "custom" },
      { id: "v2", orgId: A, name: "B", pos: "a2", kind: "custom" },
      { id: "v3", orgId: A, name: "C", pos: "a3", kind: "custom" },
      { id: "x1", orgId: B, name: "Other", pos: "a1", kind: "custom" },
    ]);
  const order = async (org = A) =>
    (await db.select().from(dashboardViews))
      .filter((v) => v.orgId === org)
      .sort((a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : 0))
      .map((v) => v.name);

  it("moves one view and leaves its neighbours' keys alone", async () => {
    await seed();
    const before = (await db.select().from(dashboardViews)).filter((v) => v.id === "v2")[0].pos;
    // `keyBetween` rather than a literal: `posSchema` is lowercase-only and
    // rejects a trailing zero, so a hand-typed key is how this test would pass
    // while the action refused the real thing.
    expect(await setViewPositionsAction([{ id: "v1", pos: keyBetween("a3", null) }])).toEqual({ ok: true });
    expect(await order()).toEqual(["B", "C", "A"]);
    expect((await db.select().from(dashboardViews)).filter((v) => v.id === "v2")[0].pos).toBe(before);
  });

  it("cannot touch another workspace's view", async () => {
    await seed();
    // An UPDATE per row with an org filter, so an id this workspace does not own
    // is not merely unlikely to be written — it cannot be.
    await setViewPositionsAction([{ id: "x1", pos: keyBetween("a3", null) }]);
    expect((await db.select().from(dashboardViews)).find((v) => v.id === "x1")!.pos).toBe("a1");
  });

  it("refuses a rank that cannot arrange the board", async () => {
    await seed();
    await assignEmptyRank();
    const r = await setViewPositionsAction([{ id: "v1", pos: keyBetween("a3", null) }]);
    expect(r.ok).toBe(false);
    expect(await order()).toEqual(["A", "B", "C"]);
  });

  it("rejects a malformed key without writing anything", async () => {
    await seed();
    // Uppercase is outside `posSchema`, and a key ending in the first digit is
    // the one shape `keyBetween` can never mint — both mean somebody hand-built
    // this, and neither may reach the table.
    expect((await setViewPositionsAction([{ id: "v1", pos: "Zz" }])).ok).toBe(false);
    expect((await setViewPositionsAction([{ id: "v1", pos: "a0" }])).ok).toBe(false);
    expect(await order()).toEqual(["A", "B", "C"]);
  });
});
