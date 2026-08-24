import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * THE BOARD'S FILTERS, AS THEY ARRIVE.
 *
 * These controls exist to make a press land before the server answers, and the
 * pending half of that can only be seen in a browser. What CAN be pinned here
 * is the half that has to survive without JavaScript at all — and it is the
 * half most easily lost, because the whole point of the component is the
 * `onClick`.
 *
 * A range pill is still an `<a href>` with the range in it: middle-click, copy
 * link, open-in-new-tab and a first paint before hydration all depend on that,
 * and every one of them breaks silently the day someone "simplifies" it into a
 * `<button onClick>`. The rendered markup is the only place that shows.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

import { BoardControls, MetaLine, RangeLink, TileArea } from "@/app/dashboard/board-controls";

// Children go in the props bag rather than as a third argument: these
// components declare `children` as required, and `createElement`'s overloads
// only see the props object.
const board = (children: React.ReactNode) => renderToStaticMarkup(createElement(BoardControls, { children }));

const pill = (key: string, active: string) =>
  createElement(RangeLink, {
    key,
    href: `/dashboard?range=${key}`,
    rangeKey: key,
    activeRange: active,
    className: "pill",
    activeClassName: "is-on",
    idleClassName: "is-off",
    children: key,
  });

describe("the range pills", () => {
  it("render as real links carrying their own range", () => {
    const html = board([pill("today", "7d"), pill("7d", "7d")]);
    expect(html).toContain('href="/dashboard?range=today"');
    expect(html).toContain('href="/dashboard?range=7d"');
  });

  it("mark the server's range as current, and only that one", () => {
    const html = board([pill("today", "7d"), pill("7d", "7d")]);
    // One `aria-current`, on the pill whose key the server rendered — a screen
    // reader otherwise hears seven identical links and no indication of which
    // is on.
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toContain('class="pill is-on">7d');
    expect(html).toContain('class="pill is-off">today');
  });
});

describe("the tile area", () => {
  it("shows the tiles it was given while nothing is in flight", () => {
    const html = board(createElement(TileArea, { count: 3, children: createElement("p", { children: "the real tiles" }) }));
    expect(html).toContain("the real tiles");
    // No skeletons on a settled board — they belong to the pending state alone.
    expect(html).not.toContain("aria-busy");
  });

  it("keeps the board's caption visible until something is pressed", () => {
    const html = board(createElement(MetaLine, { className: "meta", children: "6 metrics" }));
    expect(html).toContain("6 metrics");
    expect(html).not.toContain("opacity-0");
  });
});

describe("a control outside the provider", () => {
  it("fails loudly rather than rendering a link that can never show it is working", () => {
    // The pills and the tile area only work as a pair. A stray one would render
    // as an ordinary anchor that never lights and never skeletons — a
    // regression with no symptom until someone complains the board feels slow
    // again.
    expect(() => renderToStaticMarkup(pill("today", "today"))).toThrow(/inside <BoardControls>/);
  });
});
