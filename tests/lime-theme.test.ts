import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrast } from "./helpers/contrast";

/**
 * THE LIME THEME'S VALUES, PINNED WHERE THEY LIVE.
 *
 * The 8 September 2026 Figma (node 49:5268) SUPPLIED these colours, and a
 * supplied value has no internal reason a later refactor can rediscover — the
 * same argument `console-theme.test.ts` makes about the four numbers it
 * guards. `#b6ff56` looks like a colour somebody chose and could re-choose.
 *
 * Where this file differs from that one: the ratios are MEASURED here rather
 * than quoted in a comment. A claim in BRAND_KIT.md and the assertion
 * defending it are then the same calculation, so a value cannot drift away
 * from the prose that justifies it.
 */
const root = join(__dirname, "..");
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");

/** globals.css with every comment removed, so prose cannot answer for a value. */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** A declaration from anywhere in the file. First match wins — `@theme` comes first. */
function token(name: string): string | null {
  return bare.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim().toLowerCase() ?? null;
}

/**
 * The same role, read from inside `.dark`.
 *
 * Necessary rather than fussy, for the reason `console-theme.test.ts` gives:
 * both themes declare the SAME role names and `:root` comes first, so an
 * unscoped lookup silently answers with the light value and the assertion
 * then tests the wrong theme.
 */
function darkToken(name: string): string | null {
  const start = bare.indexOf(".dark {");
  const block = bare.slice(start, bare.indexOf("\n}", start));
  return block.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim().toLowerCase() ?? null;
}

/** The same role, read from inside `:root` only. */
function lightToken(name: string): string | null {
  const block = bare.slice(0, bare.indexOf("\n.dark {"));
  return block.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim().toLowerCase() ?? null;
}

describe("the brand ramp is lime", () => {
  it("brand-400 is the Figma's #B6FF56", () => {
    expect(token("color-brand-400")).toBe("#b6ff56");
  });

  it("carries none of the blue it replaced", () => {
    expect(bare).not.toMatch(/#007bff|#0070e8|#3d9bff|#0062cc|#0056b3|#0069d9|#66b2ff/i);
  });

  it("the light stroke clears 4.5:1 on white", () => {
    const stroke = token("color-brand-800")!;
    expect(stroke).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrast(stroke, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the fill inverts: near-black ink on lime", () => {
  it("--primary-foreground is #2c2c2c in BOTH themes", () => {
    // A primary button is one object; the ink on it does not change with the
    // theme. The blue kit said the same thing with white — the lime inverts
    // which end of the ramp that ink comes from, not the rule.
    expect(lightToken("primary-foreground")).toBe("#2c2c2c");
    expect(darkToken("primary-foreground")).toBe("#2c2c2c");
  });

  it("the fill clears 4.5:1 under its own ink", () => {
    expect(contrast("#b6ff56", "#2c2c2c")).toBeGreaterThanOrEqual(4.5);
  });

  it("would NOT have cleared it under white — which is why the ink inverted", () => {
    expect(contrast("#b6ff56", "#ffffff")).toBeLessThan(4.5);
  });
});

describe("--marker draws on both themes", () => {
  it("is the brand itself on dark, clearing 4.5:1 on the page", () => {
    expect(darkToken("marker")).toBe("var(--color-brand-400)");
    expect(contrast("#b6ff56", "#121214")).toBeGreaterThanOrEqual(4.5);
  });

  it("is the solved-down lime on light, because #B6FF56 cannot draw on white", () => {
    expect(lightToken("marker")).toBe("var(--color-brand-800)");
    expect(contrast("#b6ff56", "#ffffff")).toBeLessThan(3);
  });
});
