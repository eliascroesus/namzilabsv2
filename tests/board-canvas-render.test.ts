import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CustomTileOption } from "@/lib/board/types";

// The actions reach for the database the moment the module loads, and pull in
// `server-only`, which throws inside a client module. Nothing here submits
// anything — what is under test is what the canvas SAYS. Same mock-then-import
// shape `board-render.test.ts` uses for the groups board.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
// The client tile renders FlowTile's shared pieces, whose module imports the
// flow refresh action — a "use server" file that reaches for the database the
// moment node (not the bundler) evaluates it.
vi.mock("server-only", () => ({}));
vi.mock("@/app/dashboard/flows/actions", () => ({ refreshFlowAction: async () => ({}) }));
vi.mock("@/app/dashboard/board-actions", () => ({
  addCustomTileAction: async () => ({ ok: true, tile: { id: "new", tileKey: "metric:m1", chart: "number", config: {}, x: 0, y: 0, w: 3, h: 4 } }),
  deleteCustomTileAction: async () => ({ ok: true }),
  setCustomTileAction: async () => ({ ok: true }),
  duplicateCustomTileAction: async () => ({ ok: true, tile: { id: "copy", tileKey: "flow:f1:o1", chart: "number", config: {}, x: 3, y: 0, w: 3, h: 4 } }),
  setCustomTileLayoutAction: async () => ({ ok: true }),
}));

const { CustomBoard } = await import("@/app/dashboard/custom-board");
const { MetricPicker } = await import("@/app/dashboard/add-tile-picker");
type CanvasTile = Parameters<typeof CustomBoard>[0]["tiles"][number];

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
  tileKey: `flow:f1:${id}`,
  x: 0,
  y: 0,
  w: 3,
  h: 4,
  chart: "number",
  charts: ["number", "bar"],
  metricName: `Metric ${id}`,
  config: {},
  attention: 0,
  // A minimal live source: the card renders CLIENT-side from this data now.
  data: { kind: "flow", tile: { format: "number", precision: 0, byRange: { today: { value: 7 } } }, status: "fresh" },
  ...over,
});

const render = (tiles: CanvasTile[], canEdit = true, options: CustomTileOption[] = []) =>
  renderToStaticMarkup(createElement(CustomBoard, { viewId: "v1", tiles, canEdit, options, rangeKey: "today" }));

describe("the canvas places what it is given", () => {
  it("emits one cell per tile, rendered from the DATA it was handed", () => {
    // The rendering-model change: no server node crosses the boundary — the
    // board renders CustomTile itself, from each tile's data.
    const html = render([tile("a"), tile("b", { x: 3 })]);
    expect(html.match(/board-cell/g) ?? []).toHaveLength(2);
    expect(html).toContain("Metric a");
    expect(html).toContain("Metric b");
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

describe("a tile whose metric is gone", () => {
  it("keeps its box and says so, rather than letting the grid reflow around it", () => {
    /**
     * `data: null` is the dead-metric state — the tile renders client-side
     * now, so the unavailable card comes from the SAME component as every
     * other state, and the box must not collapse: gravity would pull every
     * tile below it up and push them back a moment later.
     */
    const html = render([tile("a"), { ...tile("b"), x: 3, data: null }]);
    expect(html.match(/board-cell/g) ?? []).toHaveLength(2);
    expect(html).toContain("--c12:4 / span 3");
    expect(html).toContain("Metric unavailable");
  });

  it("renders the live tile's number from its data, client-side", () => {
    // The rendering-model change in one assertion: no server node crosses the
    // boundary, and the figure on screen came out of the DATA prop.
    const html = render([tile("a")]);
    expect(html).toContain(">7<");
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

describe("adding lands immediately; the metric question is asked later", () => {
  const board = readFileSync(join(process.cwd(), "src/app/dashboard/custom-board.tsx"), "utf8");
  const picker = readFileSync(join(process.cwd(), "src/app/dashboard/add-tile-picker.tsx"), "utf8");

  it("the Add menu is a popover of chart types with NO metric step", () => {
    /**
     * The shipped flow asked chart → metric → landed, in a modal, and the
     * metric step was the wrong question at the wrong time. Add now lands the
     * chart bound to the FIRST metric that can draw it — the options list the
     * page already computed — and changing the metric happens on the tile.
     */
    expect(board).toMatch(/options\.find\(\(o\) => o\.charts\.includes\(c\.id\)\)/);
    expect(board).toMatch(/onPick\(c\.id, key\)/);
    // A popover in the + view menu's shape, never a modal.
    const menu = board.slice(board.indexOf("function AddChartMenu"), board.indexOf("function PendingCard"));
    expect(menu).toContain("<Popover");
    expect(menu).not.toContain("<Modal");
  });

  it("greys an undrawable chart with the reason, and never hides it", () => {
    expect(board).toContain("No metric here can be drawn this way yet.");
    expect(board).toMatch(/disabled=\{busy \|\| !key\}/);
  });

  it("offers a block whatever the board holds, because there is nothing to bind", () => {
    /**
     * Every chart above is bound to the first metric that can draw it, and is
     * greyed with the reason when nothing can. A heading has no metric to bind
     * and therefore cannot be unavailable — it is offerable on an empty board
     * exactly as on a full one, which is the point of furniture.
     */
    expect(board).toMatch(/const first = block \? null : options\.find/);
    expect(board).toMatch(/const key = block \? blockTileKey\(block\) : first\?\.key/);
    // And they are their own section, under a rule: nine items in one flat
    // list says drawings and furniture are the same kind of thing.
    // The rule is drawn when the FIRST block is reached, whatever element ends
    // up drawing it. Pinning the whole `<div className="my-1 h-px bg-border" />`
    // verbatim made a claim about sectioning into a claim about one div.
    expect(board).toMatch(/block === "heading" && </);
  });

  it("the two-step modal is gone, and only the change-metric picker survives", () => {
    expect(picker).not.toMatch(/AddTilePicker|lockedChart|Back to charts|Add a chart/);
    expect(picker).toContain("export function MetricPicker");
  });

  it("the change-metric picker lists only metrics the staying chart can draw", () => {
    const html = renderToStaticMarkup(
      createElement(MetricPicker, {
        options: [
          { key: "flow:f1:o1", title: "Booked Leads", charts: ["number", "bar"] },
          { key: "flow:f1:o2", title: "Pickup Rate", charts: ["number"] },
        ],
        chart: "bar",
        busy: false,
        onClose: () => {},
        onPick: () => {},
      }),
    );
    expect(html).toContain("Booked Leads");
    // A repoint must never leave a tile asking for a drawing its new metric
    // cannot give — the scalar-only metric is simply not offered.
    expect(html).not.toContain("Pickup Rate");
    expect(html).toContain("Choose a metric for this bar chart");
  });

  it("says so honestly when nothing can be drawn that way", () => {
    const html = renderToStaticMarkup(
      createElement(MetricPicker, {
        options: [{ key: "metric:m1", title: "Deals", charts: ["number"] }],
        chart: "funnel",
        busy: false,
        onClose: () => {},
        onPick: () => {},
      }),
    );
    expect(html).toContain("Nothing here can be drawn as a funnel yet.");
  });
});

describe("a range press does not reshape a canvas", () => {
  const src = readFileSync(join(process.cwd(), "src/app/dashboard/board-controls.tsx"), "utf8");
  const page = readFileSync(join(process.cwd(), "src/app/dashboard/page.tsx"), "utf8");

  it("skeletons at the stored footprints rather than in a three-up grid", () => {
    /**
     * `columns` is zero on a canvas — it has no groups — so without a third
     * shape the skeleton falls through to BOARD_GRID, and pressing a range pill
     * swaps a grid of placed charts for a column of placeholders and swaps it
     * back. That is exactly the "it changes height and stuff" this component
     * was already fixed for once, arriving by a different door.
     */
    expect(src).toMatch(/canvas\?: GridBox\[\]/);
    expect(src).toMatch(/if \(canvas && canvas\.length > 0\)/);
    expect(src).toMatch(/canvasCells\(canvas\)/);
    expect(page).toMatch(/canvas=\{activeKind === "custom" \? canvasTiles : undefined\}/);
  });
});

describe("one copy of the failure path", () => {
  it("is shared by both boards, because two copies is how the bug comes back", () => {
    const layout = readFileSync(join(process.cwd(), "src/app/dashboard/board-layout.tsx"), "utf8");
    const canvas = readFileSync(join(process.cwd(), "src/app/dashboard/custom-board.tsx"), "utf8");
    for (const [name, src] of [["board-layout", layout], ["custom-board", canvas]] as const) {
      expect(src, `${name} must use the shared hook`).toMatch(/useSettle\(setToast\)/);
      // Sabotage: paste the .then/.catch back into either file. It keeps
      // working, and the next edit to one of them silently diverges.
      expect(src, `${name} re-implements settle`).not.toMatch(/const settle = useCallback\(/);
    }
  });
});

describe("a canvas computes only the classic metrics it points at", () => {
  const page = readFileSync(join(process.cwd(), "src/app/dashboard/page.tsx"), "utf8");

  it("gates the live computes on the view's kind and the canvas's own references", () => {
    /**
     * The expensive rows on the hottest page: each classic aggregate is a live
     * events query per render, a funnel one query PER STAGE, serially — and
     * the whole block re-runs on every refresh and every freshness poll. A
     * canvas referencing none of them was paying for all of them.
     */
    expect(page).toMatch(/const referencedKeys = new Set\(canvasRows\.map\(\(r\) => r\.tileKey\)\)/);
    expect(page).toMatch(/activeKind === "custom" \? metrics\.filter\(\(m\) => referencedKeys\.has\(tileKeyOfMetric\(m\.id\)\)\) : metrics/);
    expect(page).toMatch(/classicsToCompute\.map\(/);
  });

  it("offers flow metrics only in the picker, so the referenced set can only shrink", () => {
    // Sabotage: spread `tiles` back into tileOptions and every new chart can
    // re-introduce a live per-render compute.
    const options = page.slice(page.indexOf("const tileOptions"), page.indexOf("].filter((o) => o.charts.length > 0)"));
    expect(options).toContain("flowTiles.map");
    expect(options).not.toContain("tileKeyOfMetric");
  });

  it("still treats a canvas as content when its computed subset is empty", () => {
    // An empty canvas is real content — the invitation to add — and must not
    // fall through to the onboarding checklist.
    expect(page).toMatch(/const hasTiles = activeKind === "custom" \|\| tiles\.length > 0 \|\| flowTiles\.length > 0/);
  });
});
