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
    // The strip scrolls sideways inside its own box rather than pushing the
    // page — the failure a ~520px control in this row used to cause.
    expect(html).toMatch(/overflow-x-auto/);
    expect(html).toMatch(/text-left/);
    // 8px between actions, wrapping rather than overflowing.
    expect(html).toMatch(/flex-wrap[^"]*gap-2/);
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
