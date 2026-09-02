import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { dashboardGroups, dashboardTilePlacements, dashboardViews, metrics, rankAssignments, workspaceRanks } from "@/db/schema";
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

/**
 * `addViewAction` always ends in `redirect()`, which throws `NEXT_REDIRECT`
 * in real Next rather than returning — the same shape `dlq.test.ts` and
 * `auth-routes.test.ts` already mock for a redirect-throwing server action.
 * Recording the URL and rethrowing lets a test drive the action for real and
 * then read back what it actually wrote, rather than only what its source
 * text mentions.
 */
const hoistedRedirect = vi.hoisted(() => ({ url: null as unknown }));
vi.mock("next/navigation", () => ({
  redirect: (u: unknown) => {
    hoistedRedirect.url = u;
    throw new Error("NEXT_REDIRECT");
  },
}));

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
  addViewAction,
} = await import("@/app/dashboard/board-actions");

const A = "org_a";
const B = "org_b";

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  ctx = { orgId: A, userId: "user_1", role: "member" };
  hoistedRedirect.url = null;
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

/**
 * A real `metrics` row, so a `metric:<id>` key names something that actually
 * exists — `metrics.id` is a uuid column, so a hand-typed `"metric:m1"` can
 * never be a legal row id, only ever a stand-in for one.
 */
async function metricRow(orgId: string): Promise<string> {
  const [row] = await db
    .insert(metrics)
    .values({ orgId, name: "M", kind: "aggregate", definition: {} })
    .returning({ id: metrics.id });
  return row.id;
}

/**
 * A rank that CAN arrange the board (`create_flows`) but sees only the named
 * flow/metric visibility keys — the shape C20 closes a hole in. Before the
 * fix, every write below took a tile key from the browser and never once
 * asked `canSeeMetric` about it.
 */
async function assignBuilderRank(metricKeys: string[]) {
  await db.insert(workspaceRanks).values({
    id: "rank_builder",
    orgId: A,
    name: "Builder",
    permissions: ["create_flows"],
    allMetrics: false,
    metricKeys,
  });
  await db.insert(rankAssignments).values({ orgId: A, userId: "user_1", rankId: "rank_builder" });
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
    const m1 = await metricRow(A);
    await setTilePlacementsAction([
      { tileKey: "flow:f1:n1", groupId: g.group.id, pos: "i" },
      { tileKey: `metric:${m1}`, groupId: null, pos: "r" },
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
    // two-strings-one-position hazard. Both are refused at the door, before the
    // tile key is ever looked up — so a fake metric id here is fine.
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
    const a = await metricRow(A);
    const b = await metricRow(A);
    const c = await metricRow(A);
    expect(
      (await setTilePlacementsAction([
        { tileKey: `metric:${a}`, groupId: null, pos: "i" },
        { tileKey: `metric:${b}`, groupId: null, pos: "r" },
      ])).ok,
    ).toBe(true);
    expect(await setTilePlacementsAction([{ tileKey: `metric:${c}`, groupId: null, pos: "z" }])).toMatchObject({ ok: false });
  });
});

/**
 * C20, THE METRIC HALF: a `metric:<id>` key is only ever checked against the
 * key's own SHAPE (`tileKeySchema`'s regex), never against the org's actual
 * `metrics` table — so a made-up id, a deleted one, or another workspace's
 * saved fine and sat there matching nothing forever, and a hand-typed
 * non-uuid string reached `inArray(metrics.id, …)` and threw a raw Postgres
 * error straight into the toast.
 */
describe("every metric a tile names must actually exist", () => {
  it("refuses an id missing from this org, one from another org, and one that isn't a uuid — none of them a raw database error", async () => {
    const theirs = await metricRow(B);
    for (const key of [`metric:${crypto.randomUUID()}`, `metric:${theirs}`, "metric:not-a-uuid"]) {
      expect(await setTilePlacementsAction([{ tileKey: key, groupId: null, pos: "i" }])).toEqual({
        ok: false,
        error: "That isn't a metric we know.",
      });
    }
    expect(await placementsOf(A)).toHaveLength(0);
  });

  it("accepts the org's own metric", async () => {
    const mine = await metricRow(A);
    expect(await setTilePlacementsAction([{ tileKey: `metric:${mine}`, groupId: null, pos: "i" }])).toEqual({ ok: true });
    expect(await placementsOf(A)).toHaveLength(1);
  });
});

/**
 * C20, THE FLOW HALF: a `flow:<flowId>:<nodeId>` key was never checked
 * against `canSeeMetric` here at all, so a rank scoped to a handful of
 * metrics could still file a placement for any flow in the workspace —
 * readable the moment a teammate with fuller access opened the same board.
 */
describe("what a restricted rank may place", () => {
  it("refuses a flow tile outside the rank's metricKeys, with the message that also covers a deleted one", async () => {
    await assignBuilderRank(["flow:f1"]);
    expect(await setTilePlacementsAction([{ tileKey: "flow:f2:n1", groupId: null, pos: "i" }])).toEqual({
      ok: false,
      error: "That isn't a metric we know.",
    });
    expect(await placementsOf(A)).toHaveLength(0);
  });

  it("allows a flow tile the rank's metricKeys does name", async () => {
    await assignBuilderRank(["flow:f1"]);
    expect(await setTilePlacementsAction([{ tileKey: "flow:f1:n1", groupId: null, pos: "i" }])).toEqual({ ok: true });
    expect(await placementsOf(A)).toHaveLength(1);
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
    const already = `metric:${await metricRow(A)}`;
    const first = `metric:${await metricRow(A)}`;
    const second = `metric:${await metricRow(A)}`;
    await setTilePlacementsAction([
      { tileKey: already, groupId: null, pos: "i" },
      { tileKey: first, groupId: g.group.id, pos: "a" },
      { tileKey: second, groupId: g.group.id, pos: "m" },
    ]);

    const r = await deleteGroupAction(g.group.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The server says what keys it wrote, so the client cannot compute a
    // second, differing answer.
    expect(r.moved.map((m) => m.tileKey)).toEqual([first, second]);

    const rows = (await placementsOf(A)).sort((a, b) => compareKeys(a.pos, b.pos));
    expect(rows.every((p) => p.groupId === null)).toBe(true);
    expect(rows.map((p) => p.tileKey)).toEqual([already, first, second]);
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
    const c = await metricRow(A);
    const a = await metricRow(A);
    await setTilePlacementsAction([
      { tileKey: `metric:${c}`, groupId: g.group.id, pos: "a" },
      { tileKey: `metric:${a}`, groupId: g.group.id, pos: "m" },
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

  /**
   * C20: the shape check (`/^flow:…$/`) never asked whether THIS caller may
   * see the flow named — a rank scoped to a few metrics could point the
   * shared calendar at any flow in the workspace.
   */
  it("refuses a flow the caller's rank cannot see", async () => {
    await view("v1");
    await assignBuilderRank(["flow:f1"]);
    expect(await pick("v1", "flow:f2:n1")).toEqual({ ok: false, error: "That isn't a metric we know." });
    expect(await keys()).toEqual([]);
  });

  it("allows a flow the caller's rank can see", async () => {
    await view("v1");
    await assignBuilderRank(["flow:f1"]);
    expect(await pick("v1", "flow:f1:n1")).toEqual({ ok: true });
    expect(await keys()).toEqual(["flow:f1:n1"]);
  });
});

/**
 * C20 FOLLOW-UP (fix round 1): `addViewAction` always ends in `redirect()`,
 * which throws rather than returning, so the only way to check what it
 * actually WROTE is to drive it for real and catch that throw — a source-text
 * check on `tileKeysAllowed(` proves the call is wired in, but a neutered
 * `tileKeysAllowed` (always returning null, i.e. "allowed") leaves that
 * source-text assertion green while the smuggled placement gets written
 * anyway. These two tests read the database after the redirect instead.
 */
describe("creating a calendar view with an initial metric", () => {
  const post = (kind: string, tileKey: string) => {
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("tileKey", tileKey);
    return addViewAction(fd);
  };
  const viewsOf = async (orgId: string) => db.select().from(dashboardViews).where(eq(dashboardViews.orgId, orgId));

  it("creates the view but drops a flow the caller's rank cannot see, rather than honoring it", async () => {
    await assignBuilderRank(["flow:f1"]);
    await expect(post("calendar", "flow:f2:n1")).rejects.toThrow(/NEXT_REDIRECT/);

    // The refusal is silent: the view is still created (the same "absent is
    // allowed" outcome as posting no key at all) — only the smuggled
    // placement is not honored.
    const views = await viewsOf(A);
    expect(views).toHaveLength(1);
    expect(views[0].kind).toBe("calendar");
    expect(await placementsOf(A)).toHaveLength(0);
  });

  it("keeps a flow the caller's rank can see", async () => {
    await assignBuilderRank(["flow:f1"]);
    await expect(post("calendar", "flow:f1:n1")).rejects.toThrow(/NEXT_REDIRECT/);

    const views = await viewsOf(A);
    expect(views).toHaveLength(1);
    const placements = await placementsOf(A);
    expect(placements).toHaveLength(1);
    expect(placements[0]).toMatchObject({ tileKey: "flow:f1:n1", viewId: views[0].id });
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

/**
 * THE ONE LINE WITHOUT WHICH DRAGGING A TAB DOES NOTHING.
 *
 * An `<a href>` is natively draggable in every browser. Press one and move, and
 * the browser starts an HTML5 drag of the URL — and that drag CAPTURES the
 * pointer, so the `pointermove` handler `ViewStrip` reorders from never fires.
 * The reorder shipped unreachable for exactly this reason, and nothing failed:
 * it compiled, the tab still navigated, and the only symptom was a ghost URL
 * chip following the cursor.
 *
 * A source assertion rather than a render test, because what is being guarded
 * is a DEFAULT of the platform. There is no state to drive and nothing to
 * observe — the attribute is either written down or the feature is gone.
 */
describe("a view tab", () => {
  const controls = readFileSync(join(__dirname, "..", "src/app/dashboard/board-controls.tsx"), "utf8");

  it("opts out of the browser's own link drag, so the strip can own the gesture", () => {
    const code = controls.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/<a\b[\s\S]{0,200}?draggable=\{false\}/);
    // …and the wrapper refuses a drag that starts on the label's text instead.
    expect(code).toMatch(/onDragStart=\{\(e\) => e\.preventDefault\(\)\}/);
  });

  it("is still a real anchor, which is the whole reason it is not a button", () => {
    // Middle-click, copy-link and a URL pasted into Slack all depend on this.
    const code = controls.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/<a\b[\s\S]{0,80}?href=\{href\}/);
  });
});
