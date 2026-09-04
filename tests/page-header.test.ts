import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageHeader } from "@/components/ui/page";

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
    expect(html).toMatch(/grid-cols-\[1fr_auto_1fr\]/);
    expect(html).toMatch(/text-center/);
    // Source order is tabs, then the title, then the actions — the grid places
    // them left/centre/right by DOM position, not by an `order-*` override.
    const tabsAt = html.indexOf("Views");
    const titleAt = html.indexOf("Dashboard");
    const actionsAt = html.indexOf("+ Add");
    expect(tabsAt).toBeGreaterThan(-1);
    expect(titleAt).toBeGreaterThan(tabsAt);
    expect(actionsAt).toBeGreaterThan(titleAt);
  });
});
