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
 * against the tokens they describe — which is how the kit page once showed
 * ultramarine tiles captioned with the old indigo hexes.
 *
 * IT ASSERTS CLAIMS, NOT THE ABSENCE OF STRINGS, and the difference matters
 * here. A first draft of this file banned `#0F1011` from DESIGN.md outright,
 * which would have failed the sentence "the 4 September Figma drew three:
 * #0F1011, #111111, #181818 — this file called that a reversal". That sentence
 * is the most useful one in the section: these documents narrate what changed
 * and why, and a test that forbids naming the past forces the prose to pretend
 * each scheme arrived from nowhere. So the CURRENT claims are pinned where they
 * are made — the front matter, principle 1 — and history is left alone.
 */
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const brandKit = () => read("docs/BRAND_KIT.md");
const design = () => read("DESIGN.md");
const designPage = () => read("src/app/design/page.tsx");

/** DESIGN.md's YAML front matter — where the file states what is true NOW. */
function frontMatter(): string {
  const doc = design();
  const end = doc.indexOf("\n---", 4);
  return doc.slice(0, end === -1 ? 400 : end);
}

describe("DESIGN.md's front matter states the theme in force", () => {
  it("names the lime and its near-black ink as the accent", () => {
    const fm = frontMatter();
    expect(fm).toMatch(/#B6FF56/i);
    expect(fm).toMatch(/#2C2C2C/i);
  });

  it("carries no blue brand in the values it declares", () => {
    // History may name the blue; the declaration may not.
    expect(frontMatter()).not.toMatch(/#007BFF|#0070E8|#3D9BFF/i);
  });

  it("declares one ground and one card, not three surfaces", () => {
    const fm = frontMatter();
    expect(fm).toMatch(/#121214/i);
    expect(fm).toMatch(/#191919/i);
  });

  it("says out loud that this is a reversal, not a stale document", () => {
    // The file argued for one surface, then three, and now one again. A reader
    // who cannot tell the reversal was deliberate will assume the prose is
    // simply out of date.
    expect(design()).toMatch(/second reversal/i);
  });
});

describe("BRAND_KIT.md describes the lime theme", () => {
  it("states ONE surface in its principles, not three", () => {
    const doc = brandKit();
    expect(doc).toMatch(/#121214/i);
    expect(doc).toMatch(/#191919/i);
  });

  it("names the lime brand and the near-black ink it carries", () => {
    const doc = brandKit();
    expect(doc).toMatch(/#B6FF56/i);
    expect(doc).toMatch(/#2C2C2C/i);
  });

  it("does not still call the brand blue", () => {
    expect(brandKit()).not.toMatch(/one blue|the blue brand|blue doing/i);
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

describe("/design stops describing the theme it no longer renders", () => {
  it("carries no blue hexes in its prose", () => {
    // The kit page has no history section — every hex on it is a claim about
    // what the reader is looking at right now.
    expect(designPage()).not.toMatch(/#007BFF|#0070E8|#3D9BFF|#0062CC/i);
  });

  it("carries no three-surface prose", () => {
    expect(designPage()).not.toMatch(/#0F1011|#181818/i);
  });
});
