import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import {
  dashboardGroups,
  dashboardNotes,
  dashboardTilePlacements,
  dashboardTiles,
  dashboardViews,
  flowResults,
  flows,
  flowVersions,
  workspaceTemplates,
} from "@/db/schema";
import type { DB } from "@/db/types";
import {
  applySnapshot,
  createTemplate,
  deleteNotes,
  deleteTemplate,
  getTemplateByCode,
  listTemplates,
  newTemplateCode,
  normaliseTemplateCode,
  readNotes,
  recordTemplateUse,
  snapshotViews,
  TemplateRefusal,
  TemplatesUnavailable,
  updateTemplate,
  writeNote,
} from "@/lib/templates/store";
import { UNSET_TILE_KEY } from "@/lib/board/types";
import { parseTileConfig } from "@/lib/board/tile-config";

vi.mock("server-only", () => ({}));

/**
 * A TEMPLATE, END TO END, AGAINST A REAL POSTGRES — built from one workspace's
 * rows and written into another's.
 *
 * The property that matters is the one a unit test of `planApply` cannot see:
 * that ONE statement lands the views, the tiles joined to them, the columns and
 * the notes, and that nothing in the author's workspace moves while it
 * happens.
 */

let db: DB;
let close: () => Promise<void>;

const A = "org_author";
const B = "org_student";
const FLOW_ID = "0b7c2a9e-1111-4d4d-8e8e-000000000001";
const FLOW_KEY = `flow:${FLOW_ID}:out1`;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  vi.unstubAllEnvs();
  await db.insert(flows).values({
    id: FLOW_ID,
    orgId: A,
    name: "Revenue flow",
    draftGraph: { nodes: [{ id: "a1", type: "app", data: { config: { source: "stripe" } } }], edges: [] },
  });
  await db.insert(flowVersions).values({ flowId: FLOW_ID, orgId: A, version: 1, graph: { nodes: [], edges: [] } });
  await db.insert(flowResults).values({ flowId: FLOW_ID, orgId: A, version: 1, outputNodeId: "out1", tile: { name: "Revenue" } });
  await db.insert(dashboardViews).values([
    { id: "canvas", orgId: A, name: "Overview", pos: "i", kind: "custom" },
    { id: "cols", orgId: A, name: "Sales", pos: "r", kind: "groups" },
    { id: "cal", orgId: A, name: "Days", pos: "v", kind: "calendar" },
  ]);
  await db.insert(dashboardTiles).values([
    { id: "t1", orgId: A, viewId: "canvas", tileKey: FLOW_KEY, chart: "number", config: { target: 50000, color: "teal" }, x: 0, y: 0, w: 3, h: 4 },
    { id: "t2", orgId: A, viewId: "canvas", tileKey: "block:text", chart: "text", config: { text: "Week one" }, x: 3, y: 0, w: 9, h: 2 },
  ]);
  await db.insert(dashboardGroups).values({ id: "grp", orgId: A, name: "Money", color: "teal", pos: "i", viewId: "cols" });
  await db.insert(dashboardTilePlacements).values([
    { orgId: A, tileKey: FLOW_KEY, groupId: "grp", viewId: "cols", pos: "i" },
    { orgId: A, tileKey: FLOW_KEY, groupId: null, viewId: "cal", pos: "i" },
  ]);
});

afterEach(async () => {
  await close();
});

const everything = () => true;

describe("building a snapshot from a workspace", () => {
  it("reads the chosen views in tab order and names their metrics", async () => {
    const got = await snapshotViews(db, A, ["cal", "canvas", "cols"], everything);
    expect(got?.viewIds).toEqual(["canvas", "cols", "cal"]);
    const [canvas, cols, cal] = got!.snapshot.views;
    expect(canvas).toMatchObject({ kind: "custom", name: "Overview" });
    if (canvas.kind !== "custom" || cols.kind !== "groups") throw new Error("kinds");
    expect(canvas.tiles[0]).toMatchObject({ chart: "number", note: "Revenue", apps: ["stripe"], config: { color: "teal" } });
    expect(cols.groups[0]).toMatchObject({ name: "Money", note: "Revenue", apps: ["stripe"] });
    expect(cal).toEqual({ kind: "calendar", name: "Days", note: "Revenue", apps: ["stripe"] });
  });

  it("names nothing its author's role hides", async () => {
    const got = await snapshotViews(db, A, ["canvas"], (key) => key !== `flow:${FLOW_ID}`);
    const [canvas] = got!.snapshot.views;
    if (canvas.kind !== "custom") throw new Error("kind");
    expect(canvas.tiles[0].note).toBeNull();
    expect(JSON.stringify(got)).not.toContain("Revenue");
  });

  it("leaves out a tile its author's role hides — box, note and all", async () => {
    // A teammate with wider access wrote this note about the hidden metric.
    await db
      .update(dashboardTiles)
      .set({ config: { note: "Client X margin, from Stripe" } })
      .where(eq(dashboardTiles.id, "t1"));
    const got = await snapshotViews(db, A, ["canvas", "cal"], (key) => key !== `flow:${FLOW_ID}`);
    const json = JSON.stringify(got);
    expect(json).not.toContain("Client X");
    const [canvas, cal] = got!.snapshot.views;
    if (canvas.kind !== "custom") throw new Error("kind");
    // Only the text block survives; the calendar keeps its shape and loses its metric.
    expect(canvas.tiles.map((t) => t.chart)).toEqual(["text"]);
    expect(cal).toEqual({ kind: "calendar", name: "Days", note: null, apps: [] });
  });

  it("cannot read another workspace's views, however the ids arrive", async () => {
    expect(await snapshotViews(db, B, ["canvas", "cols"], everything)).toBeNull();
  });
});

describe("applying a snapshot to another workspace", () => {
  it("lands every view, tile, column and note in one go, and moves nothing of the author's", async () => {
    const { snapshot } = (await snapshotViews(db, A, ["canvas", "cols", "cal"], everything))!;
    const before = await db.select().from(dashboardTiles).where(eq(dashboardTiles.orgId, A));

    const { viewIds } = await applySnapshot(db, B, snapshot);
    expect(viewIds).toHaveLength(3);

    const views = await db.select().from(dashboardViews).where(eq(dashboardViews.orgId, B));
    expect(views.map((v) => [v.name, v.kind]).sort()).toEqual([
      ["Days", "calendar"],
      ["Overview", "custom"],
      ["Sales", "groups"],
    ]);

    const tiles = await db.select().from(dashboardTiles).where(eq(dashboardTiles.orgId, B));
    const slot = tiles.find((t) => t.chart === "number")!;
    expect(slot.tileKey).toBe(UNSET_TILE_KEY);
    expect(parseTileConfig(slot.config)).toEqual({ color: "teal", note: "Revenue", noteApps: ["stripe"] });
    expect(tiles.find((t) => t.chart === "text")).toMatchObject({ tileKey: "block:text", config: { text: "Week one" } });

    const [group] = await db.select().from(dashboardGroups).where(eq(dashboardGroups.orgId, B));
    expect(group).toMatchObject({ name: "Money", color: "teal" });
    const notes = await readNotes(db, B);
    expect(notes.get(`group:${group.id}`)).toEqual({ note: "Revenue", apps: ["stripe"] });
    const cal = views.find((v) => v.kind === "calendar")!;
    expect(notes.get(`view:${cal.id}`)).toEqual({ note: "Revenue", apps: ["stripe"] });

    // The recipient gets no placements at all — only empty columns.
    expect(await db.select().from(dashboardTilePlacements).where(eq(dashboardTilePlacements.orgId, B))).toEqual([]);
    // And the author's board is exactly as it was.
    expect(await db.select().from(dashboardTiles).where(eq(dashboardTiles.orgId, A))).toEqual(before);
  });

  it("adds after the tabs a workspace already has, never among them", async () => {
    await db.insert(dashboardViews).values({ id: "mine", orgId: B, name: "Mine", pos: "z", kind: "groups" });
    const { snapshot } = (await snapshotViews(db, A, ["canvas"], everything))!;
    const { viewIds } = await applySnapshot(db, B, snapshot);
    const [added] = await db.select().from(dashboardViews).where(eq(dashboardViews.id, viewIds[0]));
    expect(added.pos > "z").toBe(true);
  });

  it("refuses to take a workspace past its view limit — and writes nothing", async () => {
    vi.stubEnv("MAX_BOARD_VIEWS_PER_ORG", "2");
    await db.insert(dashboardViews).values({ id: "mine", orgId: B, name: "Mine", pos: "z", kind: "groups" });
    const { snapshot } = (await snapshotViews(db, A, ["canvas", "cols"], everything))!;
    await expect(applySnapshot(db, B, snapshot)).rejects.toBeInstanceOf(TemplateRefusal);
    expect(await db.select().from(dashboardViews).where(eq(dashboardViews.orgId, B))).toHaveLength(1);
  });
});

describe("templates as rows", () => {
  const snap = async () => (await snapshotViews(db, A, ["canvas"], everything))!.snapshot;

  it("mints a ten-character code a person can read aloud", () => {
    const code = newTemplateCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(normaliseTemplateCode(code.toLowerCase())).toBe(code);
    expect(normaliseTemplateCode("short")).toBeNull();
    expect(normaliseTemplateCode("ILOU000000")).toBeNull();
  });

  it("creates, finds by code, counts uses, updates and deletes — each walled to its workspace", async () => {
    const { id, code } = await createTemplate(db, {
      orgId: A,
      createdBy: "user_coach",
      authorName: "Coach",
      name: "Agency scorecard",
      description: null,
      snapshot: await snap(),
      sourceViewIds: ["canvas"],
    });
    expect((await getTemplateByCode(db, code))?.name).toBe("Agency scorecard");

    await recordTemplateUse(db, { templateId: id, orgId: B, userId: "user_student", version: 1, newWorkspace: true });
    const [listed] = await listTemplates(db, A);
    expect(listed).toMatchObject({ id, uses: 1, version: 1, enabled: true });
    expect(await listTemplates(db, B)).toEqual([]);

    // Another workspace cannot touch it by id.
    expect(await updateTemplate(db, B, id, { enabled: false })).toBe(false);
    expect(await deleteTemplate(db, B, id)).toBe(false);

    expect(await updateTemplate(db, A, id, { snapshot: await snap() })).toBe(true);
    expect((await getTemplateByCode(db, code))?.version).toBe(2);

    expect(await deleteTemplate(db, A, id)).toBe(true);
    expect(await getTemplateByCode(db, code)).toBeNull();
  });

  it("reads a snapshot that no longer parses as unavailable rather than half a template", async () => {
    await db.insert(workspaceTemplates).values({ id: "bad", orgId: A, code: "ABCDEFGH23", createdBy: "u", name: "x", snapshot: { v: 9 } });
    expect((await getTemplateByCode(db, "ABCDEFGH23"))?.snapshot).toBeNull();
  });
});

describe("what a template may store", () => {
  it("refuses a snapshot its own link could not read back, and writes nothing", async () => {
    const { snapshot } = (await snapshotViews(db, A, ["canvas"], everything))!;
    const tooMany = { ...snapshot, views: Array.from({ length: 31 }, () => snapshot.views[0]) };
    await expect(
      createTemplate(db, { orgId: A, createdBy: "u", authorName: null, name: "Big", description: null, snapshot: tooMany, sourceViewIds: [] }),
    ).rejects.toMatchObject({ reason: "views" });
    expect(await db.select().from(workspaceTemplates)).toEqual([]);
  });

  it("refuses one too large to serve to strangers on every visit", async () => {
    const { snapshot } = (await snapshotViews(db, A, ["canvas"], everything))!;
    const view = snapshot.views[0];
    if (view.kind !== "custom") throw new Error("kind");
    const wordy = {
      ...snapshot,
      views: Array.from({ length: 30 }, () => ({
        ...view,
        tiles: Array.from({ length: 60 }, () => ({ ...view.tiles[1], config: { text: "x".repeat(2000) } })),
      })),
    };
    await expect(
      createTemplate(db, { orgId: A, createdBy: "u", authorName: null, name: "Wordy", description: null, snapshot: wordy, sourceViewIds: [] }),
    ).rejects.toMatchObject({ reason: "size" });
  });

  it("never cuts a note inside an emoji — jsonb refuses half of one", async () => {
    // A DERIVED note has no schema cap of its own — it is the metric's name, and
    // a name can be any length. UTF-16 slicing would cut this one at the
    // rocket's high surrogate.
    await db.update(flowResults).set({ tile: { name: `${"a".repeat(278)}🚀zzz` } }).where(eq(flowResults.flowId, FLOW_ID));
    const { snapshot } = (await snapshotViews(db, A, ["canvas"], everything))!;
    const { code } = await createTemplate(db, {
      orgId: A,
      createdBy: "u",
      authorName: null,
      name: "Emoji",
      description: null,
      snapshot,
      sourceViewIds: [],
    });
    const stored = await getTemplateByCode(db, code);
    const note = stored?.snapshot?.views[0].kind === "custom" ? stored.snapshot.views[0].tiles[0].note : null;
    expect(note).toMatch(/…$/);
    expect(note).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe("notes on columns and calendars", () => {
  it("reads one view's notes — never another view's, never a deleted column's", async () => {
    await db.insert(dashboardViews).values({ id: "cols2", orgId: A, name: "Other", pos: "x", kind: "groups" });
    await db.insert(dashboardGroups).values({ id: "grp2", orgId: A, name: "Elsewhere", color: "teal", pos: "i", viewId: "cols2" });
    await writeNote(db, A, { kind: "group", id: "grp" }, "Mine");
    await writeNote(db, A, { kind: "group", id: "grp2" }, "Theirs");
    await writeNote(db, A, { kind: "group", id: "deleted-group" }, "Orphan");
    await writeNote(db, A, { kind: "view", id: "cols" }, "The view's own");
    expect(await readNotes(db, A, "cols")).toEqual(
      new Map([
        ["group:grp", { note: "Mine", apps: [] }],
        ["view:cols", { note: "The view's own", apps: [] }],
      ]),
    );
  });

  it("forgets a column's note with the column, and a view's with the view", async () => {
    await writeNote(db, A, { kind: "group", id: "grp" }, "Mine");
    await writeNote(db, A, { kind: "view", id: "cols" }, "The view's own");
    await deleteNotes(db, A, { viewId: "cols" });
    expect(await readNotes(db, A)).toEqual(new Map());
  });

  it("writes, overwrites and clears a note", async () => {
    await writeNote(db, A, { kind: "group", id: "grp" }, "Cash only");
    await writeNote(db, A, { kind: "group", id: "grp" }, "Cash, not invoices");
    expect((await readNotes(db, A)).get("group:grp")).toEqual({ note: "Cash, not invoices", apps: [] });
    await writeNote(db, A, { kind: "group", id: "grp" }, null);
    expect((await readNotes(db, A)).has("group:grp")).toBe(false);
  });

  it("keeps a template's apps when the words are cleared", async () => {
    await db.insert(dashboardNotes).values({ orgId: A, targetKind: "group", targetId: "grp", note: "Revenue", apps: ["stripe"] });
    await writeNote(db, A, { kind: "group", id: "grp" }, null);
    expect((await readNotes(db, A)).get("group:grp")).toEqual({ note: null, apps: ["stripe"] });
  });
});

describe("before the migration is pasted", () => {
  it("answers the board with no notes, and every template act with a sentence", async () => {
    await db.execute("drop table dashboard_notes");
    await db.execute("drop table workspace_template_uses");
    await db.execute("drop table workspace_templates");
    expect(await readNotes(db, A)).toEqual(new Map());
    await expect(getTemplateByCode(db, "ABCDEFGH23")).rejects.toBeInstanceOf(TemplatesUnavailable);
    await expect(listTemplates(db, A)).rejects.toBeInstanceOf(TemplatesUnavailable);
    await expect(writeNote(db, A, { kind: "group", id: "grp" }, "x")).rejects.toBeInstanceOf(TemplatesUnavailable);
    // Guard against a vacuous pass: the tables really are gone.
    await expect(db.select().from(workspaceTemplates)).rejects.toThrow();
  });
});
