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
    // Anchored past the component name — the bare word `RangeMenu` also
    // matches a typo like `RangeMenuXXX`, which a sabotage pass on the
    // original substring check found does not fail it.
    expect(page).toMatch(/<RangeMenu[\s/>]/);
    expect(page, "the six-pill track is gone from this page").not.toMatch(/className=\{PERIOD_TRACK\}/);
    expect(page, "and so are its imports").not.toMatch(/PERIOD_PILL/);
  });

  it("dresses that dropdown as a secondary control at the kit's one height, with a 16px calendar glyph", () => {
    const controls = read("src/app/dashboard/board-controls.tsx");
    const menu = controls.slice(controls.indexOf("export function RangeMenu"));
    expect(menu, "RangeMenu was found").not.toBe("");
    expect(menu).toContain('variant="secondary"');
    // RE-POINTED 6 SEP 2026: `xs` (24px/12px) is deleted from the size table.
    // It made this trigger shorter and quieter than the top bar's buttons.
    // The default rung is 32px at 14px and brings `[&_svg]:size-4` with it,
    // so both the size prop and the icon override are gone.
    expect(menu, "no retired xs rung").not.toContain('size="xs"');
    expect(menu, "and no override of a class the rung already sets").not.toContain("[&_svg]:size-4");
    expect(menu).toContain("<CalendarDays");
    expect(menu).toContain("<ChevronDown");
    // The presets are the same six, and they still select through the URL.
    expect(menu).toContain("options.map");
    expect(menu).toContain('dim: "range"');
  });

  it("draws each preset as a real link, not a radio item with no href", () => {
    /**
     * FIXED IN THE FIRST REVIEW ROUND. `DropdownMenuRadioItem` renders a
     * `role="menuitemradio"` div with an `onSelect` handler — no `href`,
     * so a modifier-click, a middle-click or "open in a new tab" all did
     * nothing, and a no-JS viewer got a menu that opened onto nothing.
     * `RangeLink`'s own comment defended exactly this for the pill track
     * this menu replaced; the dropdown's items owe the same defence, which
     * is why each one is `asChild` around a real `next/link` `Link` reading
     * `href={o.href}`.
     */
    const controls = read("src/app/dashboard/board-controls.tsx");
    const menu = controls.slice(controls.indexOf("export function RangeMenu"), controls.indexOf("export function ViewStrip"));
    expect(menu, "each item is a real anchor").toMatch(/<Link\s+href=\{o\.href\}/);
    expect(menu, "the radio group it replaced is gone").not.toContain("DropdownMenuRadioGroup");
    expect(menu, "and so is the radio item").not.toContain("DropdownMenuRadioItem");
    expect(menu, "the active preset says so to assistive tech").toContain('aria-current={isActive ? "true" : undefined}');
  });

  it("promotes + Add to the brand fill at the header's own size", () => {
    const custom = read("src/app/dashboard/custom-board.tsx");
    const add = custom.slice(custom.indexOf("function AddChartMenu"));
    expect(add).toContain('variant="accent"');
    // RE-POINTED 6 SEP 2026 with its two neighbours: "the header's own size"
    // is the kit's one control height now, not the deleted `xs` rung.
    expect(add, "no retired xs rung").not.toContain('size="xs"');
    expect(add, "and no override of a class the rung already sets").not.toContain("[&_svg]:size-4");
    expect(add, "the white variant it borrowed is gone from this control").not.toContain('variant="white"');
  });

  it("co-locates + Add, Today and Refresh All in the header, + Add gated to the canvas board", () => {
    /**
     * FIXED IN THE FIRST REVIEW ROUND, WHICH FOUND THE FIGMA'S THREE HEADER
     * ACTIONS SPLIT ACROSS TWO PLACES: "+ Add" was still inline in
     * `custom-board.tsx`'s own row, and Refresh all was still in the retired
     * `boardActions`. All three now render from `PageHeader`'s own `actions`
     * slot, in the Figma's order — "+ Add", "Today", "Refresh All" — and
     * "+ Add" is a header-only placeholder gated on the active view being a
     * canvas, since the groups board and the calendar offer no `AddChartMenu`.
     */
    const actionsStart = page.indexOf("actions={");
    // Sliced to the tag's own close (`\n        />`) rather than a guessed
    // byte count, so a comment growing past an arbitrary window does not
    // silently stop finding Refresh all.
    const header = page.slice(actionsStart, page.indexOf("\n        />", actionsStart));
    const addAt = header.indexOf('id="canvas-add-chart"');
    const rangeAt = header.indexOf("<RangeMenu");
    const refreshAt = header.indexOf("action={refreshAllFlowsAction}");
    expect(addAt, '"+ Add"\'s header slot was found').toBeGreaterThan(-1);
    expect(rangeAt, "the Today dropdown was found").toBeGreaterThan(-1);
    expect(refreshAt, "Refresh all was found").toBeGreaterThan(-1);
    expect(addAt, "+ Add comes before Today").toBeLessThan(rangeAt);
    expect(rangeAt, "Today comes before Refresh All").toBeLessThan(refreshAt);
    // Gated: the placeholder only appears for the canvas board.
    expect(header.slice(Math.max(0, addAt - 200), addAt)).toMatch(/activeKind === "custom" &&/);
  });

  it("draws + Add through the Slot portal, not as a bare inline row", () => {
    /**
     * The call site to `<AddChartMenu>` is supposed to still exist — its own
     * state (`picking`/`busy`/`addTile`) lives in `CustomBoard`, so the
     * component is instantiated there and only its rendered output portals
     * into the header. What must be true is that the ONE call is wrapped by
     * the `Slot`, and that there is only one — a leftover second copy sitting
     * inline in the old action row is the regression this guards.
     */
    const custom = read("src/app/dashboard/custom-board.tsx");
    const beforeDefinition = custom.slice(0, custom.indexOf("function AddChartMenu"));
    expect(beforeDefinition, "the call is wrapped by the canvas-add-chart Slot").toMatch(
      /<Slot id="canvas-add-chart">\s*<AddChartMenu/,
    );
    const calls = beforeDefinition.match(/<AddChartMenu\s/g) ?? [];
    expect(calls.length, "AddChartMenu is instantiated exactly once").toBe(1);
  });

  it("collapses the + Add target to nothing when it stays empty", () => {
    /**
     * A GROUPS BOARD AND A CALENDAR LEAVE THIS DIV EMPTY, and before this it
     * still took up room: `flex items-center` gives an empty div no content
     * but keeps its box, so the actions zone reserved space for a button that
     * a viewer without `create_flows` (or a non-canvas board) never gets.
     * `empty:hidden` is Tailwind's `:empty` variant — it drops the div from
     * layout entirely the moment it has no children, and restores it the
     * instant `CustomBoard` portals `AddChartMenu` into it.
     */
    const target = page.slice(page.indexOf('id="canvas-add-chart"'), page.indexOf('id="canvas-add-chart"') + 120);
    expect(target).toMatch(/className="[^"]*\bempty:hidden\b[^"]*"/);
  });
});
