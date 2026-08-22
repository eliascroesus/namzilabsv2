import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

/**
 * THE MERGER MUST KNOW OUR TYPE SCALE.
 *
 * tailwind-merge classifies any `text-*` it does not recognise as a font size
 * as a text COLOUR. Our scale is `micro tiny small lead title display`, none of
 * which are Tailwind defaults — so before `cn` was extended,
 * `cn("text-primary-foreground", "text-lead")` read as two colours and the
 * first was dropped. Live consequence: the builder's `Test flow` and
 * `Edit output` buttons rendered BLACK text on accent blue, at roughly 4:1,
 * with nothing wrong in either the component or the call site.
 *
 * These pin the two halves: the scale is understood as SIZES, and sizes still
 * override each other. Sabotage-verified — reverting `cn` to a bare `twMerge`
 * fails the first test alone.
 */
describe("cn keeps a colour when a custom type token follows it", () => {
  for (const size of ["micro", "tiny", "small", "lead", "title", "display", "stat", "hero"]) {
    it(`text-${size} does not eat the preceding text colour`, () => {
      const out = cn("text-primary-foreground", `text-${size}`);
      expect(out).toContain("text-primary-foreground");
      expect(out).toContain(`text-${size}`);
    });
  }

  it("the real primary button keeps its foreground when the caller sets a size", () => {
    // Exactly what FlowToolbar does for Test flow / Review & publish.
    const out = cn(buttonVariants({ variant: "default" }), "h-[42px] gap-2 px-[18px] text-lead");
    expect(out).toContain("text-primary-foreground");
    expect(out).toContain("text-lead");
    expect(out).toContain("bg-primary");
  });

  it("still lets one size win over another", () => {
    // The scale must be a conflict GROUP, not merely allow-listed: two sizes
    // in a row is a real conflict and the last must win.
    expect(cn("text-base", "text-lead")).toBe("text-lead");
    expect(cn("text-lead", "text-micro")).toBe("text-micro");
    expect(cn("text-sm", "text-title")).toBe("text-title");
  });

  it("still lets one colour win over another", () => {
    expect(cn("text-foreground", "text-muted-foreground")).toBe("text-muted-foreground");
  });

  it("keeps a size when a colour follows it", () => {
    const out = cn("text-lead", "text-destructive");
    expect(out).toContain("text-lead");
    expect(out).toContain("text-destructive");
  });
});
