import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PageHeader } from "@/components/ui/page";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * THE THIRD ZONE, AND THE PROMISE THE OTHER SEVENTEEN CALL SITES GET FOR
 * FREE: passing no `tabs` prop must render exactly the header this kit has
 * always drawn — title left, actions right, `justify-between`. Only a caller
 * that opts in with `tabs` gets the Figma's centred-title row.
 */
describe("PageHeader's title, with and without a tab strip beside it", () => {
  it("keeps the original two-zone layout when no tab strip is passed", () => {
    const html = renderToStaticMarkup(
      createElement(PageHeader, { title: "Settings", actions: createElement("button", null, "Save") }),
    );
    expect(html, "the three-zone grid must not appear uninvited").not.toMatch(/grid-cols-\[1fr_auto_1fr\]/);
    expect(html).toMatch(/justify-between/);
  });

  it("centres the title between the tab strip and the actions when both are given", () => {
    const html = renderToStaticMarkup(
      createElement(PageHeader, {
        title: "Dashboard",
        tabs: createElement("nav", null, "Views"),
        actions: createElement("button", null, "+ Add"),
      }),
    );
    /**
     * THERE IS NOTHING TO CENTRE ANY MORE. This asserted a three-track grid
     * with the name in the middle; the name is the top bar's now, so the row
     * is the tab strip and the actions. The third track returns only for a
     * LEDE, which is the one thing left that can sit between them — asserted
     * in its own case below, so this one cannot pass by accident.
     *
     * Below the breakpoint it is still a stacked column, which is a phone's
     * only honest reading of the row.
     */
    expect(html).toMatch(/md:grid-cols-\[1fr_auto\]/);
    expect(html).toMatch(/flex flex-col items-stretch/);
    // Source order is tabs, then the title, then the actions — the grid places
    // them left/centre/right by DOM position, not by an `order-*` override.
    /**
     * TWO ZONES NOW, NOT THREE. The title moved into the top bar, so the row
     * carries the tab strip and the actions and nothing between them — and the
     * name is not in this markup AT ALL, because `TopBarTitle` is a portal and
     * a portal with no target renders nothing on the server.
     */
    const tabsAt = html.indexOf("Views");
    const actionsAt = html.indexOf("+ Add");
    expect(tabsAt).toBeGreaterThan(-1);
    expect(actionsAt).toBeGreaterThan(tabsAt);
    expect(html).not.toContain("Dashboard");
  });

  it("stacks below md: a scrolling tab strip, a left title, wrapping actions", () => {
    const html = renderToStaticMarkup(
      createElement(PageHeader, {
        title: "Dashboard",
        tabs: createElement("nav", null, "Views"),
        actions: createElement("button", null, "+ Add"),
      }),
    );
    /**
     * THE TWO GENERIC ASSERTIONS THIS TEST OPENED WITH — `overflow-x-auto`
     * and `flex-wrap … gap-2` — passed before Task 20's header rewrite and
     * kept passing after it, which means neither one actually pinned
     * anything Task 20 changed: `overflow-x-auto` matches the tab strip's
     * scroller regardless of which row it stacks under, and a bare
     * `flex-wrap` + `gap-2` says nothing about which edge the actions
     * align to. A fix round SUPPLEMENTED them rather than deleting them —
     * removing an assertion that still holds, even a weak one, is the same
     * "never delete, re-point" violation as removing a wrong one — with the
     * tokens the rewrite actually introduced: the row's own
     * `items-stretch`/`md:grid-cols-[1fr_auto_1fr]` flip, the actions'
     * `justify-start`/`md:justify-end` flip, and the title's
     * `md:items-center md:text-center` pair — so a revert of any one of
     * them fails here rather than only in a screenshot.
     */
    expect(html).toMatch(/overflow-x-auto/);
    expect(html).toMatch(/items-stretch[^"]*md:grid-cols-\[1fr_auto\]/);
    // 8px between actions, wrapping rather than overflowing.
    expect(html).toMatch(/flex-wrap[^"]*gap-2/);
    // Actions hug the reading edge below md and the far edge above it.
    expect(html).toMatch(/justify-start[^"]*md:justify-end/);
    /**
     * THE CENTRED-TITLE PAIR WENT WITH THE TITLE. `text-left` and
     * `md:items-center md:text-center` belonged to the middle cell, which the
     * top bar owns now — so the row is two tracks, and asserting three would
     * pin the layout bug this change had to fix: with a title passed and no
     * title drawn, the ACTIONS were landing in the centre track.
     */
    expect(html).toMatch(/md:grid-cols-\[1fr_auto\]/);
    expect(html).not.toMatch(/md:grid-cols-\[1fr_auto_1fr\]/);
  });

  it("gives the middle track back to a lede, which is what can still sit there", () => {
    // The counterpart to the two-track assertions above: three tracks are not
    // dead, they are the lede's. Without this, "two tracks" would pass on a
    // header that had lost the ability to centre anything at all.
    const html = renderToStaticMarkup(
      createElement(PageHeader, {
        title: "Dashboard",
        lede: "What this page is for.",
        tabs: createElement("nav", null, "Views"),
        actions: createElement("button", null, "+ Add"),
      }),
    );
    expect(html).toMatch(/md:grid-cols-\[1fr_auto_1fr\]/);
    expect(html).toContain("What this page is for.");
    expect(html).toMatch(/md:items-center md:text-center/);
  });

  it("spells the page title exactly once in the product, and it is the bar's", () => {
    /**
     * THE CLAIM SURVIVES THE MOVE; ONLY ITS ADDRESS CHANGED. It used to be "the
     * 26px h1 appears once in page.tsx rather than once per layout branch".
     * The title is the TOP BAR's now, so the recipe has left this file
     * altogether and lives once in `topbar-slots.tsx` — which is the same
     * promise, and the reason the board and every other route are identical by
     * construction instead of by two files agreeing on a type scale.
     */
    const page = read("src/components/ui/page.tsx");
    expect(page).not.toMatch(/text-display-xs font-semibold tracking-\[0\.07px\] text-heading/);
    // …and `PageHeader` reaches the bar rather than spelling a heading of its own.
    expect(page).toMatch(/<TopBarTitle>\{title\}<\/TopBarTitle>/);
    expect(page).not.toMatch(/<h1/);

    /* COMMENTS STRIPPED FIRST — `topbar-slots.tsx` discusses the `<h1>` twice
       in prose, and counting those would have made this assert "three page
       titles" about a file with one. Same treatment `page-width.test.ts` gives
       its own source reads. */
    const bar = read("src/components/topbar-slots.tsx")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const h1s = bar.match(/<h1\b/g) ?? [];
    expect(h1s.length, "the product's one page-title element").toBe(1);
  });

  it("lets the tab strip scroll inside its own container, with room for the focus ring at both ends", () => {
    // The spec's Mobile section requires the tab strip to scroll in its own
    // overflow container rather than push the page into horizontal scroll —
    // the same failure mode `actions`' own `min-w-0` note already guards
    // against for the OTHER two columns of this row. `-mx-1`/`px-1` around
    // the scroller is the same compensation `app/dashboard/page.tsx`'s period
    // track already uses: a bare `overflow-x-auto` clips the first and last
    // child's focus ring, so without it a keyboard user tabbing to the first
    // or last tab loses its outline exactly when they reach it.
    const source = read("src/components/ui/page.tsx");
    // The ring room is `-my-1 py-1` on THIS element now rather than on the strip
    // inside it — see `ui/page.tsx`. Both axes are spelled the same way here:
    // padding inside the scrolling box, negative margin outside it.
    expect(source).toMatch(/-mx-1 -my-1 flex min-w-0 items-center overflow-x-auto px-1 py-1/);
  });

  it("never gives the middle column its own min-w-0", () => {
    // It must stay free to demand its natural width — it is the SIDE columns
    // (tabs, actions) that give way when the row is tight. The block is the
    // LEDE's now that the title is the bar's, and the rule is unchanged: see
    // the note above PageHeader's return.
    const source = read("src/components/ui/page.tsx");
    const titleWrappers = [...source.matchAll(/<HeaderLede\s[^>]*className="([^"]+)"/g)].map((m) => m[1]);
    expect(titleWrappers.length, "both layouts must render the shared block").toBeGreaterThanOrEqual(2);
    for (const cls of titleWrappers) {
      expect(cls, "the title column must not get min-w-0").not.toMatch(/\bmin-w-0\b/);
    }
  });
});

/**
 * THE CANVAS HARNESS NEEDS THE SAME PORTAL TARGET THE DASHBOARD OFFERS.
 *
 * `custom-board.tsx` looks up `#canvas-add-chart` by id with
 * `document.getElementById` and portals its own "+ Add" button and popover
 * into whatever it finds — see `dashboard-page-header.test.ts`'s pins on the
 * dashboard side of that contract. `/design/canvas` renders `CustomBoard`
 * through `CanvasHarness` rather than through the dashboard page, and the
 * harness had no header at all, so the portal's target resolved to nothing
 * and "+ Add" silently failed to render on that page — the one place this
 * kit's own canvas can be exercised without a session.
 */
describe("the design canvas harness offers CustomBoard the + Add portal target", () => {
  it("renders a div with id canvas-add-chart", () => {
    const source = read("src/app/design/canvas/harness.tsx");
    expect(source).toMatch(/id="canvas-add-chart"/);
  });
});
