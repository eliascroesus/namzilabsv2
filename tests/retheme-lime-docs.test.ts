import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PINS THE PROSE THE SAME WAY design-swatches.test.ts PINS THE SWATCHES.
 *
 * Replaces `retheme-blue-docs.test.ts`, which did this job for the 4 September
 * blue re-theme and passed on claims that are now false in every particular.
 *
 * BRAND_KIT.md, DESIGN.md and /design have no compiler checking their prose
 * against the tokens they describe — which is exactly how the kit page once
 * showed ultramarine tiles captioned with the old indigo hexes. Every assertion
 * here fails on the OLD claim and passes only once the NEW one is actually
 * written down, so a re-theme cannot be "finished" with the documents still
 * arguing for the colour it replaced.
 */
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const brandKit = () => read("docs/BRAND_KIT.md");
const design = () => read("DESIGN.md");
const designPage = () => read("src/app/design/page.tsx");

describe("BRAND_KIT.md describes the lime theme", () => {
  it("states ONE surface, not three", () => {
    const doc = brandKit();
    expect(doc).toMatch(/#121214/i);
    expect(doc).not.toMatch(/#0F1011/i);
    expect(doc).not.toMatch(/#181818/i);
  });

  it("names the lime brand and the near-black ink it carries", () => {
    const doc = brandKit();
    expect(doc).toMatch(/#B6FF56/i);
    expect(doc).toMatch(/#2C2C2C/i);
    expect(doc).not.toMatch(/#007BFF|#0070E8|#3D9BFF/i);
  });

  it("names the card as the one surface that steps away", () => {
    expect(brandKit()).toMatch(/#191919/i);
  });

  it("records BOTH contrast substitutions with the numbers that condemn them", () => {
    const doc = brandKit();
    // #7E7E7E is 4.33:1 on the card its own titles sit on.
    expect(doc).toMatch(/#828282/i);
    expect(doc).toMatch(/4\.33/);
    // #4A4A4A is 2.11:1 as an inactive tab — below even the graphic bar.
    expect(doc).toMatch(/2\.11/);
  });
});

describe("DESIGN.md owns the reversal rather than quietly rewording", () => {
  it("grounds on #121214 and has retired the three darks", () => {
    const doc = design();
    expect(doc).toMatch(/#121214/i);
    expect(doc).not.toMatch(/#0F1011/i);
  });

  it("carries no blue brand", () => {
    expect(design()).not.toMatch(/#007BFF|#0070E8/i);
  });

  it("says out loud that this is the SECOND reversal of the surface argument", () => {
    // The file argued for one surface, then for three, and now for one again.
    // A reader who cannot tell that the reversal was deliberate will assume
    // the prose is simply stale.
    expect(design()).toMatch(/revers/i);
  });
});

describe("/design stops describing the theme it no longer renders", () => {
  it("carries no blue hexes in its prose", () => {
    expect(designPage()).not.toMatch(/#007BFF|#0070E8|#3D9BFF|#0062CC/i);
  });

  it("carries no three-surface prose", () => {
    expect(designPage()).not.toMatch(/#0F1011|#181818/i);
  });
});
