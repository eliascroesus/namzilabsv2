import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE FIGMA'S HEADER, ASSEMBLED — and the reason this is a source pin
 * rather than a render.
 *
 * `dashboard/page.tsx` is an async server component that awaits the
 * database, the session and a WorkOS membership list before it returns any
 * markup, so rendering it here would test the fixtures rather than the
 * layout. What is being asserted is an ARRANGEMENT — which node goes in
 * which slot — and that is a fact about the source. `PageHeader`'s own
 * three-zone behaviour is render-tested separately in
 * `tests/page-header.test.ts`; this file pins that the dashboard actually
 * asks for it.
 */
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("the dashboard's page header, 4 Sep 2026 blue retheme", () => {
  const page = read("src/app/dashboard/page.tsx");

  it("puts the view strip in the header's tab slot", () => {
    const header = page.slice(page.indexOf("<PageHeader"), page.indexOf("<PageHeader") + 1200);
    expect(header, "the PageHeader call was found").not.toBe("");
    expect(header).toContain("tabs={viewStrip}");
  });

  it("renders the strip once, not once per board", () => {
    // The bug this exists to stop: `tabs` passed AND the boards still
    // rendering their own copy, which draws two tab strips on every view.
    for (const p of ["src/app/dashboard/board-layout.tsx", "src/app/dashboard/custom-board.tsx"]) {
      expect(read(p), `${p} still renders its own view strip`).not.toMatch(/viewStrip/);
    }
    const calendarBranch = page.slice(page.indexOf('{!emptyWorkspace && activeKind === "calendar" ? ('));
    expect(calendarBranch.slice(0, calendarBranch.indexOf("<CalendarBoard"))).not.toMatch(/\{viewStrip\}/);
  });

  it("answers 'what span' with the Figma's dropdown, not six pills", () => {
    expect(page).toContain("<RangeMenu");
    expect(page, "the six-pill track is gone from this page").not.toMatch(/className=\{PERIOD_TRACK\}/);
    expect(page, "and so are its imports").not.toMatch(/PERIOD_PILL/);
  });

  it("dresses that dropdown as a secondary xs control with a 16px calendar glyph", () => {
    const controls = read("src/app/dashboard/board-controls.tsx");
    const menu = controls.slice(controls.indexOf("export function RangeMenu"));
    expect(menu, "RangeMenu was found").not.toBe("");
    expect(menu).toContain('variant="secondary"');
    expect(menu).toContain('size="xs"');
    expect(menu).toContain("[&_svg]:size-4");
    expect(menu).toContain("<CalendarDays");
    expect(menu).toContain("<ChevronDown");
    // The presets are the same six, and they still select through the URL.
    expect(menu).toContain("options.map");
    expect(menu).toContain('dim: "range"');
  });

  it("promotes + Add to the brand fill at the header's own size", () => {
    const custom = read("src/app/dashboard/custom-board.tsx");
    const add = custom.slice(custom.indexOf("function AddChartMenu"));
    expect(add).toContain('variant="accent"');
    expect(add).toContain('size="xs"');
    expect(add).toContain("[&_svg]:size-4");
    expect(add, "the white variant it borrowed is gone from this control").not.toContain('variant="white"');
  });
});
