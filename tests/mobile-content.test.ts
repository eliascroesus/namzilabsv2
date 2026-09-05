import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE PHONE'S CONTENT COLUMN: one board column, a header that stacks, and
 * nothing on any authenticated route wider than the screen.
 *
 * Source pins, like `page-width.test.ts` beside it, and for the same reason:
 * what is being asserted is a BREAKPOINT, which in this codebase is a class
 * and a media query rather than a measurement any renderer here can take.
 */
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const page = read("src/components/ui/page.tsx");
const css = read("src/app/globals.css");

describe("the board is one column below md", () => {
  it("moves the grid's first rung from sm to md", () => {
    /**
     * `sm:grid-cols-2` put two tiles side by side from 640px — inside the
     * band where the rail has already gone and the header has already
     * stacked, on a screen that is a large phone. The rungs above it are
     * unchanged: three columns is still what 1152px is for.
     */
    expect(page).toMatch(/BOARD_GRID = "grid gap-6 md:grid-cols-2 xl:grid-cols-3";/);
    expect(page, "the sm rung must not come back").not.toMatch(/BOARD_GRID = "[^"]*sm:grid-cols-2/);
  });

  it("keeps the canvas's phone rendering at one column, and at 768", () => {
    /**
     * The custom board never had this bug — `grid.ts` computes a 1-column
     * reflow and the stylesheet picks it as the BASE case. It is pinned
     * because it is invisible: the geometry is in custom properties, so a
     * media query edited from 768 to 640 would put six columns on a large
     * phone and every render test would still pass.
     */
    expect(css).toMatch(/\.board-canvas\s*\{[^}]*grid-template-columns:\s*repeat\(1,/);
    expect(css).toMatch(/@media \(min-width: 768px\)\s*\{\s*\.board-canvas\s*\{[^}]*repeat\(6,/);
  });
});

describe("the page header stacks below md", () => {
  const header = page.slice(page.indexOf("export function PageHeader"));

  it("is a column below the breakpoint and a three-zone grid above it", () => {
    expect(header).toContain("flex flex-col items-stretch gap-3 md:grid md:grid-cols-[1fr_auto_1fr]");
    expect(header, "the sm rung belonged to a shell that broke at sm").not.toContain("sm:grid-cols-[1fr_auto_1fr]");
  });

  it("puts the tab strip in its own scroller, not on a second line", () => {
    expect(header).toMatch(/quiet-scroll[^"]*overflow-x-auto[^"]*md:overflow-visible/);
    // …and the strip inside it has to stop wrapping, or it wraps INSIDE the
    // scroller and the scroller never has anything to scroll.
    expect(read("src/app/dashboard/board-controls.tsx")).toMatch(/flex flex-nowrap items-center gap-6 px-1 py-1 md:flex-wrap/);
  });

  it("left-aligns the title on its own line, and centres it only at md", () => {
    expect(header).toContain("items-start gap-2 text-left md:items-center md:text-center");
  });

  it("wraps the actions at 8px", () => {
    expect(header).toContain("flex-wrap items-center justify-start gap-2 md:justify-end");
  });
});

/**
 * NOTHING ON AN AUTHENTICATED ROUTE IS WIDER THAN THE SCREEN.
 *
 * A 390px viewport is the narrowest phone this product has to open on, and
 * one fixed width over it anywhere in a page's own tree pushes the WHOLE
 * document sideways — which is worse than a clipped element, because it
 * moves the chrome too and there is no scroll position that reads correctly.
 *
 * `max-w-[…]` is not a fixed width and is excluded by the lookbehind; a
 * scroller's own inner track is not one either, which is what the allow-list
 * is for. The scan is px-only: this codebase spells every fixed chrome
 * measurement in pixels (56, 60, 280, 310, 640), and a rem width would be a
 * new habit rather than a hole in this rule.
 *
 * `src/components/flow/*` is out of scope by the spec's own non-goals — the
 * builder's canvas is frozen for this re-theme, and it is a panning surface
 * with its own viewport besides.
 */
describe("no authenticated page is wider than a phone", () => {
  const ALLOWED: Record<string, string[]> = {
    // The month sheet: seven columns of a readable width need ~640px, so it
    // scrolls INSIDE its own card (`overflow-x-auto p-3 sm:p-4`) rather than
    // squeezing a number into 40px. The container, not the page, scrolls.
    "src/components/calendar/calendar-board.tsx": ["min-w-[640px]"],
    // Two kit specimens on /design, both `w-[452px] max-w-full` — a panel
    // drawn at its real size on a wide screen and told to shrink below it.
    "src/app/design/page.tsx": ["w-[452px]"],
  };

  const FIXED = /(?<!max-)\b(?:min-w|w)-\[(\d+)px\]/g;

  function tsx(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (full.endsWith(join("components", "flow"))) continue;
        tsx(full, out);
      } else if (entry.endsWith(".tsx")) out.push(full);
    }
    return out;
  }

  it("sets no fixed width over 390px outside the allow-list", () => {
    const offenders: string[] = [];
    for (const file of [...tsx(join(root, "src/app")), ...tsx(join(root, "src/components"))]) {
      const rel = relative(root, file);
      const allowed = ALLOWED[rel] ?? [];
      for (const [cls, px] of readFileSync(file, "utf8").matchAll(FIXED)) {
        if (Number(px) <= 390 || allowed.includes(cls)) continue;
        offenders.push(`${rel}: ${cls}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
