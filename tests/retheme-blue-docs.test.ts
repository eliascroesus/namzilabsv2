import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PINS THE PROSE THE SAME WAY design-swatches.test.ts PINS THE SWATCHES.
 *
 * BRAND_KIT.md, DESIGN.md and /design have no compiler checking their prose
 * against the tokens they describe — which is exactly how the kit page once
 * showed ultramarine tiles captioned with the old indigo hexes. This file is
 * the doc-prose half of that discipline for the 4 September 2026 blue
 * re-theme: every assertion fails on the OLD claim and passes only once the
 * NEW one is actually written down.
 */
const root = join(__dirname, "..");
const brandKit = () => readFileSync(join(root, "docs/BRAND_KIT.md"), "utf8");

describe("BRAND_KIT.md §1–§2 match the blue re-theme (4 September 2026 Figma)", () => {
  it("principle 1 states three dark surfaces, not one", () => {
    const doc = brandKit();
    expect(doc).not.toMatch(/rail, the top bar and the\s+page are all `#1B191A`/);
    expect(doc).toMatch(/#0F1011/);
    expect(doc).toMatch(/#111111/);
    expect(doc).toMatch(/#181818/);
  });

  it("the brand ramp fills with #0070E8 under #007BFF, not the cyan pair", () => {
    const doc = brandKit();
    expect(doc).toMatch(/#007BFF/);
    expect(doc).toMatch(/#0070E8/);
  });

  it("the neutral ramp names the three new dark steps", () => {
    const doc = brandKit();
    expect(doc).toMatch(/neutral-925/);
    expect(doc).toMatch(/neutral-850/);
    expect(doc).toMatch(/neutral-450/);
  });

  it("the light theme table carries the Figma's light export values", () => {
    const doc = brandKit();
    expect(doc).toMatch(/#F7F8F9/);
    expect(doc).toMatch(/#E1E1E1/);
    expect(doc).toMatch(/#34C759/);
  });

  it("state trios are re-measured against the new dark surfaces", () => {
    const doc = brandKit();
    expect(doc).toMatch(/9\.83:1/);
    expect(doc).not.toMatch(/9\.02:1 on the ground, 7\.93:1 on a card/);
  });
});

describe("BRAND_KIT.md §3–§11 match the blue re-theme", () => {
  it("the tile numeral is 28px and the wordmark is documented", () => {
    const doc = brandKit();
    expect(doc).toMatch(/28px/);
    expect(doc).toMatch(/\.wordmark/);
    expect(doc).toMatch(/weight\s*\*?\*?900/i);
  });

  it("shape is 8px, no pill, and names the Figma as final", () => {
    const doc = brandKit();
    expect(doc).not.toMatch(/Everything you press is a full pill/);
    expect(doc).toMatch(/no pill/i);
    expect(doc).toMatch(/4 September 2026 Figma/);
  });

  it("radius-frame is 8px again, not retired at 0", () => {
    const doc = brandKit();
    expect(doc).not.toMatch(/`--radius-frame` is \*\*0\*\*/);
    expect(doc).toMatch(/`--radius-frame` is \*\*8px\*\*/);
  });

  it("the top bar carries the wordmark, out of the rail", () => {
    const doc = brandKit();
    expect(doc).toMatch(/top bar now carries the wordmark/i);
  });

  it("chart series default to the brand, not the marker", () => {
    const doc = brandKit();
    expect(doc).toMatch(/--color-brand-500/);
    expect(doc).toMatch(/rgb\(0 123 255 \/ \.12\)/);
  });

  it("the enforcement section narrates the cyan-ramp and rounded-full retirements", () => {
    const doc = brandKit();
    expect(doc).toMatch(/two more rows/i);
  });
});

describe("DESIGN.md matches the blue re-theme in lockstep", () => {
  const designMd = () => readFileSync(join(root, "DESIGN.md"), "utf8");

  it("frontmatter names the new accent, not the cyan one", () => {
    const doc = designMd();
    expect(doc).toMatch(/#007BFF/);
    expect(doc).not.toMatch(/accent: one blue \(#00C0E8\)/);
  });

  it("section 2 argues three surfaces, not one", () => {
    const doc = designMd();
    expect(doc).toMatch(/#0F1011/);
    expect(doc).toMatch(/#111111/);
    expect(doc).toMatch(/#181818/);
  });

  it("section 5 names the Figma as the final shape reference", () => {
    const doc = designMd();
    expect(doc).toMatch(/4 September 2026 Figma/);
    expect(doc).not.toMatch(/Everything you press is a full pill; everything you type in is 8px/);
  });

  it("section 6 documents the 28px numeral and the wordmark", () => {
    const doc = designMd();
    expect(doc).toMatch(/28px/);
    expect(doc).toMatch(/\.wordmark/);
  });

  it("the section 10 canvas-bg sentence is no longer self-contradictory", () => {
    const doc = designMd();
    expect(doc).not.toMatch(/keeps its previous value `#1B191A` rather than moving\s+to `#1B191A`/);
    expect(doc).toMatch(/rather than moving to (this pass's )?`#0F1011`/);
  });
});
