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

  it("carries a real, drawable mark for each", () => {
    const keys = Object.keys(SOURCE_LOGOS);
    expect(keys.length, "no logos at all — every check here would pass vacuously").toBeGreaterThan(5);
    for (const [source, logo] of Object.entries(SOURCE_LOGOS)) {
      /**
       * THE viewBox IS PER MARK NOW, and it is checked because it used to be
       * hard-coded to 24×24 in two components. Whop's is `0 0 383.2 196.4`;
       * a mark whose box is wrong is not subtly off, it is a sliver or a
       * smear.
       */
      expect(logo.viewBox, `${source}'s viewBox is not four numbers`).toMatch(/^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/);
      const [, , w, h] = logo.viewBox.split(" ").map(Number);
      expect(w, `${source}'s viewBox has no width`).toBeGreaterThan(0);
      expect(h, `${source}'s viewBox has no height`).toBeGreaterThan(0);

      expect(logo.paths.length, `${source} has no paths`).toBeGreaterThan(0);
      for (const { d, fill } of logo.paths) {
        // An SVG path starts with a move — ABSOLUTE or relative. Help Scout's
        // begins with a lowercase `m`, which is equally valid and which a
        // `/^M/` check rejected as malformed on the first run.
        expect(d, `a ${source} path does not start with a move command`).toMatch(/^[Mm]/);
        /**
         * A SHAPE, NOT A STRAY MOVE — counted in POINTS.
         *
         * The bar was `length > 40`, a proxy for "a real glyph" from when every
         * mark was one dense 24×24 silhouette. Official art breaks it twice
         * over: Google Sheets' folded corner is a legitimate 32 characters, and
         * counting letters instead fails on the same path, because
         * `M 42,0 64,22 53,24 42,22 40,11 Z` is five points drawn with two
         * command letters — a moveto followed by implicit linetos, which is
         * both valid and what real exporters emit. Numbers are what a shape is
         * actually made of.
         */
        const points = d.match(/-?\d*\.?\d+/g) ?? [];
        expect(points.length, `a ${source} path has too few coordinates to be a shape`).toBeGreaterThan(5);
        /**
         * EITHER PAINTABLE OR OFFICIAL, never something in between. A fill of
         * `currentColor` says "this is a silhouette, paint it with the brand's
         * colour"; a hex says "this is the vendor's own art, do not touch it".
         * Anything else — a colour name, a gradient reference, `none` — would
         * be silently dropped or silently wrong by `BrandLogo`.
         */
        expect(fill, `${source} has a fill that is neither currentColor nor a literal colour: ${fill}`).toMatch(
          // `rgba()` is here for Airtable, whose published mark carries its own
          // drop shadow at 25% black. Keeping that path is what 1:1 means — the
          // slabs read flat without it.
          /^(currentColor|#[0-9a-fA-F]{3,6}|rgba?\([\d.,\s]+\))$/,
        );
      }
    }
  });

  it("does not mix a painted path into an official one", () => {
    /**
     * A mark is one kind or the other. Mixing them means `logoColor` paints
     * SOME of a logo with the catalogue's single brand colour and leaves the
     * rest as the vendor drew it — a Google Calendar whose frame is official
     * and whose numeral is Google-blue-darkened-to-pass-3:1. That renders as
     * "nearly right", which is the hardest kind of wrong to notice.
     */
    for (const [source, logo] of Object.entries(SOURCE_LOGOS)) {
      const kinds = new Set(logo.paths.map((p) => (p.fill === "currentColor" ? "painted" : "official")));
      expect(kinds.size, `${source} mixes painted and official fills`).toBe(1);
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
    /**
     * Cal.com, Typeform and WooCommerce publish their NAME set in type inside
     * the box. At `SourceMark`'s 20px default each is a grey smudge, and two
     * clear letters beat an illegible logo — the same judgement
     * `brandNeedsDarkInk` encodes about contrast.
     *
     * RE-CHECKED 16 Sep 2026, because the owner supplied official files for
     * Cal.com and WooCommerce and it would have been easy to just take them.
     * Both were extracted and rendered at 64px, at the real 20px, and on a dark
     * card before deciding: Cal.com is a dark disc whose "Cal" is unreadable at
     * product size and which nearly vanishes on `#151515`, and WooCommerce's
     * "WOO COMMERCE" is a grey bar. Five of the seven marks he sent that day
     * WERE taken — Close, Pipedrive, Attio, JustCall and Customer.io — so this
     * is a measurement, not a policy.
     */
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

describe("the marks say where they came from", () => {
  it("names its provenance and does not over-claim the licence", () => {
    /**
     * THIS USED TO ASSERT THE FILE WAS "GENERATED by scripts/fetch-logos.mjs"
     * and carried a blanket "CC0-1.0". Both became wrong when official vendor
     * art arrived beside the Simple Icons glyphs: the file is curated now, and
     * a vendor's own logo is emphatically NOT public domain — it is a
     * trademark, included to identify which integration a row is about, which
     * is nominative use.
     *
     * Keeping the old assertion would have meant keeping a false licence
     * statement in a file that ships to every client. So what is pinned is the
     * thing that still has to be true: the licensing is addressed, and the
     * tool for adding a mark is named where the next person will look.
     */
    const file = readFileSync(join(process.cwd(), "src/connectors/logos.ts"), "utf8");
    expect(file, "Simple Icons' terms still cover most of these").toMatch(/CC0-1\.0/);
    expect(file, "and the vendors' own art is not covered by them").toMatch(/nominative use/);
    expect(file, "the way to add one").toMatch(/scripts\/svg-to-logo\.mjs/);
  });
});
