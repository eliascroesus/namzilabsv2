import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SOURCE_LOGOS } from "@/connectors/logos";
import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { brandNeedsDarkInk, sourceStyle } from "@/components/flow/controls/source-style";

/**
 * THE CONNECTOR MARKS — ten real logos and twenty-one pairs of letters, all
 * wearing the same tile.
 *
 * What can go wrong here is not visual, which is why it is worth testing: a
 * path keyed to a source that does not exist renders nothing, a path from the
 * wrong company renders somebody else's brand, and a mark with no contrast
 * against its own tile renders as a blank disc. The first and third are
 * checkable; the second is a judgement recorded in the generator and pinned
 * below.
 */

describe("every logo belongs to a connector", () => {
  it("has no path keyed to a source that does not exist", () => {
    const sources = new Set(CONNECTOR_CATALOG.map((c) => c.source));
    for (const key of Object.keys(SOURCE_LOGOS)) {
      expect(sources, `SOURCE_LOGOS has "${key}", which is not a connector`).toContain(key);
    }
  });

  it("carries a real single-path glyph for each", () => {
    const keys = Object.keys(SOURCE_LOGOS);
    expect(keys.length, "no logos at all — every check here would pass vacuously").toBeGreaterThan(5);
    for (const [source, d] of Object.entries(SOURCE_LOGOS)) {
      // An SVG path starts with a move — ABSOLUTE or relative. Help Scout's
      // begins with a lowercase `m`, which is equally valid and which a `/^M/`
      // check rejected as malformed on the first run.
      expect(d, `${source}'s path does not start with a move command`).toMatch(/^[Mm]/);
      expect(d.length, `${source}'s path is implausibly short`).toBeGreaterThan(40);
    }
  });

  it("does not carry a mark for Fathom", () => {
    /**
     * THE ONE THAT WOULD HAVE BEEN WRONG RATHER THAN MISSING. Simple Icons
     * publishes a "Fathom" icon and it belongs to Fathom ANALYTICS — a
     * different company from the notetaker this connector talks to. A slug
     * that resolves is not the same as a slug that is correct, and putting
     * another company's mark on a customer's integration is worse than two
     * letters.
     */
    expect(SOURCE_LOGOS.fathom, "that icon is Fathom Analytics, a different company").toBeUndefined();
  });

  it("does not carry the wordmarks that are unreadable at list size", () => {
    // Cal.com, Typeform and WooCommerce publish their NAME set in type inside
    // the 24px box. At `SourceMark`'s 20px default each is a grey smudge, and
    // two clear letters beat an illegible logo — the same judgement
    // `brandNeedsDarkInk` encodes about contrast.
    for (const source of ["calcom", "typeform", "woocommerce"]) {
      expect(SOURCE_LOGOS[source], `${source} is a wordmark and should keep its letters`).toBeUndefined();
    }
  });
});

describe("the mark is legible on its own tile", () => {
  it("picks its ink from the brand colour rather than assuming white", () => {
    /**
     * THE BUG THIS FIXED. `SourceMark` said `text-white` unconditionally while
     * `brandNeedsDarkInk` — whose threshold is the exact luminance where white
     * and black are equally legible — was called only by the two MARKETING
     * components. So Mailchimp's `#FFE01B` tile rendered white on yellow at
     * 1.26:1 inside the product: a blank yellow dot that reads as a failed
     * image.
     *
     * Asserted on the source because the decision is a class string, and the
     * arithmetic behind it already has its own test in `brand-ink.test.ts`.
     */
    const mark = readFileSync(join(process.cwd(), "src/components/source-mark.tsx"), "utf8");
    expect(mark, "the mark must compute its ink").toMatch(/brandNeedsDarkInk\(/);
    const code = mark.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    expect(code, "an unconditional text-white is the bug this replaced").not.toMatch(/className=["'`][^"'`]*\btext-white\b/);
  });

  it("names a connector whose tile genuinely needs dark ink, so the rule is doing work", () => {
    // Without at least one, the ink rule could be inverted and every test here
    // would still pass.
    const dark = CONNECTOR_CATALOG.filter((c) => brandNeedsDarkInk(sourceStyle(c.source).color));
    expect(dark.length, "no connector needs dark ink — the rule is untested by the catalogue").toBeGreaterThan(0);
    // Mailchimp is the case the threshold was derived against.
    expect(dark.map((c) => c.source)).toContain("mailchimp");
  });
});

describe("the generated file stays generated", () => {
  it("says so, and names the script that makes it", () => {
    // An edited-by-hand generated file is one that silently diverges from its
    // source the next time somebody runs the generator.
    const file = readFileSync(join(process.cwd(), "src/connectors/logos.ts"), "utf8");
    expect(file).toMatch(/GENERATED by/);
    expect(file).toMatch(/scripts\/fetch-logos\.mjs/);
    expect(file).toMatch(/CC0-1\.0/);
  });
});
