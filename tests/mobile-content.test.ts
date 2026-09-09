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

/**
 * `page` WITH ITS COMMENTS REMOVED — for a check that asks "does this string
 * still appear as LIVE CODE", where the file's own prose about why the string
 * was retired would otherwise trip the check on itself. Block comments only:
 * this file has no `//` line comments carrying a class-shaped string.
 */
const pageCode = page.replace(/\/\*[\s\S]*?\*\//g, "");

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
    // `.board-canvas` need not be the FIRST rule inside the media block — only
    // that it is IN there somewhere with the 6-column rung. Anchoring to
    // "first child of the media query" made this pin brittle to something
    // that has nothing to do with the canvas: any other selector landing
    // ahead of it in the same `@media` block (a phone rule for an unrelated
    // component, say) would fail this test for a reason it does not name.
    const media768 = css.match(/@media \(min-width: 768px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(media768, "the 768px media block was found").not.toBe("");
    expect(media768).toMatch(/\.board-canvas\s*\{[^}]*repeat\(6,/);
  });
});

describe("the page header stacks below md", () => {
  const header = page.slice(page.indexOf("export function PageHeader"));

  it("is a column below the breakpoint and a grid above it, with or without a title", () => {
    /**
     * THE TRACK COUNT IS CONDITIONAL SINCE 8 SEP 2026. `1fr auto 1fr` is what
     * puts a title in the row's TRUE centre no matter how wide the tabs or the
     * actions are. The board stopped passing a title (node 49:5399 puts the
     * name on its own tab), and with nothing to centre the middle track
     * collapses to zero — leaving the two zones pushed apart by two `1fr`
     * columns of dead space, which is the same row arrived at by accident.
     * `1fr auto` says it deliberately.
     *
     * What has NOT changed is the breakpoint or the stacking below it, which
     * is what this file is actually about.
     */
    expect(header).toContain("flex flex-col items-stretch gap-3 md:grid md:items-center md:gap-x-4");
    expect(header, "three tracks when there is a title to centre").toContain('md:grid-cols-[1fr_auto_1fr]');
    expect(header, "two when there is not").toContain('md:grid-cols-[1fr_auto]');
    expect(header, "the sm rung belonged to a shell that broke at sm").not.toContain("sm:grid-cols-[1fr_auto_1fr]");
  });

  it("puts the tab strip in its own scroller, not on a second line — and keeps it scrolling at every width", () => {
    /**
     * `md:overflow-visible` USED TO HAND THE FOCUS RING ITS ROOM BACK ABOVE
     * THE BREAKPOINT, on the reasoning that nothing needs to scroll there.
     * False the moment a view name is long enough to need it: the tabs are
     * `shrink-0` with names up to 60 characters inside a `1fr` track, so one
     * long name at 768–900px pushed a page-level sideways scroll — the exact
     * failure this row exists to prevent, reopened by the `md:` variant that
     * was supposed to be a refinement. `overflow-x-auto` now holds at every
     * width, and the whole file is checked rather than just this header, so a
     * reintroduction anywhere else in `page.tsx` fails here too.
     */
    // Matched against `pageCode` (comments stripped), not `header`: the
    // uncommented `header` slice let this same regex match the explanatory
    // prose above rather than the class — `quiet-scroll` and `overflow-x-auto`
    // both appear in that comment with no `"` between them, so deleting the
    // class from the live `className` left the assertion passing anyway. The
    // full literal is asserted rather than a loose `[^"]*` gap, so a future
    // reordering of the class string cannot reopen the same hole.
    // `-my-1 py-1` joined it: the focus-ring room moved OFF the strip and ON to
    // the scroller, because `overflow-x: auto` forces `overflow-y` to match and
    // padding on the child overflowed this box — Chromium drew a vertical
    // scrollbar for it, a black pill beside the board's "+ Add".
    expect(pageCode).toContain("quiet-scroll -mx-1 -my-1 flex min-w-0 items-center overflow-x-auto px-1 py-1");
    expect(pageCode, "md:overflow-visible must not come back anywhere in page.tsx").not.toMatch(/md:overflow-visible/);
    // …and the strip inside it has to stop wrapping, or it wraps INSIDE the
    // scroller and the scroller never has anything to scroll.
    // No `py-1` on the strip any more — the ring room moved out to the scroller
    // above. What still matters here is `flex-nowrap`.
    expect(read("src/app/dashboard/board-controls.tsx")).toMatch(/flex flex-nowrap items-center gap-6 px-1 md:flex-wrap/);
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
 * BOTH `.ts` AND `.tsx`, not just the latter. `board-shape.ts` spells the
 * board's own `COLUMN_W = "w-[310px]"` as a plain string constant rather than
 * inline in a component's JSX, and a scan that only walked `.tsx` would never
 * open the one file most likely to hold a board's fixed geometry. 310 clears
 * 390 today; the point of widening the scan is that the NEXT literal added to
 * a `.ts` constants file is checked at all.
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

  /**
   * `max-` is excluded because a maximum is a ceiling, not a floor.
   *
   * A BREAKPOINT PREFIX IS EXCLUDED FOR THE SAME KIND OF REASON, and it was
   * added when the top bar took the Figma's 480px search group: every one of
   * Tailwind's min-width breakpoints starts above 390 — `sm` at 640, `md` at
   * 768 — so `md:w-[480px]` provably cannot apply on the phone this rule is
   * protecting. Flagging it asks for an allowlist entry that says "this is
   * fine", which is the sentence the allowlist exists to make people justify.
   *
   * Bare and state prefixes are NOT excluded: `hover:w-[480px]` applies at
   * every width, and is exactly the sort of thing worth catching.
   */
  const FIXED = /(?<!max-)(?<!\b(?:sm|md|lg|xl|2xl):)\b(?:min-w|w)-\[(\d+)px\]/g;

  function tsx(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (full.endsWith(join("components", "flow"))) continue;
        tsx(full, out);
      } else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) out.push(full);
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
