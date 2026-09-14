import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { parseTileConfig } from "@/lib/board/tile-config";
import { BarsHorizontal } from "@/components/board-charts/bars-horizontal";

/**
 * ORDERING A BREAKDOWN BY ITS LABELS, BOTH WAYS.
 *
 * "By name" only ever sorted one way and did not say which, so an author who
 * wanted Z first had no option and an author who wanted A first had to find out
 * by trying. Two named directions replace it — the spelling every other sort
 * control in the product uses.
 *
 * The rows are asserted through the RENDERED mark rather than by calling a
 * sorter, because the sorting lives inside the component: a unit test of a
 * helper would have kept passing while the component ignored the new value.
 */
const FMT = { format: "number" as const, precision: 0 };
const GROUPS = [
  { label: "Charlie", value: 5 },
  { label: "alpha", value: 9 },
  { label: "Bravo", value: 1 },
];

/** The row labels in the order the mark actually drew them. */
function drawn(sort: string): string[] {
  const html = renderToStaticMarkup(
    createElement(BarsHorizontal, { groups: GROUPS, format: FMT, accent: "#000", sort: sort as never }),
  );
  return [...html.matchAll(/data-tip="([^"·]+) ·/g)].map((m) => m[1].trim());
}

describe("ordering a breakdown by name", () => {
  it("runs A to Z, ignoring case so 'alpha' is not exiled below 'Charlie'", () => {
    // `localeCompare` with sensitivity "base" — a case-sensitive sort puts every
    // capitalised label above every lower-case one, which reads as random.
    expect(drawn("label_asc")).toEqual(["alpha", "Bravo", "Charlie"]);
  });

  it("runs Z to A, which had no option at all", () => {
    expect(drawn("label_desc")).toEqual(["Charlie", "Bravo", "alpha"]);
  });

  it("leaves the value orders alone", () => {
    expect(drawn("value_desc")).toEqual(["alpha", "Charlie", "Bravo"]);
    expect(drawn("value_asc")).toEqual(["Bravo", "Charlie", "alpha"]);
    expect(drawn("stored")).toEqual(["Charlie", "alpha", "Bravo"]);
  });
});

describe("the stored config", () => {
  it("accepts the new direction, so a tile set to Z–A survives a reload", () => {
    expect(parseTileConfig({ sort: "label_desc" })).toEqual({ sort: "label_desc" });
  });

  it("still refuses an order nothing implements", () => {
    // The negative half: without it the line above proves only that SOMETHING
    // parsed, and a schema quietly accepting any string would read as green.
    expect(parseTileConfig({ sort: "by_vibes" })).toEqual({});
  });
});
