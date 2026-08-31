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
  it("share one gutter", () => {
    /**
     * 24px, FLAT, AND THE RUNGS ARE GONE.
     *
     * This ran `px-5 py-6 sm:px-8 sm:py-8 lg:px-10` and the note here argued
     * that a flat value asked a 390px window and a 27" display for the same
     * margin. True, and it is the wrong trade for a console: the TOP BAR's
     * inset cannot step (the workspace name would slide sideways as you
     * resize), so every rung was a width at which the page's content and the
     * bar's content stood on two different vertical lines — 16px apart at `lg`,
     * down the whole left edge of every screen.
     *
     * The assertion stays a PAIR because the reason it exists has not changed:
     * the skeleton is a hand-copy of these classes and has drifted from them
     * twice.
     */
    const gutter = "w-full p-6";
    expect(page).toContain(gutter);
    expect(skeleton).toContain(gutter);
    // The old rungs must not creep back into one file and not the other —
    // measured against CODE, because both files explain in prose what they
    // stopped spelling, and a rule that reads its own gravestone fails forever.
    const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const src of [page, skeleton]) expect(code(src)).not.toMatch(/sm:px-8|lg:px-10|2xl:px-24/);
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

  it("reserve the SAME band for the chrome across the top", () => {
    /**
     * THE MIRROR THAT WAS SIMPLY ABSENT — the same failure as the rail's, in
     * the other axis.
     *
     * The skeleton held the column, the wash and the gutter, and no top bar at
     * all, in front of a shell whose content column opens with a 64px bar. So
     * the shimmer stood at the very top of the canvas and the real page landed
     * 64px below it, on every first load of every route: content jumping at the
     * moment the page arrives, which is the one thing a skeleton exists to
     * prevent and the reason this file exists.
     *
     * All three bands are read out of their own files rather than typed here,
     * so they cannot agree with this test while disagreeing with each other.
     * The rail's top block is in the set because the corner where its right
     * edge meets the bar's bottom edge only reads as ONE seam while the block
     * carrying the mark and the bar beside it are the same height.
     *
     * THE HEIGHT IS READ AS A TOKEN, NOT AS A NUMBER — `h-(\S+)` rather than
     * `h-(\d+)`. The band left the spacing scale when the chrome went to 70px:
     * `h-16` is a step and `h-[70px]` is a length, and a reader that only
     * understands steps throws "could not find the top bar's height" the moment
     * one of the three moves — which is a parse failure wearing the costume of
     * a design failure. Reading the token keeps the assertion the honest one:
     * all three say the SAME thing, whatever that thing is spelled like.
     *
     * THERE IS NO FOURTH BAND ANY MORE. The skeleton used to mirror a hairline
     * under the sidebar's head, because the 264px column drew one there. The
     * 70px rail does not — its top block is the same near-black as the rest of
     * the column, and the only line in it is the bar's own, which the skeleton
     * already draws beside it. A test asserting the height of a rule that no
     * longer exists is a test that fails for being right.
     *
     * AND NOW THERE IS NO LINE AT ALL, which is the same lesson a second time.
     * The skeleton's band was matched as `border-b border-chrome-line bg-ink-950`
     * — the bar's own spelling at the time. The charcoal rebrand removed both of
     * the band's internal seams: below the bar is the ground at #f5f5f5 and
     * right of the rail is the same, so each "seam" was a hairline drawn where
     * two different materials already meet, which DESIGN.md §5 says is a rule
     * doing nothing. The export agrees — it closes the bar with #2d2d2d on
     * #2e2e2e, a ratio of 1.005:1, which is not a line, it is the habit of
     * drawing one.
     *
     * The border is out of the pattern rather than made optional. This test
     * measures the HEIGHT the two bands reserve, and every class it names
     * beyond that is a hostage: matching on decoration means a colour change
     * fails an assertion about geometry, and the failure names the wrong thing.
     * `bg-ink-950` stays because it is what identifies the band among the
     * skeleton's several `h-… shrink-0` boxes.
     */
    const band = (src: string, where: RegExp, what: string) => {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const m = code.match(where);
      if (!m) throw new Error(`could not find ${what}`);
      return m[1];
    };
    const topBar = read("src/components/top-bar.tsx");

    // `[^"]*?` before the height: the bar's class list no longer opens with
    // `flex` — it opens with the scoped `dark` that re-inks whatever the flow
    // builder portals into it.
    const bar = band(topBar, /<header className="[^"]*?\bh-(\S+) shrink-0/, "the top bar's height");
    expect(band(skeleton, /className="h-(\S+) shrink-0 border-b/, "the skeleton's top bar band")).toEqual(bar);
    // The rail's top block: the first `flex h-… shrink-0 items-center` in the
    // file. The `<aside>` above it cannot match — its own height is `h-full`
    // and `w-[48px]` sits between that and its `shrink-0`.
    expect(band(sidebar, /className="flex h-(\S+) shrink-0 items-center/, "the rail's top block")).toEqual(bar);
  });

  /**
   * THE HAIRLINES ARE PART OF THE GEOMETRY NOW, WHICH THEY WERE NOT BEFORE.
   *
   * While the chrome was a charcoal band around a light page, both of its
   * internal seams were correctly absent — a rule drawn where two materials
   * already differ by 40 points of luminance is a rule doing nothing. The
   * chrome and the page are the same colour now, so each rule is the only thing
   * marking an edge AND it occupies a pixel the content column does not get.
   *
   * A skeleton that omits either one is a 1px jump at hydration in that axis,
   * which is the exact failure this file exists to catch, so both are asserted
   * on both sides rather than left to the height/width check above.
   */
  it("mirrors both of the chrome's hairlines, which now take real pixels", () => {
    const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // The rail's right edge, and the ghost standing in for it.
    expect(code(sidebar)).toMatch(/border-r border-border/);
    expect(code(skeleton)).toMatch(/w-\[48px\][^"]*border-r border-border/);
    // The bar's bottom edge, and its ghost.
    expect(code(read("src/components/top-bar.tsx"))).toMatch(/<header className="[^"]*border-b border-border/);
    expect(code(skeleton)).toMatch(/h-\[56px\][^"]*border-b border-border/);
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
  /**
   * MOVED OUT OF A ROUTE AND INTO A COMPONENT. The calendar was `/dashboard/
   * calendar`; it is a view KIND now, so the sheet and this constant live in
   * `src/components/calendar/` and the route — `page.tsx` and its `loading.tsx`
   * — is deleted.
   */
  const cell = read("src/components/calendar/day-cell.ts");

  it("is one measurement, spelled once", () => {
    /**
     * THE SKELETON HALF OF THIS TEST IS GONE WITH THE ROUTE, and it is recorded
     * here rather than quietly dropped. It asserted that `loading.tsx` imported
     * the same constant instead of re-spelling `h-[92px]`, because a literal
     * there would go stale the moment the cell grew a rung. There is no
     * `loading.tsx` any more: a view renders inside the dashboard's own page,
     * which has no per-view fallback, and the calendar needs none — every day it
     * can show is already in the payload, which is why it has never had a
     * spinner.
     *
     * What survives is the constant itself, and the guard below, which is the
     * half that was load-bearing.
     */
    expect(cell).toMatch(/export const DAY_CELL_H = "min-h-\[92px\]";/);
    expect(read("src/components/calendar/calendar-board.tsx")).toContain('from "./day-cell"');
  });

  it("lives where the SERVER can read it as a string", () => {
    /**
     * The real hazard, and it fails silently rather than loudly.
     *
     * IT HAS NO SERVER CONSUMER TODAY — `loading.tsx` was deleted with the
     * route — and the guard is kept anyway, deliberately. The constant exists
     * to be shared; the next thing that draws a day square on the server (a
     * skeleton for the calendar view, an export, a printed sheet) will import
     * it, and the failure mode below is invisible in review. A directive added
     * to this file on the day it grows a second consumer is exactly the change
     * nobody would think to question. Cheap guard, silent bug.
     *
     * The original hazard, for the record: a server component interpolating a
     * `"use client"` module's export gets a registered client reference, which
     * for an ESM module is a throwing stub FUNCTION. Putting that in a className
     * does not throw — it stringifies the function, so all 35 day cells shipped
     * a ~264-character class holding `function(){throw ...}` and no height at
     * all.
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
  });
});
