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
    // `hidden` precedes the width now — the ghost mirrors the rail's absence
    // below `md` as well as its 56px above it, or the skeleton reserves a
    // column the real chrome will not draw.
    expect(code(skeleton)).toMatch(/hidden w-\[56px\][^"]*border-r border-border/);
    // The bar's bottom edge, and its ghost.
    expect(code(read("src/components/top-bar.tsx"))).toMatch(/<header className="[^"]*border-b border-border/);
    expect(code(skeleton)).toMatch(/h-\[60px\][^"]*border-b border-border/);
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
    // 24px, matching the page gutter and the reference's own grid gap. It was
    // 16: a page inset 24 with its cards 16 apart reads as a grid that does not
    // know how wide its own page is.
    expect(page).toMatch(/BOARD_GRID = "grid gap-6 sm:grid-cols-2 xl:grid-cols-3";/);
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
 * THE RAIL'S TWO MODES, AND WHY THE PINNED ONE IS A LAYOUT FACT.
 *
 * Unpinned, the `<aside>` is a flat 56px footprint and the panel inside it
 * OVERLAYS — widening in flow on a pointer-move would re-lay-out every tile on
 * the dashboard as the cursor passed it.
 *
 * Pinned, the aside itself is 260px, so the top bar and the page are laid out
 * beside it. That is what "expanded" has to mean if the content is not to sit
 * underneath it — and it is why the preference is a COOKIE read on the server
 * rather than localStorage: the width has to be known in the first paint, or
 * the bar and the whole page snap sideways a frame later. That jump is the
 * exact failure this file exists to catch.
 */
describe("the rail's pinned mode", () => {
  const shell = read("src/components/app-shell.tsx");
  const frame = read("src/components/app-frame.tsx");

  it("is read on the server, from a cookie, and threaded to the rail", () => {
    expect(shell).toMatch(/cookies\(\)\)\.get\("rail"\)\?\.value === "pinned"/);
    expect(shell).toMatch(/railPinned=/);
    expect(frame).toMatch(/pinned=\{railPinned\}/);
  });

  it("changes the FOOTPRINT, not just the panel", () => {
    // The panel widening alone is the hover behaviour. If only the inner div
    // grows, a "pinned" rail covers the page instead of making room in it.
    const code = sidebar.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/<aside[\s\S]{0,400}pinned \? "w-65" : "w-\[56px\]"/);
  });

  it("keeps the overlay behaviour when it is NOT pinned", () => {
    const code = sidebar.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/w-\[56px\] hover:w-65 focus-within:w-65/);
  });

  /**
   * THE TOGGLE IS OUTSIDE THE GROUP, AND THAT IS A BEHAVIOUR RULE RATHER THAN
   * A LAYOUT ONE.
   *
   * Pressing a button focuses it. While the toggle sat inside `group/rail`,
   * `group-focus-within` then held the panel open — so collapsing the rail did
   * nothing visible until focus moved, which is indistinguishable from a
   * control that does not work. Measured before the fix: after a collapse the
   * aside was 56 and the panel was still 260.
   *
   * The group belongs to the PANEL, the toggle is its sibling, and the toggle
   * follows the panel's edge through `peer-hover` — which only resolves if the
   * panel PRECEDES it in the DOM. All three facts are asserted, because any one
   * of them alone puts the freeze back.
   */
  it("does not let the toggle hold the rail open", () => {
    const code = sidebar.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // The group is on the panel, not the <aside>.
    expect(code).toMatch(/"peer group\/rail absolute/);
    // The <aside>'s OWN class carries no group — a negative match against the
    // element would always fail, because the panel that DOES carry it is a
    // descendant. This is the aside's class string, asserted whole — and it
    // now also carries the phone layout, because the FOOTPRINT is what has to
    // go below `md`: hiding the panel alone would leave a 56px column of
    // nothing down the left of every phone screen.
    expect(code).toMatch(/"relative z-20 hidden h-full shrink-0 md:block"/);
    // …and the toggle comes after it, or `peer-hover` resolves to nothing.
    expect(code.indexOf("peer group/rail")).toBeLessThan(code.indexOf('aria-pressed={pinned}'));
    expect(code).toMatch(/peer-hover:left-65/);
  });

  /**
   * THE TOGGLE'S OWN ARITHMETIC MOVED WHEN THE BAR DID, AND THE CLASS DID
   * NOT FOLLOW IT.
   *
   * `top-12` centred the 24px toggle on y=60 when the bar sat BESIDE the
   * rail and both started at the page's own y=0. Task 7 put the bar ABOVE
   * this row instead, so the aside's own top edge now IS that seam — and a
   * positive `top-12` inside the aside's frame floats the button ~60px down
   * into the middle of the switcher's own head block instead of on the
   * corner where the bar's rule meets the rail's. Centring on a point that
   * is now the box's own edge takes a NEGATIVE offset: `-top-3` (0 − 12).
   */
  it("centres the toggle on the aside's own top edge now that the bar sits above the row, not beside it", () => {
    const code = sidebar.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/absolute -top-3 z-10 -translate-x-1\/2 rounded-control/);
    expect(code, "the old bar-beside-rail arithmetic must not come back").not.toMatch(/absolute top-12 z-10/);
  });
});

describe("the frame's new shape — a full-width bar over [rail | panel]", () => {
  const frame = read("src/components/app-frame.tsx");
  const bar = read("src/components/top-bar.tsx");

  it("renders the top bar before the rail, as a column rather than a row", () => {
    const code = frame.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/className="flex h-dvh flex-col bg-background"/);
    expect(code.indexOf("<TopBar")).toBeGreaterThan(-1);
    expect(code.indexOf("<Sidebar")).toBeGreaterThan(code.indexOf("<TopBar"));
  });

  it("gives the panel its own surface and a top-RIGHT corner", () => {
    // THE FIGMA ROUNDS THE FAR CORNER, NOT THE NEAR ONE. The panel meets the
    // rail on its left with a hairline and butts square against it; the corner
    // the export softens is the one under the bar at the opposite end. This
    // reverses the shell's own historical `rounded-tl-frame` convention, which
    // is exactly why it is pinned rather than left to a comment.
    expect(frame).toMatch(/rounded-tr-frame bg-panel/);
    expect(frame, "the old top-left notch must not come back").not.toMatch(/rounded-tl-frame/);
  });

  it("hands the rail the workspace and the account it will need for its own switcher", () => {
    const code = frame.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/<Sidebar[^>]*\bworkspace=\{workspace\}/);
    expect(code).toMatch(/<Sidebar[^>]*\baccount=\{account\}/);
    expect(read("src/components/sidebar.tsx")).toMatch(/workspace\?:\s*string/);
  });

  it("moves the wordmark into the bar", () => {
    expect(bar).toMatch(/\bwordmark\b/);
    expect(bar).toMatch(/>\s*Namzilabs\s*</);
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
    expect(sidebar).toMatch(/bg-brand-500\/75/);
    expect(sidebar).not.toMatch(/const PRODUCT = "Namzilabs"/);
  });

  it("sets the switcher's initial at 600, the kit's top weight, not the export's 700", () => {
    // THE WEIGHT LOCK HAS EXACTLY ONE EXCEPTION AND THIS IS NOT IT.
    // `.wordmark` is 900, declared in CSS. Everything else in the product,
    // this badge included, tops out at `font-semibold` — and a badge is
    // precisely where "it is not really prose" would be argued next, so the
    // rule is pinned at the one call site most likely to bend it.
    expect(sidebar).toMatch(/rounded-control bg-brand-500\/75 text-xs font-semibold text-white/);
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
   * trigger, because `size="iconSm"` and `[&_svg]:size-3` both exist
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
    expect(trigger).toContain("[&_svg]:size-3");
  });

  /**
   * TWO ICON SIZES A SIZE VARIANT'S OWN `[&_svg]:size-*` WOULD OTHERWISE WIN.
   *
   * A descendant rule beats a plain utility on the element itself for
   * specificity no matter which order the two are written in, so the
   * switcher's chevron (wants `size-3`) and the search field's magnifier
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
    expect(switcherTrigger).toContain("[&_svg]:size-3");
    const searchButton = code.slice(code.indexOf('aria-keyshortcuts="Meta+K"'), code.indexOf('aria-keyshortcuts="Meta+K"') + 300);
    expect(searchButton).toContain("[&_svg]:size-[18px]");
  });

  it("fills the active row's chip with --control, the search field's own fill, not the hover step", () => {
    // The spec's own words: "nav rows 36px with 18px icons (active row
    // `--control` fill)". `--accent` is the HOVER step, a stronger raise
    // reserved for what the pointer is over right now.
    expect(sidebar).toMatch(/tone === "active"\s*\n\s*\? "bg-control text-marker"/);
    expect(sidebar, "the hover step must not come back as the active fill").not.toMatch(/"bg-accent text-marker"/);
  });

  it("leaves WorkspaceChip exactly as it was", () => {
    // Regression: the switcher must not reuse or edit the pinned component.
    const chip = sidebar.match(/export function WorkspaceChip[\s\S]*?\n}/)?.[0] ?? "";
    expect(chip).toMatch(/style=\{\{\s*background: groupBadge\(key\),\s*color: groupInk\(key\)\s*\}\}/);
  });

  it("labels the nav list in the faint role, only", () => {
    expect(sidebar).toMatch(/text-faint/);
    expect(sidebar).toMatch(/Main Menu/);
  });

  it("dresses the search row as a bordered field, not a nav row", () => {
    const code = sidebar.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/aria-keyshortcuts="Meta\+K"[\s\S]{0,200}border border-border bg-control/);
  });

  it("replaces the inert bell row with Get Free Access", () => {
    expect(sidebar).toMatch(/Get Free Access/);
    expect(sidebar).not.toMatch(/Notifications/);
  });

  it("keeps both rail columns 8px apart", () => {
    // Regression for console-theme.test.ts's own pin — not this file's test,
    // but broken by exactly the kind of edit this task makes if the wrapper
    // gap classes are touched.
    const gaps = [...sidebar.matchAll(/flex[^"]*\bflex-col\b[^"]*\bgap-(\S+)/g)].map((m) => m[1]);
    expect(gaps.length).toBeGreaterThanOrEqual(2);
    for (const g of gaps) expect(g).toBe("2");
  });
});

describe("the skeleton mirrors the frame's new order", () => {
  it("holds the bar above the row, not beside it", () => {
    const code = skeleton.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/className="flex h-dvh flex-col bg-background"/);
    // The bar's ghost precedes the rail's ghost in the DOM now.
    expect(code.indexOf("border-b border-border")).toBeLessThan(code.indexOf("border-r border-border"));
  });

  it("gives its content ghost the panel's own surface and corner", () => {
    expect(skeleton).toMatch(/rounded-tr-frame bg-panel/);
    expect(skeleton, "the mirror must not keep a corner the frame dropped").not.toMatch(/rounded-tl-frame/);
  });

  it("puts the two chrome ghosts on --chrome, matching the real bar and rail", () => {
    const code = skeleton.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/h-\[60px\][^"]*bg-chrome/);
    expect(code).toMatch(/w-\[56px\][^"]*bg-chrome/);
  });
});
