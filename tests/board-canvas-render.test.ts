import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CustomBoard, type CanvasTile } from "@/app/dashboard/custom-board";

/**
 * WHAT THE CANVAS ACTUALLY EMITS.
 *
 * Two promises only checkable as markup. The first is "one saved layout, three
 * renderings" — every cell must carry all six custom properties, because the
 * media queries pick one and a missing pair means a tile vanishes at a width
 * nobody tested. The second is the permission gate's visible half.
 *
 * `renderToStaticMarkup` on a client component, the way `board-render.test.ts`
 * does it: no hydration, no events, no DOM — which is also a constraint the
 * board must satisfy, because it may not touch `window` during render.
 */

const tile = (id: string, over: Partial<CanvasTile> = {}): CanvasTile => ({
  id,
  x: 0,
  y: 0,
  w: 3,
  h: 4,
  node: createElement("p", null, `card ${id}`),
  ...over,
});

const render = (tiles: CanvasTile[], canEdit = true) =>
  renderToStaticMarkup(createElement(CustomBoard, { tiles, canEdit }));

describe("the canvas places what it is given", () => {
  it("emits one cell per tile, carrying the card it was handed", () => {
    const html = render([tile("a"), tile("b", { x: 3 })]);
    expect(html.match(/board-cell/g) ?? []).toHaveLength(2);
    expect(html).toContain("card a");
    expect(html).toContain("card b");
  });

  it("gives every cell all three renderings", () => {
    // Sabotage: emit only --c12/--r12 and the board is empty on a phone, which
    // is a state no desktop test would ever reach.
    const html = render([tile("a")]);
    for (const v of ["--c12", "--r12", "--c6", "--r6", "--c1", "--r1"]) {
      expect(html, `missing ${v}`).toContain(v);
    }
  });

  it("converts 0-based coordinates to 1-based grid lines", () => {
    // A tile above it, so its row is not simply floated to the top by gravity
    // and the row assertion means something.
    const html = render([tile("top", { x: 3, y: 0, w: 6, h: 2 }), tile("a", { x: 3, y: 2, w: 6, h: 4 })]);
    expect(html).toContain("--c12:4 / span 6");
    expect(html).toContain("--r12:3 / span 4");
    // Sabotage: drop the `+ 1` and the first column and row disappear off the
    // top-left of the canvas.
    expect(html).not.toContain("--c12:3 / span 6");
  });

  it("compacts what it renders, so a stored gap does not become a hole", () => {
    // The tile is stored at row 9 with nothing above it. Gravity is applied at
    // render, not only on write, so a layout written by an older build — or by
    // hand — still draws correctly.
    const html = render([tile("a", { y: 9 })]);
    expect(html).toContain("--r12:1 / span 4");
  });
});

describe("a tile with no card", () => {
  it("keeps its box rather than letting the grid reflow around it", () => {
    /**
     * The nodes come from props and the boxes from seeded state, so the two can
     * briefly disagree — a row added by this client and not yet read back. A
     * box that lost its card must NOT collapse, because gravity would then pull
     * every tile below it up and push them back a moment later.
     *
     * Note this is not the dead-METRIC state: the page passes a real card for
     * that (`CustomTile` with `source: null`), because Remove and Change metric
     * are handlers and nothing crossing this boundary may be a function.
     */
    const html = render([tile("a"), { ...tile("b"), x: 3, node: null }]);
    expect(html.match(/board-cell/g) ?? []).toHaveLength(2);
    expect(html).toContain("--c12:4 / span 3");
  });
});

describe("the empty state", () => {
  it("invites an editor to add something", () => {
    const html = render([]);
    expect(html).toContain("Nothing on this view yet");
    expect(html).toContain("more than once");
  });

  it("says something true to a viewer who cannot add anything", () => {
    const html = render([], false);
    expect(html).toContain("Nobody has added a chart");
    expect(html).not.toContain("Add a chart to start");
  });
});

describe("the page branches on the view's kind", () => {
  const page = readFileSync(join(process.cwd(), "src/app/dashboard/page.tsx"), "utf8");

  it("reads neither groups nor placements for a custom view", () => {
    // Two queries per poll returning two empty arrays, on the hottest page in
    // the product. A custom view has no columns and no lane order.
    expect(page).toMatch(/if \(activeKind === "custom" && activeView\)/);
    expect(page).toMatch(/canvasRows = await listBoardTiles\(db, orgId, activeView\)/);
  });

  it("leaves the groups read exactly as it was", () => {
    // Pinned separately by board-shape.test.ts; asserted here too because the
    // tempting edit is to fold the kind into this condition, which breaks it.
    expect(page).toMatch(/if \(groups\.length > 0\) placements = await listTilePlacements\(db, orgId, activeView\)/);
  });

  it("keys both boards by the view, because both seed their state once", () => {
    expect((page.match(/key=\{activeView \?\? "default"\}/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("gives the default view a kind, since it has no row to read one from", () => {
    expect(page).toMatch(/kind: "groups"/);
    expect(page).toMatch(/views\.find\(\(v\) => v\.id === activeView\)\?\.kind \?\? "groups"/);
  });
});
