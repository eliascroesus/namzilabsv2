import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MetricCard } from "@/components/metric-card";

/**
 * THE BLUE RETHEME (4 Sep 2026) — the metric card's title goes back to
 * muted, body-weight, and the per-column edge strip stops painting on the
 * default board. Both are facts from the 4 Sep Figma export, pinned here so
 * a future pass cannot silently restore either without a test noticing.
 */
describe("MetricCard, 4 Sep 2026 blue retheme", () => {
  it("renders the title muted at body weight, not full-ink font-medium", () => {
    const html = renderToStaticMarkup(createElement(MetricCard, { title: "Speed To Lead", headline: "44" }));
    const h3Class = html.match(/<h3[^>]*class="([^"]*)"/)?.[1] ?? "";
    expect(h3Class, "the h3 was found").not.toBe("");
    expect(h3Class, "the title carries the muted role").toContain("text-muted-foreground");
    expect(h3Class, "the title is no longer font-medium").not.toContain("font-medium");
  });

  it("paints no --tile-edge strip on the default board's shell", () => {
    const html = renderToStaticMarkup(createElement(MetricCard, { title: "Speed To Lead", headline: "44" }));
    expect(html, "the Figma's default board has no per-column edge on the tile").not.toContain("--tile-edge");
  });

  it("inks the numeral with --heading, which is not --foreground in light", () => {
    /**
     * THE ONE PLACE THE TWO ROLES DIVERGE. In dark they are the same white,
     * so an unset numeral inheriting `--card-foreground` looks correct and
     * nothing catches it. In light `--heading` is #313131 and `--foreground`
     * is pure #000000 — the spec's "numeral 28/40 Inter 600 `--heading`" is
     * a real choice, and inheritance is the wrong answer to it.
     */
    const html = renderToStaticMarkup(createElement(MetricCard, { title: "Speed To Lead", headline: "44" }));
    const numeral = html.match(/<p[^>]*class="([^"]*stat-numeral[^"]*)"/)?.[1] ?? "";
    expect(numeral, "the numeral element was found").not.toBe("");
    expect(numeral).toContain("text-heading");
  });
});
