import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canvasCells, compact, reflow, GRID_COLS, ROW_UNIT_PX, GRID_GAP_PX, type GridBox } from "@/lib/board/grid";

/**
 * THE CUSTOM CANVAS'S RULES, AS ARITHMETIC RATHER THAN AS INTENTIONS.
 *
 * Every promise this feature makes about layout is a property of `compact`:
 * tiles never overlap, tiles float up to fill gaps, a wider window shows the
 * same reading order as a narrow one, and a layout read back from the database
 * renders the same way it was saved. None of that is checkable by looking at a
 * screenshot — a board with two tiles quietly stacked on the same cell looks
 * exactly like a board with one tile.
 *
 * So it is checked here, and it is checked against RANDOMISED and ADVERSARIAL
 * inputs rather than the three cases someone thought of. The groups board's
 * ordering bug lived for a week behind a test that asserted what the source
 * said; this asserts what the function does.
 */

const box = (id: string, x: number, y: number, w: number, h: number): GridBox => ({ id, x, y, w, h });

/** Every pair, checked. The whole point is that no two boxes share a cell. */
function anyOverlap(boxes: GridBox[]): [GridBox, GridBox] | null {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return [a, b];
    }
  }
  return null;
}

/** A deterministic pseudo-random generator — `Math.random` is banned in this suite's spirit. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

describe("compact — no overlaps, ever", () => {
  it("separates boxes that all claim the same cell", () => {
    // Three tiles stacked exactly on top of each other is what a corrupted or
    // hand-edited row looks like, and the read path must survive it.
    const out = compact([box("a", 0, 0, 4, 4), box("b", 0, 0, 4, 4), box("c", 0, 0, 4, 4)]);
    expect(anyOverlap(out)).toBeNull();
    expect(out.map((b) => b.y).sort((p, q) => p - q)).toEqual([0, 4, 8]);
  });

  it("survives boxes that hang off the grid, are negative, or are zero-sized", () => {
    const out = compact([
      box("wide", 0, 0, 99, 4), // wider than the grid
      box("neg", -5, -5, 4, 4), // above and left of the origin
      box("zero", 3, 3, 0, 0), // no size at all
      box("spill", 10, 0, 6, 4), // starts inside, ends outside
    ]);
    expect(anyOverlap(out)).toBeNull();
    for (const b of out) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.w).toBeGreaterThanOrEqual(1);
      expect(b.h).toBeGreaterThanOrEqual(1);
      // Sabotage: clamp `x` before `w` in clampBox and the 99-wide box lands at
      // a negative left edge and renders off the side of the page.
      expect(b.x + b.w, `${b.id} spills past column ${GRID_COLS}`).toBeLessThanOrEqual(GRID_COLS);
    }
  });

  it("never overlaps across a thousand randomised layouts", () => {
    const rand = lcg(20260826);
    for (let t = 0; t < 1000; t++) {
      const n = 1 + Math.floor(rand() * 12);
      const boxes = Array.from({ length: n }, (_, i) =>
        box(`t${i}`, Math.floor(rand() * 14) - 1, Math.floor(rand() * 14) - 1, 1 + Math.floor(rand() * 13), 1 + Math.floor(rand() * 8)),
      );
      const out = compact(boxes);
      const hit = anyOverlap(out);
      expect(hit, hit ? `seed ${t}: ${JSON.stringify(hit)}` : "").toBeNull();
      expect(out).toHaveLength(n);
    }
  });
});

describe("compact — gravity", () => {
  it("floats a lone tile at the bottom all the way to the top", () => {
    // "Tiles float up to fill gaps" is the headline promise of the whole grid
    // model, and this is it as one assertion.
    expect(compact([box("a", 0, 9, 3, 4)])[0].y).toBe(0);
  });

  it("closes the hole a deleted tile leaves behind", () => {
    const after = compact([box("top", 0, 0, 12, 4), box("bottom", 0, 8, 12, 4)]);
    expect(after.find((b) => b.id === "bottom")!.y).toBe(4);
  });

  it("lets a short tile sit beside a tall one rather than under it", () => {
    // The test that catches a naive "next free row" pack that ignores columns:
    // `short` fits in the space to the right of `tall`, at row 0.
    const out = compact([box("tall", 0, 0, 6, 8), box("short", 6, 0, 6, 3)]);
    expect(out.find((b) => b.id === "short")).toMatchObject({ x: 6, y: 0 });
  });

  it("keeps a tall tile blocking the cells beneath it", () => {
    const out = compact([box("tall", 0, 0, 6, 8), box("under", 0, 1, 6, 4)]);
    // `under` cannot climb into rows 0-7 of columns 0-5; it lands below.
    expect(out.find((b) => b.id === "under")!.y).toBe(8);
  });
});

describe("compact — order and determinism", () => {
  it("preserves left-to-right reading order within a row", () => {
    const out = compact([box("right", 6, 0, 6, 4), box("left", 0, 0, 6, 4)]);
    expect(out.find((b) => b.id === "left")).toMatchObject({ x: 0, y: 0 });
    expect(out.find((b) => b.id === "right")).toMatchObject({ x: 6, y: 0 });
  });

  it("does not depend on the order the boxes arrive in", () => {
    const boxes = [box("a", 0, 0, 4, 4), box("b", 4, 0, 4, 4), box("c", 8, 0, 4, 4), box("d", 0, 4, 12, 6)];
    const forward = compact(boxes);
    const backward = compact([...boxes].reverse());
    const sortById = (l: GridBox[]) => [...l].sort((p, q) => (p.id < q.id ? -1 : 1));
    // Sabotage: drop the `id` tiebreak in orderOf and two boxes sharing a row
    // and a column swap depending on array order — a layout that reshuffles
    // itself on every render with nothing having changed.
    expect(sortById(forward)).toEqual(sortById(backward));
  });

  it("is idempotent — running it twice changes nothing", () => {
    const rand = lcg(11235);
    for (let t = 0; t < 200; t++) {
      const n = 1 + Math.floor(rand() * 10);
      const boxes = Array.from({ length: n }, (_, i) =>
        box(`t${i}`, Math.floor(rand() * 13), Math.floor(rand() * 13), 1 + Math.floor(rand() * 12), 1 + Math.floor(rand() * 6)),
      );
      const once = compact(boxes);
      // THE INVARIANT THE WHOLE FEATURE RESTS ON. The layout is compacted on the
      // server when a tile is added, on the client while dragging, and again on
      // every read. If those three disagreed, a board would settle somewhere
      // different from where it was dropped — intermittently.
      expect(compact(once), `seed ${t}`).toEqual(once);
    }
  });

  it("gives the moved tile its row, so a drop is not undone by gravity", () => {
    const boxes = [box("sitting", 0, 0, 6, 4), box("moved", 6, 0, 6, 4)];
    // `moved` is dropped onto row 0 column 0, where `sitting` already is.
    const out = compact([{ ...boxes[1], x: 0, y: 0 }, boxes[0]], GRID_COLS, "moved");
    expect(out.find((b) => b.id === "moved")).toMatchObject({ x: 0, y: 0 });
    // Sabotage: drop the `first` argument and `moved` sorts behind `sitting`
    // (same row, same column, later id), lands under it, and the drag reads as
    // having done nothing at all.
    expect(out.find((b) => b.id === "sitting")!.y).toBe(4);
  });
});

describe("reflow — one saved layout, three renderings", () => {
  const desktop = [
    box("a", 0, 0, 3, 4),
    box("b", 3, 0, 3, 4),
    box("c", 6, 0, 6, 6),
    box("full", 0, 6, 12, 6),
  ];

  it("keeps a full-width tile full width at every column count", () => {
    for (const cols of [12, 6, 1] as const) {
      const out = reflow(desktop, cols);
      expect(out.find((b) => b.id === "full")!.w, `at ${cols} columns`).toBe(cols);
    }
  });

  it("halves widths for the tablet grid and keeps everything inside it", () => {
    const out = reflow(desktop, 6);
    expect(anyOverlap(out)).toBeNull();
    for (const b of out) expect(b.x + b.w).toBeLessThanOrEqual(6);
    // The two quarter-width tiles become thirds and still sit side by side.
    // Sabotage: scale each box's edges independently instead of re-flowing and
    // these land on columns 0-1 and 1-2, overlapping in column one.
    expect(out.find((b) => b.id === "a")).toMatchObject({ x: 0, y: 0, w: 2 });
    expect(out.find((b) => b.id === "b")).toMatchObject({ x: 2, y: 0, w: 2 });
  });

  it("stacks every tile full width on a phone, in the desktop reading order", () => {
    const out = reflow(desktop, 1);
    expect(anyOverlap(out)).toBeNull();
    expect(out.every((b) => b.x === 0 && b.w === 1)).toBe(true);
    expect([...out].sort((p, q) => p.y - q.y).map((b) => b.id)).toEqual(["a", "b", "c", "full"]);
  });

  it("never mutates the layout it was handed", () => {
    // The stored layout is the twelve-column one and a narrow viewport must not
    // be able to touch it. Freezing proves reflow reads rather than writes.
    const frozen = desktop.map((b) => Object.freeze({ ...b }));
    expect(() => reflow(frozen, 6)).not.toThrow();
    expect(desktop[0]).toMatchObject({ x: 0, y: 0, w: 3, h: 4 });
  });

  it("has no inverse, and the module must not grow one", () => {
    /**
     * A six-column layout cannot be widened into the twelve-column one it came
     * from without inventing information. If a future change adds something
     * that looks like it can, the gestures' "desktop only" rule silently stops
     * being enforceable and a phone resize starts overwriting desktop layouts.
     * Pinned as source text because the hazard is an ADDITION, not today's code.
     */
    const src = readFileSync(join(process.cwd(), "src/lib/board/grid.ts"), "utf8");
    expect(src).not.toMatch(/export function (widen|unflow|expand|toDesktop)/);
    expect(src).toMatch(/NEVER WRITTEN BACK/);
  });
});

describe("canvasCells — the properties the CSS actually reads", () => {
  const tiles = [box("a", 0, 0, 3, 4), box("b", 3, 0, 9, 6)];

  it("converts 0-based coordinates to 1-based grid lines", () => {
    const cells = canvasCells(tiles);
    const b = cells.find((c) => c.tile.id === "b")!;
    // Sabotage: drop the `+ 1` and every tile renders one column and one row
    // early — the first column silently disappears off the left of the canvas.
    expect(b.vars["--c12"]).toBe("4 / span 9");
    expect(b.vars["--r12"]).toBe("1 / span 6");
  });

  it("gives every cell all three renderings, because the CSS picks one", () => {
    for (const { vars } of canvasCells(tiles)) {
      expect(Object.keys(vars).sort()).toEqual(["--c1", "--c12", "--c6", "--r1", "--r12", "--r6"]);
    }
  });

  it("returns cells in desktop reading order, which is the tab order at every width", () => {
    // The cells are placed on explicit grid lines, so DOM order does not decide
    // position — it decides which cell Tab reaches next, and that must not
    // change when the window narrows.
    expect(canvasCells(tiles).map((c) => c.tile.id)).toEqual(["a", "b"]);
  });

  it("keeps the pixel pitch the CSS and the resize gesture must agree on", () => {
    // 40 is a row PLUS its gutter, so `grid-auto-rows: 24px` with `gap: 16px`.
    // Sabotage: treat 40 as the row and add the gap on top and every tile grows
    // 16px per row — 64px on a number tile, which reads as a padding bug.
    expect(ROW_UNIT_PX - GRID_GAP_PX).toBe(24);
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toMatch(/grid-auto-rows:\s*24px/);
    expect(css).toMatch(/\.board-canvas\s*\{[^}]*gap:\s*16px/);
  });
});

describe("the module stays usable from the server", () => {
  it("carries no \"use client\", because the add action places tiles with it", () => {
    // The same trap `board-shape.ts` documents: a client module's export becomes
    // a throwing stub in a server component. `addCustomTileAction` compacts on
    // the server so the browser's preview and the stored answer agree.
    const src = readFileSync(join(process.cwd(), "src/lib/board/grid.ts"), "utf8");
    expect(src).not.toMatch(/^\s*"use client"/m);
    expect(src).not.toMatch(/document\.|window\.|Math\.random|Date\.now/);
  });
});
