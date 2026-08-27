import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: (props: any) => createElement("a", { href: props.href, className: props.className }, props.children),
}));
vi.mock("@/app/dashboard/flows/actions", () => ({ refreshFlowAction: async () => {} }));

import { FlowTile, type FlowResultRow } from "@/components/flow-tile";

/**
 * THE GROUPS BOARD DRAWS WHAT IT ALWAYS DREW.
 *
 * `FlowTile` picks its mark from data PRESENCE — series, then groups, then
 * target — and that was safe only because the engine computed a dataset's
 * series exclusively when the publisher had asked for a time chart:
 *
 *     if (spec.timeField && (viz === "line" || viz === "bar") && dataset)
 *
 * The viz clause left that gate so a custom view could choose bar or line
 * later without a republish. Correct for the canvas, and it silently changed
 * the OTHER board: every dataset metric with a time reference suddenly had a
 * series, so tiles that had shown a bare number for months grew a bar chart
 * under it — a solid blue block on a card nobody had asked to change.
 *
 * The condition was never really about whether the DATA should exist. It was
 * about whether this board should DRAW it, which is a render question, so it
 * lives at the render site now. The canvas keeps the series; the groups board
 * looks exactly as it did.
 *
 * `facts.shape` is what separates the two sources of `series`: "dataset" is the
 * branch that widened, "series" is a natively bucketed metric whose sparkline
 * was NEVER viz-gated and must keep drawing.
 */

const row = (tile: Record<string, unknown>): FlowResultRow => ({
  flowId: "f1",
  outputNodeId: "n1",
  tile,
  status: "fresh",
  error: null,
  computedAt: new Date(),
});

const render = (tile: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(FlowTile, { row: row(tile) }));

const SERIES = [
  { bucket: "2026-08-24", value: 4 },
  { bucket: "2026-08-25", value: 8 },
];
const base = { name: "Booked Leads", format: "number", precision: 0, value: 12 };

/** Sparkbars is the only mark that titles its bars with the bucket. */
const drewBars = (html: string) => html.includes("2026-08-25");

describe("a dataset metric the publisher asked to see as a number", () => {
  it("shows no bars, however much series the engine now computes", () => {
    /**
     * THE REGRESSION. Before the gate widened this tile had no `series` at all
     * and rendered a bare number; afterwards the series arrives and presence
     * alone drew it. Sabotage: drop the `facts.shape`/`viz` check in
     * flow-tile.tsx and this fails.
     */
    const html = render({ ...base, viz: "number", facts: { kind: "count", shape: "dataset" }, series: SERIES });
    expect(drewBars(html)).toBe(false);
    expect(html).toContain("12");
  });

  it("still shows them when the publisher DID ask for a time chart", () => {
    for (const viz of ["line", "bar"]) {
      const html = render({ ...base, viz, facts: { kind: "count", shape: "dataset" }, series: SERIES });
      expect(drewBars(html), `viz="${viz}" should still draw its bars`).toBe(true);
    }
  });
});

describe("a metric that is natively a time series", () => {
  it("keeps its sparkline, because that was never gated on the viz", () => {
    // The other source of `tile.series`. Gating the render on `viz` ALONE — the
    // obvious fix — would have quietly stripped these.
    const html = render({ ...base, viz: "number", facts: { kind: "count", shape: "series" }, series: SERIES });
    expect(drewBars(html)).toBe(true);
  });
});

describe("a row stored before facts existed", () => {
  it("draws its series, because having one already meant the viz allowed it", () => {
    /**
     * Backward compatibility, and it falls out rather than being special-cased:
     * under the old engine a dataset-derived series could only exist when the
     * viz was line or bar, so a legacy row carrying one has already passed the
     * test. Absent facts must therefore DRAW, not hide.
     */
    const html = render({ ...base, viz: "number", series: SERIES });
    expect(drewBars(html)).toBe(true);
  });
});

describe("the marks below the series are untouched", () => {
  it("still draws a breakdown, and still draws a goal", () => {
    const groups = render({ ...base, viz: "number", groups: [{ label: "Afeef", value: 7 }] });
    expect(groups).toContain("Afeef");
    const target = render({ ...base, viz: "number", target: 20 });
    expect(target).toContain("Goal");
  });
});
