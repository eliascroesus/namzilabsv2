import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PINS THE PROSE THE SAME WAY design-swatches.test.ts PINS THE SWATCHES.
 *
 * THIS FILE HAS NOW HELD BOTH NAMES, WHICH IS ITSELF THE LESSON. It was
 * `retheme-blue-docs.test.ts` for the 4 September blue, became
 * `retheme-lime-docs.test.ts` on 8 September, and is back under its first name
 * for the 10 September blue (`#568CFF`, nodes 35:5917 / 35:6331 / 35:6745).
 * Each time, the previous version passed on claims that had become false in
 * every particular — which is exactly what it is for: the prose does not
 * fail to compile.
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
  it("names the blue and its near-black ink as the accent", () => {
    const fm = frontMatter();
    expect(fm).toMatch(/#568CFF/i);
    expect(fm).toMatch(/#1F1F1F/i);
  });

  it("carries no retired brand in the values it declares", () => {
    // History may name the lime and the old blues — §2 does, at length, and
    // the tables measuring why the lime needed two values are the most useful
    // paragraphs in the file. The DECLARATION may not.
    expect(frontMatter()).not.toMatch(/#B6FF56|#4F7A00|#007BFF|#0070E8|#3D9BFF/i);
  });

  it("declares the three modes, because there are three now", () => {
    // `mix` is reachable only by choosing it; a front matter that still says
    // "dark + light" is how a mode ships that nobody knows exists.
    expect(frontMatter()).toMatch(/\bmix\b/i);
  });

  it("declares the frame's inset, since the radius alone does not draw it", () => {
    expect(frontMatter()).toMatch(/8px from the page|inset 8px/i);
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

describe("BRAND_KIT.md describes the blue theme", () => {
  it("states ONE surface in its principles, not three", () => {
    const doc = brandKit();
    expect(doc).toMatch(/#121214/i);
    expect(doc).toMatch(/#191919/i);
  });

  it("names the blue brand and the near-black ink it carries", () => {
    const doc = brandKit();
    expect(doc).toMatch(/#568CFF/i);
    expect(doc).toMatch(/#1F1F1F/i);
  });

  it("gives the ramp's every rung the value the stylesheet actually holds", () => {
    // THE FAILURE THIS CATCHES IS A HALF-DONE RE-THEME: the table gets the
    // headline rung and keeps nine stale ones underneath it, which is how the
    // kit page once showed ultramarine tiles captioned with indigo hexes.
    // Read from globals.css so the doc cannot be right about a value the
    // stylesheet no longer has.
    const css = read("src/app/globals.css");
    const doc = brandKit();
    const rungs = [...css.matchAll(/--color-brand-(\d+):\s*(#[0-9a-f]{6})/gi)];
    expect(rungs.length).toBe(10);
    for (const [, step, hex] of rungs) {
      expect(doc, `BRAND_KIT is missing brand-${step} (${hex})`).toMatch(new RegExp(hex, "i"));
    }
  });

  it("no longer presents the lime's fork as the arrangement in force", () => {
    // The lime needed `--marker` to be a DIFFERENT rung on light. The blue
    // does not, and that retirement is the main thing the re-theme bought —
    // so a table still promising a solved-down stroke is the false claim most
    // likely to survive a skim.
    expect(brandKit()).not.toMatch(/one value on dark, a solved-down stroke on light/i);
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
