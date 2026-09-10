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
      //
      // Both files spell the rail on the SCALE now (`w-65`) rather than as an
      // arbitrary `w-[56px]`, so the extractor reads either shape — the claim
      // being made is that the two agree, not how they are spelled.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      // Anchored on the RAIL'S OWN EDGE rather than on the first width in the
      // file. Both files spell the column on the scale now (`w-65`), and a
      // loose `w-(\d+)` scan finds a `w-2` in some unrelated row first — which
      // would compare two numbers that are not the measurement in question and
      // pass or fail for the wrong reason.
      // ANCHORED ON `bg-rail`, NOT ON A BORDER. It was the rail's right rule
      // until 10 Sep 2026, when node 35:5918 turned out to draw none — and a
      // `find` on a class that no longer exists returns undefined and THROWS
      // here, which is at least loud. The fill is the better anchor anyway: a
      // rail without a border is still a rail, a rail without a ground is not.
      // `(?![\w-])` so `bg-rail-control` — the search field, two hundred lines
      // down and carrying `w-full` — cannot answer for the column.
      const rail = code.split("\n").find((l) => /\bbg-rail(?![\w-])/.test(l) && /\bw-\d/.test(l));
      if (!rail) throw new Error("could not find the rail's own edge");
      const m = rail.match(/w-\[(\d+)px\]/) ?? rail.match(/\bw-(\d+)\b/);
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
    // NO `border-b` IN THE PATTERN ANY MORE. The real bar dropped its rule to
    // the board's own row on 10 Sep 2026, so a mirror still matching on one
    // would find nothing and report NOT FOUND rather than a mismatch — the
    // silent-pass shape this file has been bitten by twice.
    expect(band(skeleton, /className="h-(\S+) shrink-0 bg-topbar/, "the skeleton's top bar band")).toEqual(bar);
    /**
     * THE RAIL'S TOP BLOCK LEFT THIS COMPARISON ENTIRELY, in two steps, and the
     * second one is the lesson.
     *
     * It was asserted EQUAL to the bar, because the two sat side by side at the
     * top of the screen: the corner where the rail's right edge met the bar's
     * bottom edge only read as one seam while the block carrying the switcher
     * and the bar beside it were the same height.
     *
     * The frame became a row on 8 Sep — the rail runs full height and the bar
     * begins to its right — so those edges meet in a T, not an L, and there is
     * no corner for a mismatch to show in. The Figma agrees and does not align
     * them: node 58:5828 puts the switcher block at y=14 against a 65px bar.
     * So the assertion was inverted to `.not.toEqual`, which was a mistake of a
     * familiar kind: it kept a brittle SOURCE regex (`className="flex h-…`)
     * alive to make a claim worth almost nothing, and the regex then broke on a
     * class-order change and threw "could not find the rail's top block" — a
     * parse failure wearing the costume of a layout failure.
     *
     * The rail's real rhythm is checked where it can actually be seen:
     * `pnpm geometry` measures the switcher, the search, the caption, the nav
     * rows and the nested view rows against nodes 58:5825/49:5269 in a browser.
     * What stays HERE is the pair this file exists for — the bar and the ghost
     * that stands in front of it.
     */
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
  it("mirrors the rail's ABSENCE of a hairline, and its ground", () => {
    const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    /**
     * THE RULE IS GONE FROM BOTH, AND THAT IS THE ASSERTION NOW.
     *
     * The owner asked for it on 10 Sep 2026 — "remove the stroke line on the
     * left navbar that is to the right, it shouldn't exist" — and node 35:5918
     * agrees: a bare `background: #F3F3F3` with no border of any kind. The
     * frame's own hairline sits 8px away, so a second rule beside it is the
     * double-seam this kit argues against everywhere else.
     *
     * It has to be checked on BOTH sides: a ghost that keeps a rule the frame
     * lost paints a hairline for one frame and then removes it, which is the
     * class of flicker this file exists to catch.
     */
    expect(code(sidebar), "the rail draws no right rule").not.toMatch(/border-r border-rail-border/);
    expect(code(skeleton), "and the ghost does not either").not.toMatch(/border-r border-rail-border/);
    // `hidden` precedes the width — the ghost mirrors the rail's absence below
    // `md` as well as its 260px above it, or the skeleton reserves a column
    // the real chrome will not draw.
    expect(code(skeleton)).toMatch(/hidden w-65[^"]*bg-rail/);
    // AND THE BAR'S BOTTOM EDGE IS GONE TOO, on both sides. Node 35:6027
    // draws no rule; the one hairline in the chrome belongs to the board's own
    // row beneath it (node 35:6044). A ghost that keeps it draws a line for
    // one frame and then removes it.
    expect(code(read("src/components/top-bar.tsx"))).not.toMatch(/<header className="[^"]*border-b border-topbar-border/);
    expect(code(skeleton)).not.toMatch(/border-b border-topbar-border/);
    // What the two must still agree on is the BAND, which the height check
    // above compares — this is the pair that says neither grew a rule back.
    expect(code(skeleton)).toMatch(/h-14[^"]*bg-topbar/);
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
     * THREE CHECKS NOW, NOT ONE — the duplication guard this test opened with,
     * plus the two retired-spelling guards a later pass added beside it rather
     * than in place of it.
     *
     * 1. THE DUPLICATION GUARD, the one this `it`'s name and docblock have
     *    always been about: no file outside `ui/page.tsx` re-types the CURRENT
     *    literal, `md:grid-cols-2 xl:grid-cols-3`, instead of importing
     *    `BOARD_GRID`. This briefly went missing entirely — a fix round found
     *    the filter deleted rather than updated when `BOARD_GRID`'s own value
     *    moved from `sm` to `md`, which silently turned "is spelled once" into
     *    a test that could no longer tell a duplicate from an import.
     * 2. THE OLD COMBINED LITERAL, `sm:grid-cols-2 xl:grid-cols-3` — the exact
     *    shape `BOARD_GRID` replaced — anywhere in `src/`. Specific enough that
     *    no unrelated grid collides with it (see the sabotage note below).
     * 3. A BARE `sm:grid-cols-2` reappearing in a file that already imports
     *    `BOARD_GRID`, which is what "a board grid" concretely means here
     *    rather than a content guess that would also catch `/design`'s
     *    demonstration grids and every unrelated form grid in the product
     *    (`connections/[id]/page.tsx`, `metrics/new/page.tsx`, the brand
     *    sheet's own `sm:grid-cols-2` chip row — none of them a board).
     */
    const scanned = sourceFiles().filter((f) => !f.endsWith(join("components", "ui", "page.tsx")));

    const duplicated = scanned.filter((f) => readFileSync(f, "utf8").includes("md:grid-cols-2 xl:grid-cols-3"));
    expect(duplicated.map((f) => f.slice(root.length + 1)), "BOARD_GRID's literal was re-typed instead of imported").toEqual(
      [],
    );

    const oldLiteral = scanned.filter((f) => readFileSync(f, "utf8").includes("sm:grid-cols-2 xl:grid-cols-3"));
    expect(oldLiteral.map((f) => f.slice(root.length + 1)), "the retired combined literal came back").toEqual([]);

    const boardConsumers = scanned.filter((f) => readFileSync(f, "utf8").includes("BOARD_GRID"));
    expect(boardConsumers.length, "no file imports BOARD_GRID — the parser missed every consumer").toBeGreaterThan(0);
    const bareSmRung = boardConsumers.filter((f) => readFileSync(f, "utf8").includes("sm:grid-cols-2"));
    expect(bareSmRung.map((f) => f.slice(root.length + 1)), "a BOARD_GRID consumer re-spelled the retired sm rung").toEqual(
      [],
    );
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
    // 24px, matching the page gutter and the reference's own grid gap. It was
    // 16: a page inset 24 with its cards 16 apart reads as a grid that does not
    // know how wide its own page is.
    // The first rung is `md` since the 4 September re-theme: below it the
    // rail is not rendered and the header has stacked, so two tiles abreast
    // there is a phone layout pretending to be a tablet one.
    expect(page).toMatch(/BOARD_GRID = "grid gap-6 md:grid-cols-2 xl:grid-cols-3";/);
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
    /**
     * A RATIO PLUS A FLOOR, NOT A HEIGHT. The board runs uncapped, so seven
     * columns are ~158px wide inside 1152px and ~340px on a 2560px display —
     * and a flat 92px against the second is the letterbox slot the flat value
     * was introduced to prevent. 16/9 is within a hair of what the capped page
     * produced by hand (158/92 = 1.72), so it preserves the shape rather than
     * choosing a new one.
     *
     * BOTH BOUNDS ARE LOAD-BEARING, AND THE MECHANISM CARRYING THEM HAS BEEN
     * WRONG TWICE.
     *
     * Uncapped, a 2500px window made each cell ~190px and the grid ~1200px, so
     * the one view whose whole job is to be seen AT ONCE stopped fitting on the
     * screen it had been widened onto. Capped at 132 with a 16/9 ratio it hit
     * the ceiling three-quarters of the way across that same screen, and every
     * cell went on getting wider while its height stood still — a month
     * flattened into letterbox slots.
     *
     * 2/1 up to 176 is the shape that survives both: it keeps growing where
     * there is room, and six rows plus the header and the footnote still clear
     * a 1080px window, which is what a screen that wide actually is. The floor
     * is the opposite end — a phone's ~40px column would give a 20px cell
     * holding a date and a percentage.
     */
    expect(cell).toMatch(/export const DAY_CELL_H = "h-\[clamp\(5\.75rem,8\.5vw,11rem\)\]";/);
    /**
     * NO `aspect-ratio`, AND THAT IS THE ASSERTION THAT MATTERS.
     *
     * `aspect-[2/1] min-h-[92px]` reads as "height follows width, with a floor"
     * and is not what CSS does: when the floor wins, the ratio runs BACKWARDS
     * and derives the WIDTH from it. Each cell demanded 184px, seven of them
     * overflowed the card, and the month grew a horizontal scrollbar with
     * Saturday cut off — which only showed up once the rail could be pinned,
     * because that was the first time the page was narrow enough for the floor
     * to win.
     */
    // CODE, NOT PROSE — the note above the constant explains at length what it
    // stopped doing, and a rule that reads its own gravestone fails forever.
    expect(cell.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/aspect-/);
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

/**
 * THE RAIL HAS ONE MODE NOW, AND THAT IS THE LAYOUT FACT.
 *
 * It had two. Unpinned, the `<aside>` was a flat 56px footprint and the panel
 * inside it OVERLAID, because widening in flow on a pointer-move would
 * re-lay-out every tile on the dashboard as the cursor passed it. Pinned, the
 * aside itself was 260px so the bar and the page were laid out beside it — and
 * the preference had to be a COOKIE read on the server, because the width had
 * to be known in the first paint or the bar and the page snapped sideways a
 * frame later.
 *
 * The 8 September Figma (node 49:5268) draws one width and no toggle. All of
 * that apparatus goes: no cookie, no `railPinned` thread, no overlay, no
 * `peer-hover` chasing the panel's edge. The jump this file exists to catch
 * cannot happen to a constant.
 *
 * These assertions are the RETIREMENT, not just its absence — each one fails
 * if a piece of the old mechanism comes back, which is what stops it being
 * reintroduced by a well-meaning "restore the collapse" change later.
 */
describe("the rail is always open", () => {
  const shell = read("src/components/app-shell.tsx");
  const frame = read("src/components/app-frame.tsx");

  it("carries no pin cookie, on the server or anywhere else", () => {
    const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code(shell)).not.toMatch(/cookies\(\)/);
    expect(code(shell)).not.toMatch(/railPinned/);
    expect(code(frame)).not.toMatch(/railPinned/);
    expect(code(sidebar)).not.toMatch(/document\.cookie/);
  });

  it("has no toggle, and no state for one to drive", () => {
    const code = sidebar.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/aria-pressed=\{pinned\}/);
    expect(code).not.toMatch(/PanelLeftClose|PanelLeftOpen/);
    expect(code).not.toMatch(/setPinned/);
  });

  it("is a flat 260px footprint that the page is laid out beside", () => {
    // `w-65` on the <aside> ITSELF, not on an inner panel: the whole point of
    // the retired overlay was that the panel could be wider than the footprint.
    // If those two ever diverge again the content sits underneath the rail.
    const code = sidebar.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/<aside className="[^"]*\bw-65\b/);
    expect(code).not.toMatch(/w-\[56px\]/);
  });

  it("keeps no overlay apparatus — no absolute panel, no peer chasing its edge", () => {
    const code = sidebar.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/peer group\/rail/);
    expect(code).not.toMatch(/peer-hover:left-65/);
    expect(code).not.toMatch(/hover:w-65|focus-within:w-65/);
  });

  it("reveals nothing, because there is nothing left to reveal", () => {
    const code = sidebar.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/group-hover\/rail/);
    expect(code).not.toMatch(/group-focus-within\/rail/);
    expect(code).not.toMatch(/group-data-\[pinned=true\]\/rail/);
  });
});

/**
 * THE ACCOUNT'S NAME LEFT THE BAR, AND THIS IS WHERE IT SAYS SO.
 *
 * It arrived on 5 September as a fix: the prop had been accepted-and-never-
 * passed through three re-themes, so the bar drew an avatar and a gift with a
 * gap between them, and the chain from `AppShell` to the <span> was asserted
 * here end to end so it could not go missing again.
 *
 * Node 0:5 takes it back out. The reading edge is 480px of SEARCH now, and the
 * frame draws the avatar and the gift alone beside it — there is no room for a
 * name and no line drawn for one. So the prop is gone from `AppFrame` and
 * `TopBar` rather than left accepted and unread, which is the state it spent
 * three re-themes in and the reason it was worth a test at all.
 *
 * Asserted as an ABSENCE, so reinstating the name means deleting this block
 * deliberately rather than finding the old chain half-wired.
 */
describe("the account's name is not in the bar", () => {
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("is not threaded through the frame", () => {
    expect(code(read("src/components/app-frame.tsx"))).not.toMatch(/accountName/);
  });

  it("is not rendered by the bar", () => {
    expect(code(read("src/components/top-bar.tsx"))).not.toMatch(/accountName/);
  });

  it("is not passed by the shell either, so nothing is left half-wired", () => {
    expect(code(read("src/components/app-shell.tsx"))).not.toMatch(/accountName/);
  });
});

describe("the frame's new shape — a full-width bar over [rail | panel]", () => {
  const frame = read("src/components/app-frame.tsx");
  const bar = read("src/components/top-bar.tsx");

  it("renders the rail before the top bar, as a row rather than a column", () => {
    /**
     * REVERSED 8 SEP 2026, AND THE OLD ASSERTION WAS RIGHT UNTIL IT WASN'T.
     *
     * The frame was a column: a full-width bar with [rail | panel] beneath.
     * Both 8 September frames draw the other arrangement, and the metadata is
     * exact about it — in 58:5824 the sidebar is `x=0 y=0 260x1200`, the FULL
     * height of the frame, and the bar is `x=260 y=0 1660x65`, a child of the
     * content column rather than a sibling above it.
     *
     * The symptom of having it backwards was reported as "the navbars are
     * overlapping wrong": the account cluster sat ABOVE the workspace switcher
     * instead of beside it, and the rail began 60px down a screen where the
     * design starts it at zero.
     */
    const code = frame.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code, "a row, so `flex-col` must not come back").toMatch(/className="flex h-dvh bg-background"/);
    expect(code).not.toMatch(/className="flex h-dvh flex-col bg-background"/);
    expect(code.indexOf("<Sidebar")).toBeGreaterThan(-1);
    expect(code.indexOf("<TopBar")).toBeGreaterThan(code.indexOf("<Sidebar"));
  });

  it("insets the panel by 8px on three sides and rounds all four corners", () => {
    // IT WAS ONE CORNER UNTIL 10 SEP 2026 — `rounded-tr-frame` on a panel that
    // ran flush to every edge — and node 35:6024 draws something simpler: a
    // gutter of page on three sides with an ordinary rounded, hairlined box
    // inside it. So the radius is on the BOX now, not on the scroll region.
    expect(frame).toMatch(/md:rounded-frame md:border md:border-border/);
    expect(frame).toMatch(/md:py-frame md:pr-frame/);
    // THE MISSING SIDE IS THE POINT. `pl` would put a strip of page between
    // the rail and the panel and turn one seam into two.
    expect(frame, "the panel butts against the rail; there is no left gutter").not.toMatch(/md:pl-frame/);
    // COMMENTS STRIPPED FIRST — this file's own prose explains what the
    // single corner USED to be, by name, and a bare match reads that as the
    // class still being there. The assertion is about the class list.
    const cls = frame.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(cls, "the single-corner notch must not come back").not.toMatch(/rounded-t[lr]-frame/);
    // The corner only draws if the box clips what the bar paints across it.
    expect(frame).toMatch(/overflow-hidden bg-panel md:rounded-frame/);
  });

  it("hands the rail the workspace and the account it will need for its own switcher", () => {
    const code = frame.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/<Sidebar[^>]*\bworkspace=\{workspace\}/);
    expect(code).toMatch(/<Sidebar[^>]*\baccount=\{account\}/);
    expect(read("src/components/sidebar.tsx")).toMatch(/workspace\?:\s*string/);
  });

  it("carries no wordmark, because the chrome names nothing now", () => {
    // It left, came back at node 0:5, and is deleted again: no 10 September
    // frame draws a product name anywhere in the chrome. The argument that
    // took it off the first time is the one that stands — naming the product
    // in the corner of a product you are already inside says nothing.
    expect(bar).not.toMatch(/\bwordmark\b/);
    expect(bar).not.toMatch(/>\s*Namzilabs\s*</);
  });

  it("stops threading the workspace name into the top bar", () => {
    const props = bar.match(/export function TopBar\(\{([\s\S]*?)\}:/)?.[1] ?? "";
    expect(props).not.toMatch(/\bworkspace\b/);
  });

  it("drops the old identity dropdown along with the workspace group it opened", () => {
    expect(bar).not.toMatch(/DropdownMenu/);
    expect(bar).not.toMatch(/ChevronDown/);
  });

  it("drops the metrics-setup ring, and the whole chain that fed it", () => {
    /**
     * THE FIGMA'S BAR HAS NO RING, and the progress it reported has a better
     * home already: the dashboard's own setup checklist says the same thing
     * with room to say what to do about it. So it goes — and with it the
     * four-file pass-through nobody else was reading, because a prop chain
     * whose only consumer has been deleted is dead weight that still costs a
     * render and still reads as a feature to the next person.
     */
    expect(bar, "the ring's arc is gone").not.toMatch(/METRIC_GOAL/);
    expect(bar, "and its geometry with it").not.toMatch(/RING_RADIUS/);
    expect(bar, "the bar no longer takes a count").not.toMatch(/metricCount/);
    for (const p of ["src/components/app-frame.tsx", "src/components/app-shell.tsx", "src/app/dashboard/page.tsx"]) {
      expect(read(p), `${p} still threads metricCount`).not.toMatch(/metricCount/);
    }
  });
});

describe("the rail's re-dress — a workspace switcher, Main Menu, a search field, Get Free Access", () => {
  it("builds its switcher from workspace and account, not a per-workspace hue", () => {
    expect(sidebar).toMatch(/workspace\?:\s*string/);
    // Post-review fix pass (I1): the flat brand tint moved from
    // `bg-brand-500/75` (2.83:1 white-on-tint in light, under AA) to
    // `bg-primary` (brand-600 solid, 4.68:1 in both themes) — still one flat
    // fill for the one workspace you are in, not `WorkspaceChip`'s
    // per-workspace hue. A bare `/bg-primary/` match would be vacuous here
    // (the token appears throughout the rail — "New flow", the unread badge,
    // the active nav row); the switcher's OWN two discs are counted and
    // anchored to their exact class literal in
    // `tests/console-theme.test.ts` ("draws the workspace switcher's initial
    // on the solid fill, not the translucent tint"), which is where that
    // claim is actually pinned. This test's own remit stays the rail's
    // structure, not the switcher's fill.
    expect(sidebar).not.toMatch(/const PRODUCT = "Namzilabs"/);
  });

  it("sets the switcher's initial at 600, the kit's top weight, not the export's 700", () => {
    // THE WEIGHT LOCK HAS EXACTLY ONE EXCEPTION AND THIS IS NOT IT.
    // `.wordmark` is 900, declared in CSS. Everything else in the product,
    // this badge included, tops out at `font-semibold` — and a badge is
    // precisely where "it is not really prose" would be argued next, so the
    // rule is pinned at the one call site most likely to bend it.
    //
    // Post-review fix pass (I1) re-pointed the fill itself from
    // `bg-brand-500/75 text-white` to `bg-primary text-primary-foreground`
    // (the switcher's own 2.83:1 fix); `tests/console-theme.test.ts` counts
    // both discs and anchors each to that exact fill. This assertion is
    // anchored to the SAME exact literal, both fill and weight together, so
    // a weight-only sabotage (`font-bold`/`font-black` in place of
    // `font-semibold`) fails it directly rather than relying on the
    // whole-file negative check below to catch it by coincidence.
    expect(sidebar).toMatch(/rounded-control bg-primary text-xs font-semibold text-primary-foreground/);
    expect(sidebar, "no heavy weight anywhere in the rail").not.toMatch(/\bfont-(?:bold|black)\b/);
  });

  /**
   * NO SIZE MEANT THE "default" VARIANT'S OWN `px-3` SURVIVED THE MERGE.
   *
   * `cn(SLOT, …)` sets no horizontal padding of its own to cancel it, so an
   * un-sized `<Button variant="ghost">` fell back to `h-8 px-3 text-sm
   * [&_svg]:size-4` and the 28px switcher square landed 12px off `ICON_COL`
   * — 2px past the 56px rail's own edge, clipped. `px-3` itself is never
   * spelled in THIS file — it comes from `buttonVariants`' own `cva` table in
   * `button.tsx`, composed at render time from whichever `size` prop (or its
   * absence) the caller passes — so the only thing checkable here, at the
   * source, is that a `size` was actually given. Scoped to the switcher's own
   * trigger, because `size="iconSm"` and `[&_svg]:size-5` both exist
   * elsewhere in this file too (the search button below, other rows' icons),
   * so a whole-file `toContain` would pass even with this ONE Button left
   * un-sized — which is exactly the bug this exists to catch.
   */
  it("gives the switcher's trigger a size, so the default variant's own px-3 does not survive the merge", () => {
    // Comment-stripped: the restored comment right after `<DropdownMenuTrigger>`
    // explains the fix in prose that itself contains the literal string
    // `size="iconSm"`, which would let this pass even with the prop removed
    // from the actual `<Button>` below it.
    const code = sidebar.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const trigger = code.slice(code.indexOf("<DropdownMenuTrigger asChild>"), code.indexOf("</DropdownMenuTrigger>"));
    expect(trigger).toContain('size="iconSm"');
    expect(trigger).toContain("[&_svg]:size-5");
  });

  /**
   * TWO ICON SIZES A SIZE VARIANT'S OWN `[&_svg]:size-*` WOULD OTHERWISE WIN.
   *
   * A descendant rule beats a plain utility on the element itself for
   * specificity no matter which order the two are written in, so the
   * switcher's chevron (wants `size-5`) and the search field's magnifier
   * (wants `size-[18px]`) both silently rendered at whatever their OWN
   * button's size variant shipped (`size-4` either way) until overridden at
   * the same level, on the button that owns the rule.
   *
   * BOTH CHECKS ARE SCOPED TO THEIR OWN BUTTON, comment-stripped, and for two
   * separate reasons neither may be a whole-file `toContain`: `[&_svg]:
   * size-[18px]` is also `RailChip`'s own rule and the "+" chip's, both
   * unrelated to the search field, so it is already IN this file regardless
   * of whether the search button carries it; and the comments this task just
   * wrote to explain both fixes themselves contain the literal strings being
   * checked for.
   */
  it("overrides both size variants' own icon rule, for the chevron and the magnifier", () => {
    const code = sidebar.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const switcherTrigger = code.slice(code.indexOf("<DropdownMenuTrigger asChild>"), code.indexOf("</DropdownMenuTrigger>"));
    // 20px, up from 12 on 6 Sep 2026 — the export draws this chevron at 24 and
    // 20 is the kit's nearest rung. At 12 the row read as a name with a speck
    // after it rather than as a control.
    expect(switcherTrigger).toContain("[&_svg]:size-5");
    /**
     * RE-POINTED 7 SEP 2026, THE MAGNIFIER HALF ONLY. `[&_svg]:size-[18px]`
     * existed to beat `iconSm`'s own `[&_svg]:size-4`, a descendant rule that
     * wins on specificity whichever order the two are written in. There is no
     * size variant to beat any more: the search row is an `<Input>` and the
     * magnifier is its SIBLING, sized directly. The rail's icon scale is what
     * the pin was really about — 18px, like the seven glyphs below it — so
     * that is what it checks, still scoped to the search control's own slice.
     */
    // The field moved to the bar with node 0:5, so the magnifier is read from
    // `nav-search.tsx`; the chevron above is still the rail's own.
    const searchSrc = read("src/components/sidebar.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
    const searchField = searchSrc.slice(
      searchSrc.indexOf('aria-keyshortcuts="Meta+K"') - 800,
      searchSrc.indexOf('aria-keyshortcuts="Meta+K"') + 300,
    );
    expect(searchField, "the magnifier stands at the same 18px it did in the rail").toMatch(
      /<Search[\s\S]{0,300}size-\[18px\]/,
    );
  });

  it("fills the active row itself with --control, not the 32px chip inside it", () => {
    /**
     * THE SPEC'S OWN WORDS: "nav rows 36px with 18px icons (active row
     * `--control` fill)" — the ROW, not the chip. `--accent` is the HOVER
     * step, a stronger raise reserved for what the pointer is over right
     * now, and it was the fill's first stand-in before `--control` replaced
     * it; both are checked against here so neither regression comes back.
     * A chip raised INSIDE an already-raised row would be one signal drawn
     * twice, which is why the chip (`RailChip`, above) carries no fill of
     * its own at all.
     *
     * THE GLYPH IS WHITE AND FILLED NOW, not `text-marker`. It was the brand
     * stroke, defended as WCAG 1.4.1's second signal; the row's own
     * `--control` fill IS that signal, and it is a SURFACE change rather than
     * a hue anyone has to be able to distinguish. The owner asked for white
     * directly. See `RailChip`.
     */
    expect(sidebar).toContain('className={cn(SLOT, active && "bg-rail-control")}');
    expect(sidebar).toMatch(/tone === "active"\s*\n\s*\? "text-rail-foreground \[&_svg\]:fill-current"/);
    expect(sidebar, "the active glyph must not go back to the brand").not.toMatch(/\? "text-marker"/);
    expect(sidebar, "the fill must not land back on the chip").not.toMatch(/"bg-control text-marker"/);
    expect(sidebar, "the hover step must not come back as the active fill").not.toMatch(/"bg-accent text-marker"/);
  });

  it("leaves WorkspaceChip exactly as it was", () => {
    // Regression: the switcher must not reuse or edit the pinned component.
    const chip = sidebar.match(/export function WorkspaceChip[\s\S]*?\n}/)?.[0] ?? "";
    expect(chip).toMatch(/style=\{\{\s*background: groupBadge\(key\),\s*color: groupInk\(key\)\s*\}\}/);
  });

  it("labels the nav list in the faint role, only", () => {
    expect(sidebar).toMatch(/text-rail-faint/);
    expect(sidebar).toMatch(/Main Menu/);
  });

  it("IS a bordered field now, not a row dressed as one", () => {
    /**
     * RE-POINTED 7 SEP 2026. This asserted `border border-border bg-control`
     * within 200 chars of the shortcut attribute, because the row was a
     * `<Button>` hand-spelling a field's clothes. It is an `<Input>` now — the
     * owner's "why is the search a button and not an input field?" — so the
     * border, the fill and the radius come from the kit's own FIELD recipe and
     * are no longer written in this file at all. Asserting them here again
     * would be asserting a second spelling of `ui/input.tsx`.
     *
     * What replaces it is the fact the old pin was really protecting: this
     * control is a FIELD and not a nav row. A real `<Input>`, carrying the
     * shortcut it announces, with the rail's own row geometry composed in
     * (`SLOT`, so the 44px touch minimum is not re-typed) and its left padding
     * opened for the magnifier standing in the icon column.
     */
    /**
     * RE-POINTED AGAIN, 9 SEP 2026. This asserted the rail's row geometry —
     * `SLOT` for the 44px touch minimum, a left padding opened for a magnifier
     * standing in the icon column. Node 0:5 takes the field out of the rail
     * entirely and draws it in the top bar at 480x40, so there is no row for it
     * to wear. What survives is the fact underneath: it is a real field, it
     * carries the shortcut it announces, and it is not a Button pretending.
     */
    const code = read("src/components/sidebar.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code, "the search is a real field").toMatch(/<input\b[\s\S]{0,600}aria-keyshortcuts="Meta\+K"/);
    // 36px ON THE RAIL'S OWN CONTROL FILL. It was `h-10` on
    // `bg-topbar-control` while the field lived in the bar at node 0:5's
    // 480x40; node 35:5932 draws it 228x36 in the rail, and the fill has to be
    // `--rail-control` there or the two dark modes get a white field with
    // white-on-white text.
    expect(code, "at the frame's 36px, on the RAIL's control fill").toMatch(/h-9[\s\S]{0,400}bg-rail-control/);
    expect(code, "not the bar's fill, which is a different ground").not.toMatch(/bg-topbar-control/);
    expect(code, "and it is no longer a Button pretending").not.toMatch(
      /<Button[^>]*aria-keyshortcuts="Meta\+K"/,
    );
    // THE RAIL DRAWS IT AGAIN, and this line asserted the opposite for a day.
    // The claim that matters is that there is exactly ONE search in the
    // product; `topbar-figma.test.ts` holds the other half (the bar has none).
    expect(sidebar, "the rail owns the announced shortcut").toMatch(/aria-keyshortcuts="Meta\+K"/);
    expect(read("src/components/top-bar.tsx"), "and the bar does not").not.toMatch(/aria-keyshortcuts="Meta\+K"/);
  });

  it("replaces the inert bell row with Get Free Access", () => {
    expect(sidebar).toMatch(/Get Free Access/);
    expect(sidebar).not.toMatch(/Notifications/);
  });

  it("spaces the NAV at 8px and the FOOT at 16, which the export draws apart", () => {
    /**
     * These were both 8. `node-id=14:44` gives the nav block `gap-[8px]` and
     * the foot `gap-[16px]`, and the difference is not arbitrary: the nav is a
     * LIST, where a tight rhythm is what makes seven rows read as one column,
     * and the foot is TWO FILLED BUTTONS, which at 8px apart stack close
     * enough to read as one two-line control.
     *
     * Still a regression guard for console-theme.test.ts's own pin — the two
     * files agree, they just no longer agree on a single number.
     */
    const gaps = [...sidebar.matchAll(/flex[^"]*\bflex-col\b[^"]*\bgap-(\S+)/g)].map((m) => m[1]);
    expect(gaps.length).toBeGreaterThanOrEqual(2);
    for (const g of gaps) expect(["2", "4"], `an off-scale rail column gap: ${g}`).toContain(g);
  });
});

describe("the skeleton mirrors the frame's new order", () => {
  it("holds the rail beside the bar, not under it", () => {
    /**
     * A MIRROR OF THE WRONG SHAPE IS WORSE THAN NO MIRROR. If this file keeps
     * the column while the frame is a row, the rail's ghost starts 60px down,
     * the real rail lands at zero, and the whole page jumps at hydration —
     * exactly the failure this file exists to prevent, caused by the file meant
     * to prevent it.
     */
    const code = skeleton.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/className="flex h-dvh bg-background"/);
    expect(code).not.toMatch(/className="flex h-dvh flex-col bg-background"/);
    // The bar's ghost precedes the rail's ghost in the DOM now.
    // THE ORDER REVERSED WITH THE FRAME. The rail's ghost comes FIRST now —
    // it is a full-height column and the bar is inside the content column
    // beside it, which is what both 8 September frames draw. See
    // `app-frame.tsx`. Asserting the new order is what stops the old shape
    // being restored in one file and not the other.
    // `bg-rail` RATHER THAN `border-r border-rail-border`, because the rail
    // dropped that rule on 10 Sep 2026 (node 35:5918 draws none) and an
    // assertion keyed on a class that no longer exists compares -1 to -1 and
    // passes for the wrong reason. The rail's FILL is the marker now: it
    // cannot go away without the rail going away.
    expect(code.indexOf("bg-rail")).toBeLessThan(code.indexOf("bg-topbar"));
  });

  it("gives its content ghost the same gutter, corner and hairline", () => {
    // If the mirror misses the 8px the real frame takes, the whole panel slides
    // 8px up and left the moment the route lands — the class of jump this
    // mirror exists to prevent, caused by the mirror.
    expect(skeleton).toMatch(/md:py-frame md:pr-frame/);
    expect(skeleton).toMatch(/md:rounded-frame md:border md:border-border/);
    expect(skeleton, "the mirror must not keep a corner the frame dropped").not.toMatch(/rounded-t[lr]-frame/);
  });

  it("puts each ghost on the surface it mirrors — the rail's and the bar's", () => {
    const code = skeleton.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // ONE band of 56, where it was two of 57 and 49. Mirroring the old pair
    // under the new chrome is 50px of content jumping the moment the route
    // lands — the whole failure this mirror exists to prevent.
    expect(code).toMatch(/h-14[^"]*bg-topbar/);
    expect(code, "the old pair must not survive here either").not.toMatch(/h-\[57px\]|h-\[49px\]/);
    expect(code).toMatch(/w-65[^"]*bg-rail/);
  });
});
