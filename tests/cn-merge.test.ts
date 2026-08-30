import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

/**
 * THE MERGER MUST KNOW OUR TYPE SCALE.
 *
 * tailwind-merge classifies any `text-*` it does not recognise as a font size
 * as a text COLOUR. The steps this kit adds on top of Tailwind's defaults —
 * `md`, the four `display-*` rungs and `banner` — are not in its list, so
 * before `cn` was extended, `cn("text-primary-foreground", "text-md")` read as
 * two colours and the first was dropped. Live consequence: the builder's
 * `Test flow` and `Edit output` buttons rendered BLACK text on accent blue, at
 * roughly 4:1, with nothing wrong in either the component or the call site.
 *
 * These pin the two halves: the scale is understood as SIZES, and sizes still
 * override each other. Sabotage-verified — reverting `cn` to a bare `twMerge`
 * fails the first test alone.
 */
describe("cn keeps a colour when a custom type token follows it", () => {
  for (const size of ["md", "display-xs", "display-sm", "display-md", "display-lg", "banner"]) {
    it(`text-${size} does not eat the preceding text colour`, () => {
      const out = cn("text-primary-foreground", `text-${size}`);
      expect(out).toContain("text-primary-foreground");
      expect(out).toContain(`text-${size}`);
    });
  }

  /**
   * BOTH PRIMARIES, because the kit has two and they carry different inks.
   * `default` is the brand sheet's DEEP BLACK (`text-background`); `accent` is
   * its VIBRANT VIOLET (`text-primary-foreground`). This test only ever named
   * the violet one, so when black became the default it failed for a reason
   * that had nothing to do with what it guards — which is that `cn()` must not
   * eat a button's text COLOUR when a caller appends a text SIZE.
   */
  for (const [variant, fill, ink] of [
    ["default", "bg-foreground", "text-background"],
    ["accent", "bg-primary", "text-primary-foreground"],
  ] as const) {
    it(`the ${variant} button keeps its foreground when the caller sets a size`, () => {
      // Exactly what FlowToolbar does for Test flow / Review & publish.
      const out = cn(buttonVariants({ variant }), "h-[42px] gap-2 px-[18px] text-md");
      expect(out).toContain(ink);
      expect(out).toContain("text-md");
      expect(out).toContain(fill);
    });
  }

  it("still lets one size win over another", () => {
    // The scale must be a conflict GROUP, not merely allow-listed: two sizes
    // in a row is a real conflict and the last must win.
    expect(cn("text-sm", "text-md")).toBe("text-md");
    expect(cn("text-md", "text-xs")).toBe("text-xs");
    expect(cn("text-sm", "text-lg")).toBe("text-lg");
    expect(cn("text-sm", "text-display-xs")).toBe("text-display-xs");
  });

  /**
   * THE EXACT PAIR `ViewTitle` DEPENDS ON.
   *
   * That control sets the page title on a `Button`, whose size variant carries
   * `text-sm`. It used to dodge the conflict with
   * `text-[length:var(--text-display-xs)]` because the merger did not know the
   * kit's names. It knows the `display-*` steps now, so the named class is used
   * — and this asserts the merge rather than trusting the comment that says so.
   */
  it("a named display step beats a primitive's own text-sm", () => {
    const out = cn(buttonVariants({ variant: "ghost" }), "font-display text-display-sm font-semibold");
    expect(out).toContain("text-display-sm");
    expect(out.split(/\s+/)).not.toContain("text-sm");
  });

  /**
   * A LATER FONT-SIZE DELETES AN EARLIER `leading-*`, AND THAT COST A FIX.
   *
   * tailwind-merge knows a font-size utility can carry a line-height, so it
   * treats `text-display-sm` as overriding a `leading-none` written before it.
   * The page title passed exactly that pair in exactly that order, the class
   * never reached the DOM, and its hover wash stayed 38px tall around 30px
   * glyphs through three separate attempts to fix it.
   *
   * Pinned in BOTH directions so the ordering is a rule rather than a folk
   * memory: before the size it is dropped, after it it survives.
   */
  it("a font-size deletes a line-height written before it, and not one written after", () => {
    expect(cn("leading-none text-display-sm")).toBe("text-display-sm");
    expect(cn("text-display-sm leading-none")).toBe("text-display-sm leading-none");
  });

  it("still lets one colour win over another", () => {
    expect(cn("text-foreground", "text-muted-foreground")).toBe("text-muted-foreground");
  });

  it("keeps a size when a colour follows it", () => {
    const out = cn("text-md", "text-destructive");
    expect(out).toContain("text-md");
    expect(out).toContain("text-destructive");
  });

  /**
   * THE RETIRED NAMES MUST NOT BE TREATED AS SIZES.
   *
   * They are gone from `@theme`, so `text-micro` compiles to nothing. If it
   * were still registered here, `cn("text-xs", "text-micro")` would resolve the
   * "conflict" in favour of the dead class and drop the live one — a silent
   * 12px→inherited regression that no gate downstream would see. Leaving a name
   * in this list after deleting its token is worse than never adding it.
   */
  for (const dead of ["micro", "tiny", "small", "lead", "title", "stat", "hero"]) {
    it(`text-${dead} is no longer a known size`, () => {
      expect(cn("text-xs", `text-${dead}`)).toContain("text-xs");
    });
  }
});
