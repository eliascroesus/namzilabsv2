import { describe, expect, it } from "vitest";
import { contrast, luminance } from "./contrast";

/**
 * THE ARITHMETIC THE KIT'S PROSE IS BUILT ON.
 *
 * Every ratio in DESIGN.md and BRAND_KIT.md is a claim, and a claim nothing
 * checks is a claim that drifts — the kit page once showed ultramarine tiles
 * captioned with indigo hexes for exactly that reason. This file pins the
 * calculation itself, so the assertions built on it in `lime-theme.test.ts`
 * and `tile-colour.test.ts` are measuring rather than repeating.
 */
describe("contrast", () => {
  it("is 21:1 for black on white", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("is 1:1 for a colour against itself, whatever its case", () => {
    expect(contrast("#b6ff56", "#B6FF56")).toBeCloseTo(1, 5);
  });

  it("is order-independent", () => {
    expect(contrast("#121214", "#b6ff56")).toBeCloseTo(contrast("#b6ff56", "#121214"), 10);
  });

  it("measures the lime brand on the page at 15.53:1", () => {
    expect(contrast("#b6ff56", "#121214")).toBeCloseTo(15.53, 2);
  });

  it("measures the lime fill under its own near-black ink at 11.59:1", () => {
    expect(contrast("#b6ff56", "#2c2c2c")).toBeCloseTo(11.59, 2);
  });
});

describe("luminance", () => {
  it("is 0 for black and 1 for white", () => {
    expect(luminance("#000000")).toBeCloseTo(0, 6);
    expect(luminance("#ffffff")).toBeCloseTo(1, 6);
  });

  it("applies the sRGB transfer curve, not a naive average", () => {
    // Mid-grey is ~0.216 relative luminance, not 0.5. A naive implementation
    // returns 0.5 here and every ratio built on it is wrong.
    expect(luminance("#808080")).toBeCloseTo(0.2159, 3);
  });
});
