import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * WHAT A TILE SAYS WHEN THE RANGE HAS NO NUMBER.
 *
 * The stored row is a snapshot per range, so a pill added after a tile was last
 * materialized is absent from EVERY board until each flow recomputes. That
 * ordinary state used to render one fixed sentence — "No data for this period."
 * — with the real reason parked in a `title` attribute: every tile in the
 * product claiming the customer had nothing upcoming, when the truth was that
 * nobody had computed it yet.
 *
 * Worse, the branch returned a card of its own ABOVE the error block, so under
 * such a range a FAILING flow rendered as a calm em-dash with no red pill, no
 * reason, no as-of and no Refresh. These tests pin both: the reason is the
 * stored one, and the only thing an unanswered range removes is the number.
 */

vi.mock("next/link", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: (props: any) => createElement("a", { href: props.href, className: props.className }, props.children),
}));
// The tile imports a server action, which reaches for the database and
// `server-only` the moment it is loaded. Nothing here submits a form; what is
// under test is what the tile SAYS.
vi.mock("@/app/dashboard/flows/actions", () => ({ refreshFlowAction: async () => {} }));

import { FlowTile, tileValueForRange, type FlowResultRow } from "@/components/flow-tile";

const COMPUTED_AT = new Date(Date.now() - 2 * 3_600_000);

/** A row exactly as `publishedFlowTiles` hands it over, minus the range asked for. */
const row = (over: Partial<FlowResultRow> = {}): FlowResultRow => ({
  flowId: "f1",
  outputNodeId: "node-abcdef01",
  tile: {
    name: "Meetings booked",
    viz: "number",
    format: "number",
    precision: 0,
    value: 12,
    byRange: { today: { value: 3 }, yesterday: { value: 2 }, all: { value: 12 } },
  },
  status: "fresh",
  error: null,
  computedAt: COMPUTED_AT,
  ...over,
});

const render = (r: FlowResultRow, rangeKey?: string) => renderToStaticMarkup(createElement(FlowTile, { row: r, rangeKey }));

describe("a range the stored tile has no entry for", () => {
  it("says it was never computed, rather than reporting an empty period", () => {
    const html = render(row(), "upcoming");

    expect(html).toContain("Not computed yet");
    // THE REGRESSION: one hard-coded sentence for every reason there can be.
    expect(html).not.toContain("No data for this period.");
  });

  it("renders the stored reason verbatim when the range was computed and had no answer", () => {
    const html = render(
      row({
        tile: {
          name: "Show rate",
          byRange: { upcoming: { unavailable: "Cannot compute a percentage: the denominator is empty for this period." } },
        },
      }),
      "upcoming",
    );

    expect(html).toContain("the denominator is empty for this period");
  });

  it("shows an em-dash, never a 0, and never the flow's own all-time number", () => {
    const html = render(row(), "upcoming");

    expect(html).toContain("—");
    // "No answer for this period" and "the answer is zero" are different facts.
    expect(html).not.toContain(">0<");
    // …and the headline the flow computed over all of history is not this
    // range's answer either — that fallback is the original defect.
    expect(html).not.toContain(">12<");
  });

  /**
   * A number that is missing because its flow BROKE must not read as a number
   * that is missing because the period is empty. Everything except the figure
   * itself stays on the card.
   */
  it("keeps the error text, the status pill and the footer when the flow errored", () => {
    const html = render(
      row({ status: "error", error: "Get data: the connection was revoked." }),
      "upcoming",
    );

    expect(html).toContain("Get data: the connection was revoked.");
    expect(html).toContain("Error");
    expect(html).toContain("Fix in the editor");
    // Provenance and the way out of it: when it was last true, and a recompute.
    expect(html).toContain("2 hr ago");
    expect(html).toContain("Refresh");
    expect(html).toContain("Open");
  });

  /**
   * WITHHOLDING "UP TO DATE" IS THE POINT, not an oversight.
   *
   * The row genuinely is fresh — it was recomputed an hour ago — and saying so
   * on a card whose body reads "not computed yet for this range" states two
   * contradictory things an inch apart, with the reassuring one in green. The
   * freshness marker describes the ROW; the customer asked about a RANGE, and
   * for that there is no answer. Everything that helps them act still renders:
   * what the flow is, that its draft has moved on, when it last ran, and both
   * ways out.
   *
   * The loud states are NOT withheld — an errored row keeps its red pill above
   * (see the test before this one), because "this failed" stays true whichever
   * range is being asked about.
   */
  it("withholds the healthy marker on a range it has no answer for", () => {
    const html = render(row({ unpublished: true }), "upcoming");

    expect(html).not.toContain("Up to date");
    expect(html).toContain("Not computed yet for this range");
    expect(html).toContain("Edited since publishing");
    expect(html).toContain("2 hr ago");
    expect(html).toContain("Refresh");
    expect(html).toContain("Open");
  });

  it("still shows the healthy marker once the range has an answer", () => {
    // The suppression is scoped to the unanswered range, not to the tile.
    const html = render(row({ unpublished: true }), "today");

    expect(html).toContain("Up to date");
    expect(html).not.toContain("Not computed yet");
  });
});

/**
 * The counterweight to all of the above: the three states have to stay three.
 * An answered range renders its own number, and a tile written before ranges
 * existed keeps rendering what it always did — neither may be dragged into the
 * "no answer" path by the branch that now shares a card with them.
 */
describe("a range that was answered", () => {
  it("renders its own number, not the flow's all-time headline", () => {
    const html = render(row(), "today");
    expect(html).toContain(">3<");
    expect(html).not.toContain(">12<");
    expect(html).not.toContain("Not computed yet");
  });

  it("renders zero as zero — an answered empty period is not an unanswered one", () => {
    const html = render(row({ tile: { name: "Meetings booked", value: 12, byRange: { today: { value: 0 } } } }), "today");
    expect(html).toContain(">0<");
    expect(html).not.toContain("Not computed yet");
  });

  it("leaves a tile with no byRange at all showing what it always showed", () => {
    const html = render(row({ tile: { name: "Meetings booked", value: 12 } }), "upcoming");
    expect(html).toContain(">12<");
    expect(html).not.toContain("Not computed yet");
  });
});

/**
 * "COMPARED TO WHAT" HAS NO HONEST ANSWER FOR THE FUTURE.
 *
 * The series delta skips the final bucket because it is still filling and reads
 * the two before it. Under a forward range that rule inverts — the partial
 * bucket is the FIRST one, and the last is the furthest-future complete one —
 * so it dropped the most informative bucket and printed a movement between two
 * arbitrary future weeks beside a headline that is the whole future total.
 */
describe("the delta beside the headline", () => {
  const seriesTile = {
    name: "Meetings booked",
    viz: "bar",
    format: "number",
    precision: 0,
    value: 12,
    byRange: {
      "7d": { value: 12, series: [{ bucket: "2026-08-16", value: 5 }, { bucket: "2026-08-17", value: 4 }, { bucket: "2026-08-18", value: 1 }] },
      upcoming: { value: 30, series: [{ bucket: "2026-08-24", value: 5 }, { bucket: "2026-08-31", value: 10 }, { bucket: "2026-09-07", value: 15 }] },
      today: { value: 3 },
      yesterday: { value: 2 },
    },
  };

  it("shows nothing for a forward range", () => {
    expect(render(row({ tile: seriesTile }), "upcoming")).not.toContain("vs prior");
  });

  // The counterweight: the same tile under a backward range still compares its
  // newest COMPLETE bucket to the one before it, so the test above cannot be
  // satisfied by dropping series deltas altogether.
  it("still compares complete buckets on a backward range", () => {
    expect(render(row({ tile: seriesTile }), "7d")).toContain("vs prior");
  });

  it("still reads Today against Yesterday", () => {
    expect(render(row(), "today")).toContain("vs yesterday");
  });
});

/**
 * THE SORT AND THE CARD MUST AGREE ABOUT WHETHER THERE IS A NUMBER.
 *
 * `tileValueForRange` exists so the dashboard's "Value high→low" group sort
 * ranks tiles by the figure a customer can SEE. That makes it a second reader
 * of the three-state range logic above — the state that once put an all-time
 * figure under the "Today" pill behind a green badge — so these pin the two
 * together rather than trusting them to stay in step.
 *
 * The property, stated once: the helper returns null in exactly the cases the
 * card renders an em-dash.
 */
describe("the value the board sorts on", () => {
  const cases: Array<[string, FlowResultRow, string | undefined]> = [
    ["a range with an entry", row(), "today"],
    ["a range with no entry", row(), "upcoming"],
    ["a range the tile marked unavailable", row({ tile: { ...(row().tile as object), byRange: { today: { unavailable: "No denominator" } } } }), "today"],
    ["no range at all", row(), undefined],
    ["a tile that has never computed", row({ tile: null, status: "error", error: "boom" }), "today"],
  ];

  for (const [name, r, rangeKey] of cases) {
    it(`agrees with the card for ${name}`, () => {
      const html = render(r, rangeKey);
      // The card's em-dash lives in the stat numeral; a real number never does.
      const showsDash = html.includes(">—</p>");
      expect(tileValueForRange(r.tile, rangeKey) == null).toBe(showsDash);
    });
  }

  it("never reports zero for an absent number", () => {
    // An em-dash is not a small number. A sort that treated it as zero would
    // file a broken metric in the middle of a healthy column.
    expect(tileValueForRange(row().tile, "upcoming")).toBeNull();
    expect(tileValueForRange(null, "today")).toBeNull();
  });

  it("prefers the windowed figure over the tile's all-time one", () => {
    // The bug this whole file exists for, asked of the sort instead of the card.
    expect(tileValueForRange(row().tile, "today")).toBe(3);
    expect(tileValueForRange(row().tile, undefined)).toBe(12);
  });
});
