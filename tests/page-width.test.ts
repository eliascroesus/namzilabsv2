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
    // The gutter steps with the viewport: 16px on a phone, 24, 32, then 48 once
    // the content stops being centred in empty canvas and the gutter is the
    // only thing holding it off the frame.
    const gutter = "px-4 py-8 sm:px-6 sm:py-10 lg:px-8 2xl:px-12";
    expect(page).toContain(gutter);
    expect(skeleton).toContain(gutter);
  });

  it("agree that narrow is capped and default is not", () => {
    // A form does not get better wider — `narrow` holds 768px at every
    // viewport. A board does, so `default` carries no max-width at all and the
    // COLUMN COUNT is what steps instead.
    expect(page).toContain('width === "narrow" && "max-w-3xl"');
    expect(skeleton).toContain('width === "narrow" ? "max-w-3xl" : ""');

    // The cap `default` used to carry. If this string comes back to either
    // file, the fill is over and the skeleton/page pair is drifting again.
    expect(page).not.toContain("max-w-6xl");
    expect(skeleton).not.toContain("max-w-6xl");
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

  it("names a breakpoint the stylesheet actually defines", () => {
    // Tailwind v4 emits a variant only for a breakpoint declared in `@theme`.
    // `3xl:` compiles to nothing at all if the token is missing — a silent
    // failure that looks exactly like a grid that simply never gains a column.
    expect(page).toMatch(/BOARD_GRID = "[^"]*3xl:grid-cols-5"/);
    expect(css).toMatch(/--breakpoint-3xl:\s*120rem;/);
  });
});

describe("the calendar's day square", () => {
  const cell = read("src/app/dashboard/calendar/day-cell.ts");
  const loading = read("src/app/dashboard/calendar/loading.tsx");

  it("is one measurement, read by both the sheet and its skeleton", () => {
    // Same mirror problem, smaller: `loading.tsx` draws the same square, and a
    // literal there would go stale the moment the cell grows a rung.
    expect(cell).toMatch(/export const DAY_CELL_H = "min-h-\[92px\] 2xl:min-h-\[116px\] 3xl:min-h-\[140px\]";/);
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
