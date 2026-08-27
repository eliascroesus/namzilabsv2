import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BOARD_GRID } from "@/components/ui/page";
import type { BoardGroup, BoardTile, TilePlacement } from "@/lib/board/types";
import { groupAccent, groupBadge, groupInk, groupWash } from "@/components/flow/node-accent";

/**
 * WHAT THE BOARD ACTUALLY EMITS.
 *
 * Two promises that are only checkable as markup. The first is the one made to
 * every existing customer — "with no groups the dashboard is what it was" — and
 * an intention is not a guarantee; the bytes are. The second is the permission
 * gate's visible half: a member who may not rearrange must not be shown
 * controls that will refuse them. (The other half, the server actions, is in
 * `board-actions.test.ts`, and that is the half that actually protects
 * anything — this one only stops the interface lying.)
 *
 * `renderToStaticMarkup` on a client component, the way `board-controls.test.ts`
 * does it: no hydration, no events, no DOM. Which is also a constraint the
 * board must satisfy — it may not touch `window` during render.
 */

// The actions reach for the database the moment the module loads. Nothing here
// submits anything; what is under test is what the board SAYS.
vi.mock("@/app/dashboard/board-actions", () => ({
  addViewAction: async () => {},
  createGroupAction: async () => ({ ok: true }),
  renameGroupAction: async () => ({ ok: true }),
  setGroupColorAction: async () => ({ ok: true }),
  deleteGroupAction: async () => ({ ok: true, moved: [] }),
  setTilePlacementsAction: async () => ({ ok: true }),
}));

const { BoardLayout } = await import("@/app/dashboard/board-layout");

const tile = (key: string, title: string): BoardTile => ({
  key,
  title,
  unitKey: "number::",
  value: 1,
  attention: 0,
  node: createElement("article", { key, "data-tile": key }, title),
});

const group = (id: string, name: string, pos: string): BoardGroup => ({
  id,
  name,
  color: "blue",
  pos,
  sortKey: "manual",
});

const render = (props: {
  tiles: BoardTile[];
  groups: BoardGroup[];
  placements: TilePlacement[];
  canEdit: boolean;
}) => renderToStaticMarkup(createElement(BoardLayout, { ...props, viewId: null }));

const TILES = [tile("metric:a", "Revenue"), tile("metric:b", "Leads")];

describe("with no groups", () => {
  it("emits the same grid the dashboard emitted before this feature", () => {
    const html = render({ tiles: TILES, groups: [], placements: [], canEdit: true });
    // BOARD_GRID is imported rather than typed, so this test and the component
    // cannot agree on something that is no longer the grid.
    //
    // The surrounding spacing is deliberately NOT pinned here any more. Matching
    // the whole `class="mt-4 items-start …"` attribute meant a re-pitch of the
    // page's rhythm failed a test about the GRID, and `tests/board-shape.test.ts`
    // already pins that exact string at the source, where it belongs.
    expect(html).toContain(BOARD_GRID);
    // And none of the board's own furniture.
    expect(html).not.toContain("Nothing in this group yet");
    expect(html).not.toContain("overflow-x-auto");
    // Both tiles, in the server's order, untouched.
    expect(html.indexOf("Revenue")).toBeLessThan(html.indexOf("Leads"));
  });

  it("still offers the one door to a first group", () => {
    // The button has to exist BEFORE there is a board, or there is no way to
    // ever get one.
    expect(render({ tiles: TILES, groups: [], placements: [], canEdit: true })).toContain("New group");
  });
});

describe("with a group", () => {
  it("wears its colour as a badge and a wash, not as bare text", () => {
    /**
     * The Notion move, and the reason it is worth the two helpers: a board says
     * "these belong together" with colour before anybody reads a word. The ink
     * is NOT the accent — these hues are solved to 3.05:1 on white, which is the
     * rule for a 4px mark and nowhere near enough for 13px text on a tint of
     * itself. See groupInk.
     */
    const html = render({
      tiles: TILES,
      groups: [group("g1", "Revenue metrics", "i")],
      placements: [],
      canEdit: true,
    });
    expect(html).toContain(`background:${groupBadge("blue")}`);
    expect(html).toContain(`background:${groupWash("blue")}`);
    expect(html).toContain(`color:${groupInk("blue")}`);
    // The dot keeps the accent itself — a mark, not text.
    expect(html).toContain(`background:${groupAccent("blue")}`);
  });

  it("draws a column with its name and count, and the leftovers above it", () => {
    const html = render({
      tiles: TILES,
      groups: [group("g1", "Revenue metrics", "i")],
      placements: [{ tileKey: "metric:a", groupId: "g1", pos: "i" }],
      canEdit: true,
    });
    expect(html).toContain("Revenue metrics");
    // The scrollers: one for the ungrouped row, one for the columns.
    expect(html.match(/overflow-x-auto/g) ?? []).toHaveLength(2);
    // The grid is gone — this is a board now.
    expect(html).not.toContain(BOARD_GRID);
  });

  it("says what an empty column is for, rather than drawing a header over nothing", () => {
    const html = render({ tiles: TILES, groups: [group("g1", "Empty", "i")], placements: [], canEdit: true });
    expect(html).toContain("Drop a metric here");
  });
});

describe("a member who may not rearrange", () => {
  it("sees the arrangement and none of the controls", () => {
    const html = render({
      tiles: TILES,
      groups: [group("g1", "Revenue metrics", "i")],
      placements: [{ tileKey: "metric:a", groupId: "g1", pos: "i" }],
      canEdit: false,
    });

    // The board itself is theirs to read — reading is not editing.
    expect(html).toContain("Revenue metrics");
    expect(html).toContain("Revenue");

    // None of the ways to change it.
    expect(html).not.toContain("New group");
    expect(html).not.toContain("Options for");
    expect(html).not.toContain("Move Revenue");
    expect(html).not.toContain("aria-haspopup");
  });

  it("renders the group name as a heading rather than a dead button", () => {
    // A disabled-looking control that does nothing is worse than no control:
    // for this member the name is simply a heading.
    const html = render({ tiles: [], groups: [group("g1", "Ops", "i")], placements: [], canEdit: false });
    expect(html).toContain("<h3");
    expect(html).toContain("Ops");
  });
});
