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

describe("/design's specimens and prose reflect the blue re-theme", () => {
  const page = () => readFileSync(join(root, "src/app/design/page.tsx"), "utf8");

  /**
   * THE FIRST TWO ARE REGRESSION PINS, NOT THIS TASK'S OWN RED.
   *
   * The token-layer tasks rewrote the swatch arrays in this same file —
   * they had to, because `design-swatches.test.ts` compares every row's
   * hex against `globals.css` and would have failed the moment a token
   * moved. These assert that they stayed rewritten, which is the thing a
   * docs pass over the same file could plausibly undo.
   */
  it("the brand ramp still carries the new blue steps", () => {
    const src = page();
    expect(src).toMatch(/hex:\s*"#007bff"/);
    expect(src).toMatch(/hex:\s*"#0070e8"/);
  });

  it("the ramps still carry the three new dark steps", () => {
    const src = page();
    expect(src).toMatch(/bg-neutral-925/);
    expect(src).toMatch(/bg-neutral-850/);
    expect(src).toMatch(/bg-neutral-450/);
  });

  it("captions the 450 step where it is printed, since it is neither surface nor prose", () => {
    // The one ink step with a job narrow enough to need saying out loud —
    // and the one a reader would otherwise take for a body-text grey.
    expect(page()).toContain("faint — the caps section label only, 3.70:1 on #111111");
  });

  it("RADII and DIRECTION agree: control is 8px, not a pill", () => {
    const src = page();
    expect(src).not.toMatch(/control · pill/);
    expect(src).toMatch(/control · 8px/);
  });

  it("draws the frame specimen on the panel's top-right corner", () => {
    const src = page();
    expect(src).toMatch(/rounded-tr-frame/);
    expect(src, "the old rail-side notch is gone from the specimen too").not.toMatch(/rounded-tl-frame/);
  });

  it("the headline numeral caption is 28px", () => {
    expect(page()).toMatch(/token:\s*"text-display-md"[^}]*?px:\s*"28px"/);
  });

  it("has no prose left from the charcoal band, the off-white page or the yellow brand", () => {
    /**
     * THE DOC-ROT THIS PAGE ACCUMULATED, PINNED SO IT CANNOT COME BACK.
     *
     * These strings are not near-misses: `#2E2E2E` was the charcoal band,
     * `#F5F5F5` the light page under it, `ink-950` a ramp retired two
     * re-themes ago, and "ONE GREEN, IN THREE SHAPES" a caption for a
     * yellow-and-violet kit. Each described the product accurately at some
     * point and none of them has for months, on the one page whose whole
     * job is to be the reference. "Helvetica Neue" and "14px interface" are
     * the same kind of rot from the docs-fix review: the type note claimed a
     * face `--font-sans` never sets, and the size rule described the
     * pre-15px scale.
     */
    const src = page();
    for (const dead of [
      "#2E2E2E",
      "#F5F5F5",
      "ink-950",
      "ink-900",
      "ink-800",
      "ONE GREEN, IN THREE SHAPES",
      "Pill-first",
      "Helvetica Neue",
      "14px interface",
    ]) {
      expect(src, `"${dead}" is still on the kit page`).not.toContain(dead);
    }
  });
});

describe("STATE.md records the retheme", () => {
  it("has a dated line about the blue console", () => {
    const doc = readFileSync(join(root, "STATE.md"), "utf8");
    expect(doc).toMatch(/4 September 2026/);
    expect(doc).toMatch(/#007BFF/);
  });
});

/**
 * FIX ROUND 1: RATIO AND RULE-COUNT PINS THE DOCS REVIEW ASKED FOR.
 *
 * The prose-only assertions above would not have caught the review's two
 * Critical findings — a stale "thirteen rules" count and a stale 9.20:1
 * cyan-on-#1B191A figure both read as plausible prose and neither
 * regex above touched them. These pin the corrected numbers directly and
 * ban the retired ones outright, so the same drift trips the suite next
 * time rather than waiting for a human re-read.
 */
describe("fix round 1 — ratios and the gate's own rule count are pinned, not just prose", () => {
  it("the fill's white-on-fill ratio is pinned at 4.68:1", () => {
    expect(brandKit()).toMatch(/4\.68:1/);
  });

  it("the dark stroke's ratio on the page is pinned at 6.65:1", () => {
    expect(brandKit()).toMatch(/6\.65:1/);
  });

  it("the light muted-foreground's ratio on the page/panel is pinned at 5.01:1", () => {
    expect(brandKit()).toMatch(/5\.01:1/);
  });

  it("the danger trio's three surface ratios are pinned", () => {
    const doc = brandKit();
    expect(doc).toMatch(/5\.00:1/);
    expect(doc).toMatch(/4\.96:1/);
    expect(doc).toMatch(/4\.66:1/);
  });

  it("the retired cyan-on-#1B191A ratio (9.20:1) does not survive as a CURRENT figure", () => {
    expect(brandKit()).not.toMatch(/9\.20:1/);
    expect(readFileSync(join(root, "DESIGN.md"), "utf8")).not.toMatch(/9\.20:1/);
  });

  it("check-ui.ts's own rule count reads fourteen, not the stale thirteen", () => {
    const doc = brandKit();
    expect(doc).not.toMatch(/gates \*\*thirteen\*\* rules/);
    expect(doc).toMatch(/gates \*\*fourteen\*\* rules/);
  });
});

/**
 * PHONES (5 SEP AMENDMENT): THE DRAWER IS DOCUMENTED, THE OLD §3 IS GONE.
 *
 * Task 15-17's own remit: both docs must describe the phone drawer as the
 * rail's own component tree (not a hand-kept copy), and the §3 rewrite must
 * have actually replaced its old anchor sentence rather than leaving it to
 * sit alongside the new "depth is a mirror" argument.
 */
describe("Phones: both docs document the drawer; the old §3 anchor is retired", () => {
  const designMd = () => readFileSync(join(root, "DESIGN.md"), "utf8");

  it("BRAND_KIT.md §5 describes the drawer as the rail's own component tree", () => {
    const doc = brandKit();
    expect(doc).toMatch(/drawer/);
    expect(doc).toMatch(/RailContent|same component tree/);
  });

  it("DESIGN.md §5 describes the same drawer, built the same way", () => {
    const doc = designMd();
    expect(doc).toMatch(/drawer/);
    expect(doc).toMatch(/RailContent|same component tree/);
  });

  it("DESIGN.md no longer states the retired 'a control recesses' rule", () => {
    expect(designMd()).not.toMatch(/A control recesses; a hover raises\./);
  });
});

/**
 * DOCS-FIX REVIEW ROUND: PRINCIPLE 3 NEVER GOT THE MIRROR REWRITE.
 *
 * A previous fix commit claimed principle 3 was corrected but the diff
 * never touched it — it still read "A control recesses; a hover raises"
 * two sections above where §2 already states the mirror rule. This pins
 * the phrase gone for good, independent of the DESIGN.md pin above.
 */
describe("BRAND_KIT.md principle 3 states the mirror rule, not the recess one", () => {
  it("principle 3 no longer states 'A control recesses; a hover raises.'", () => {
    // Narrower than a bare "A control recesses" match: §2's own retrospective
    // ("the sentence this kit no longer says... 'A control recesses from a
    // card'") legitimately quotes the old wording to explain why it is gone,
    // and a blanket ban would flag that correct, deliberate mention too.
    expect(brandKit()).not.toMatch(/A control recesses; a hover raises\./);
  });
});

/**
 * FINAL PASS, PART 2, ITEM 1: THE TWO NEW ROLES FROM THE CODE PASS ARE
 * ACTUALLY WRITTEN DOWN, AND THE RETIRED CLASS NAMES DO NOT SURVIVE IN PROSE.
 *
 * Part 1 (code) declared --tab-rule, --primary-hover and --primary-active in
 * globals.css and converted every filled-control hover from a literal
 * (hover:bg-brand-500) to the role. A doc that still shows the old class in
 * a code sample, or never mentions the new roles at all, would describe code
 * that no longer exists.
 */
describe("The two new roles from the code pass are documented in every doc", () => {
  const designMd = () => readFileSync(join(root, "DESIGN.md"), "utf8");
  const page = () => readFileSync(join(root, "src/app/design/page.tsx"), "utf8");

  it("BRAND_KIT.md names --tab-rule and --primary-hover", () => {
    const doc = brandKit();
    expect(doc).toMatch(/--tab-rule/);
    expect(doc).toMatch(/--primary-hover/);
  });

  it("DESIGN.md names --tab-rule and --primary-hover", () => {
    const doc = designMd();
    expect(doc).toMatch(/--tab-rule/);
    expect(doc).toMatch(/--primary-hover/);
  });

  it("/design's prose names --tab-rule (or its bridge) and --primary-hover (or its bridge)", () => {
    const src = page();
    expect(src).toMatch(/tab-rule/);
    expect(src).toMatch(/primary-hover/);
  });

  it("no doc's code sample still spells the retired hover:bg-brand-500", () => {
    expect(brandKit()).not.toMatch(/hover:bg-brand-500/);
    expect(designMd()).not.toMatch(/hover:bg-brand-500/);
    expect(page()).not.toMatch(/hover:bg-brand-500/);
  });

  it("BRAND_KIT.md's brand-ramp row for step 400 no longer claims the active tab's rule", () => {
    // The rule is grey (--tab-rule), not the blue stroke this row documents.
    expect(brandKit()).not.toMatch(/`--marker` in `\.dark`\)[^|]*active tab rule/);
  });

  it("DESIGN.md's stroke/fill job table no longer lists the active tab's rule under the stroke", () => {
    const doc = designMd();
    expect(doc).not.toMatch(/a \*\*stroke\*\* \| signal \| links, the focus ring, the active tab's rule \|/);
    expect(doc).toMatch(/--tab-rule/);
  });
});
