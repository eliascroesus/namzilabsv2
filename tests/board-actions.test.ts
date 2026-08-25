import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { dashboardGroups, dashboardTilePlacements, rankAssignments, workspaceRanks } from "@/db/schema";
import { compareKeys } from "@/lib/board/order";
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
