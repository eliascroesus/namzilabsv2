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
    // BOTH LAYOUTS, FROM ONE RENDER. The three-zone grid is a `md:` fact
    // now — below the breakpoint this same markup is a column with the title
    // left-aligned, which is a phone's only honest reading of a row that
    // wants a tab strip, a centred name and three buttons on it.
    expect(html).toMatch(/md:grid-cols-\[1fr_auto_1fr\]/);
    expect(html).toMatch(/md:text-center/);
    expect(html).toMatch(/flex flex-col items-stretch/);
    // Source order is tabs, then the title, then the actions — the grid places
    // them left/centre/right by DOM position, not by an `order-*` override.
    const tabsAt = html.indexOf("Views");
    const titleAt = html.indexOf("Dashboard");
    const actionsAt = html.indexOf("+ Add");
    expect(tabsAt).toBeGreaterThan(-1);
    expect(titleAt).toBeGreaterThan(tabsAt);
    expect(actionsAt).toBeGreaterThan(titleAt);
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
    expect(html).toMatch(/items-stretch[^"]*md:grid-cols-\[1fr_auto_1fr\]/);
    expect(html).toMatch(/text-left/);
    // 8px between actions, wrapping rather than overflowing.
    expect(html).toMatch(/flex-wrap[^"]*gap-2/);
    // Actions hug the reading edge below md and the far edge above it.
    expect(html).toMatch(/justify-start[^"]*md:justify-end/);
    // The title stays left below md and centres only once the grid forms.
    expect(html).toMatch(/md:items-center md:text-center/);
  });

  it("spells the h1 recipe exactly once, in one title block shared by both layouts", () => {
    // "The h1 is the ONLY page-title spelling in the product" is a claim the
    // two-branch component used to make false by spelling the class string
    // twice, once per branch. A source count is what actually pins "once".
    const source = read("src/components/ui/page.tsx");
    const matches = source.match(/text-display-xs font-semibold tracking-\[0\.07px\] text-heading/g) ?? [];
    expect(matches.length, "the h1 recipe must appear exactly once in the file").toBe(1);
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
    expect(source).toMatch(/flex min-w-0 items-center overflow-x-auto -mx-1 px-1/);
  });

  it("never gives the title column its own min-w-0", () => {
    // The title column must stay free to demand its natural width — it is
    // the SIDE columns (tabs, actions) that give way when the row is tight,
    // not the title. See the note above PageHeader's return for why.
    const source = read("src/components/ui/page.tsx");
    const titleWrappers = [...source.matchAll(/<HeaderTitle\s[^>]*className="([^"]+)"/g)].map((m) => m[1]);
    expect(titleWrappers.length, "both layouts must render the shared title block").toBeGreaterThanOrEqual(2);
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
