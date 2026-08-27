import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE PAGE'S WIDTH IS WRITTEN IN TWO FILES, AND THEY HAVE ALREADY DRIFTED
 * TWICE.
 *
 * `PageContainer` is the real thing; `ShellSkeleton` is a hand-copied mirror of
 * it that stands in front of a streaming page. It cannot simply RENDER a
 * PageContainer — that component is `<main id="main">` and carries `rise-in`,
 * and a fallback must not put a second main landmark in the document nor
 * animate in only to animate in again when the real page lands. So the classes
 * are duplicated on purpose, and nothing but this file keeps them honest.
 *
 * Its own comment records both drifts: once when the responsive pass moved the
 * gutter and the rail, and again when the boards began filling the viewport and
 * the skeleton kept a cap the page had dropped. Each time the symptom was the
 * same and is the one thing a skeleton exists to prevent — content jumping
 * sideways at the moment the real page arrives.
 *
 * These are TEXT assertions against source files rather than render tests, for
 * the same reason `canvas-tokens.test.ts` and `chrome-band.test.ts` are: the
 * failure being guarded is two files disagreeing, which no amount of rendering
 * one of them can catch.
 */
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const page = read("src/components/ui/page.tsx");
const skeleton = read("src/components/shell-skeleton.tsx");
const sidebar = read("src/components/sidebar.tsx");
const css = read("src/app/globals.css");

/**
 * The first real statement in a module, comments and blank lines stripped.
 * `"use client"` only means anything in that position.
 */
function firstStatementOf(src: string): string {
  return (
    src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? ""
  );
}

/** Every .tsx/.ts under src/, so a new call site cannot dodge the sweep. */
function sourceFiles(dir = join(root, "src"), out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("the page container and the skeleton that stands in for it", () => {
  it("share one gutter, rung for rung", () => {
    // 16px on a phone, 24 from `sm`, 32 from `lg`. A flat value asked a 390px
    // window and a 27" display for the same margin.
    const gutter = "px-4 py-8 sm:px-6 sm:py-10 lg:px-8";
    expect(page).toContain(gutter);
    expect(skeleton).toContain(gutter);
  });

  it("agree on both caps, so the shimmer stands where the page will", () => {
    /**
     * BOTH widths are capped, and the page does not chase the window. This
     * briefly ran uncapped on `default` — the boards filled the viewport and
     * gained columns — and it was reverted: a layout that reflows on every
     * resize gives no stable picture of a dashboard, and the tiles changed size
     * depending on which monitor you opened it on. Notion is the reference; the
     * content column is a fixed measure with real margin either side.
     *
     * The pair is asserted TOGETHER because the skeleton is a hand-copy of the
     * page's classes (it cannot render PageContainer — that is `<main
     * id="main">` and carries `rise-in`), and it has drifted from it twice.
     */
    // `full` is the board's own exception — a grid of fixed-size cards gains
    // COLUMNS as the window grows, which is the one page where chasing the
    // viewport is right. The two capped widths are unchanged.
    expect(page).toContain('width === "narrow" ? "max-w-3xl" : width === "full" ? "" : "max-w-6xl"');
    expect(skeleton).toContain('width === "narrow" ? "max-w-3xl" : "max-w-6xl"');

    // The uncapped spelling. Its return means the fill is back and the pair is
    // out of step with the kit again.
    expect(page).not.toMatch(/width === "narrow" && "max-w-3xl"/);
    expect(skeleton).not.toContain('"max-w-3xl" : ""');
  });

  it("reserve the SAME width for the sidebar", () => {
    /**
     * THE JOLT THIS FILE CLAIMED TO PREVENT, AND DIDN'T.
     *
     * The skeleton reserved `w-[76px] sm:w-[100px]` against a rail that is
     * `w-[84px] sm:w-[124px]`, so the content column was 8px too wide on a
     * phone and 24px too wide on a desktop until the real route landed — and
     * then everything slid sideways. The suite pinned the gutter and both caps
     * and never once compared the third measurement the two files share.
     *
     * Read out of each file rather than typed here, so the pair cannot agree
     * with this test while disagreeing with each other.
     */
    const railWidth = (src: string) => {
      // Comments stripped first. Prose explaining the rule is not the rule —
      // the notes on both sides quote widths, and an unstripped scan reads the
      // first number it finds rather than the one in force.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const m = code.match(/w-\[(\d+)px\]/);
      if (!m) throw new Error("could not find a sidebar width");
      return m[1];
    };
    expect(railWidth(skeleton)).toEqual(railWidth(sidebar));
  });
});

describe("the board grid", () => {
  it("is spelled once, and every board reads it from there", () => {
    /**
     * The dashboard's tiles, the flows board and the connector catalogue are
     * one decision, and they were three literals plus two more copies in the
     * skeletons standing in front of them. Five spellings for one rhythm is the
     * drift `check:ui` exists to catch everywhere else in the app.
     *
     * The rule is narrow on purpose: it bans the exact old board literal, not
     * `sm:grid-cols-2` in general — `/design` demonstrates grids as kit
     * specimens and is not a board.
     */
    const offenders = sourceFiles()
      .filter((f) => !f.endsWith(join("components", "ui", "page.tsx")))
      .filter((f) => readFileSync(f, "utf8").includes("sm:grid-cols-2 xl:grid-cols-3"));

    expect(offenders.map((f) => f.slice(root.length + 1))).toEqual([]);
  });

  it("stops at three columns, and names no breakpoint the stylesheet lacks", () => {
    /**
     * Three is what 1152px is for: four tiles inside it are 270px each, which
     * is narrower than the numeral they exist to carry.
     *
     * The `2xl`/`3xl` rungs this briefly had are gone with the uncapped
     * container that justified them — and so is `--breakpoint-3xl`. Tailwind v4
     * emits a variant only for a breakpoint declared in `@theme`, so a `3xl:`
     * class left behind after the token went would compile to nothing at all:
     * a silent failure that looks exactly like a grid that never gains a
     * column. Asserting both directions keeps the class and the token from
     * outliving each other in either order.
     */
    expect(page).toMatch(/BOARD_GRID = "grid gap-4 sm:grid-cols-2 xl:grid-cols-3";/);
    expect(page).not.toMatch(/BOARD_GRID = "[^"]*3xl:/);
    expect(css).not.toMatch(/--breakpoint-3xl:/);
  });
});

describe("the calendar's day square", () => {
  const cell = read("src/app/dashboard/calendar/day-cell.ts");
  const loading = read("src/app/dashboard/calendar/loading.tsx");

  it("is one measurement, read by both the sheet and its skeleton", () => {
    // Same mirror problem, smaller: `loading.tsx` draws the same square, and a
    // literal there would go stale the moment the cell grows a rung.
    expect(cell).toMatch(/export const DAY_CELL_H = "min-h-\[92px\]";/);
    expect(read("src/app/dashboard/calendar/CalendarBoard.tsx")).toContain('from "./day-cell"');
    expect(loading).toContain('from "./day-cell"');
    // The literal it replaced. Its return means the two have parted again.
    expect(loading).not.toContain("h-[92px] rounded-card");
  });

  it("lives where the SERVER can read it as a string", () => {
    /**
     * The real hazard, and it fails silently rather than loudly.
     *
     * `loading.tsx` is a server component — the route is `force-dynamic` and
     * has a loading.tsx, so the fallback is server-rendered on every request.
     * A `"use client"` module's exports are not values on the server: Next's
     * flight loader swaps each one for a registered client reference, which
     * for an ESM module is a throwing stub FUNCTION. Interpolating that into a
     * className does not throw — it stringifies the function, so all 35 day
     * cells ship a ~264-character class holding `function(){throw ...}` and no
     * height at all.
     *
     * This constant briefly lived in CalendarBoard.tsx, which is `"use
     * client"`, and did exactly that. The rule it now follows is the one
     * `src/components/flow/panel-chrome.tsx` already documents for
     * PANEL_SHELL: a constant shared across the boundary lives in a module
     * with no directive.
     *
     * Checked at the DIRECTIVE POSITION rather than by searching the file for
     * the phrase: a directive is only a directive as the first statement, and
     * the module above discusses `"use client"` in prose at length. A test that
     * cannot tell the two apart fails on its own documentation.
     */
    expect(firstStatementOf(cell)).not.toMatch(/^["']use client["']/);
    expect(loading).not.toContain('from "./CalendarBoard"');
  });
});
