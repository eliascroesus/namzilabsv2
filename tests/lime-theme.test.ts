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

describe("one surface, one card", () => {
  it("page, chrome and panel are all #121214", () => {
    expect(token("color-neutral-950")).toBe("#121214");
    expect(token("color-neutral-925")).toBe("#121214");
    expect(darkToken("background")).toBe("var(--color-neutral-950)");
    expect(darkToken("chrome")).toBe("var(--color-neutral-925)");
    expect(darkToken("panel")).toBe("var(--background)");
  });

  it("the card is the only step away, and it is tiny", () => {
    expect(token("color-neutral-900")).toBe("#191919");
    const step = contrast("#191919", "#121214");
    expect(step).toBeGreaterThan(1);
    expect(step).toBeLessThan(1.15); // which is why the hairline is load-bearing
  });

  it("keeps --panel as a role even though it no longer differs", () => {
    // Deleting it would break the shared-vocabulary rule design-swatches.test.ts
    // enforces, and every bg-panel call site with it.
    expect(darkToken("panel")).not.toBeNull();
    expect(lightToken("panel")).not.toBeNull();
  });

  it("never lets --muted collapse onto --card", () => {
    // A card painted onto itself. FlowNodeCard hovers to `bg-muted` while
    // sitting ON a card; when these two roles held the same value it broke six
    // hovers into invisibility. The light theme already mirrors this by giving
    // --muted and --control the same step, one down from its white card.
    expect(darkToken("muted")).not.toBe(darkToken("card"));
    expect(lightToken("muted")).not.toBe(lightToken("card"));
  });

  it("the hairline and the control are unchanged", () => {
    expect(token("color-neutral-600")).toBe("#343434");
    expect(token("color-neutral-850")).toBe("#202020");
  });
});

describe("the recorded contrast substitutions", () => {
  it("--muted-foreground clears 4.5:1 on BOTH the page and the card", () => {
    expect(token("color-neutral-400")).toBe("#828282");
    expect(contrast("#828282", "#121214")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#828282", "#191919")).toBeGreaterThanOrEqual(4.5);
  });

  it("records why the Figma's own #7E7E7E was not used", () => {
    // 4.33:1 on the card its titles actually sit on — under the bar a 14px
    // label owes. Substituted, not shipped; see the spec's substitution log.
    expect(contrast("#7e7e7e", "#191919")).toBeLessThan(4.5);
  });

  it("--faint stays a caps-label step and is never body copy", () => {
    expect(token("color-neutral-450")).toBe("#6e6e6e");
    expect(contrast("#6e6e6e", "#121214")).toBeGreaterThanOrEqual(3);
  });

  it("records why the Figma's #4A4A4A cannot be an inactive tab", () => {
    // 2.11:1 on the page — below even the 3:1 a non-text GRAPHIC owes, and a
    // tab is an interactive control. Tabs use --muted-foreground instead.
    expect(contrast("#4a4a4a", "#121214")).toBeLessThan(3);
  });
});

describe("shape: 8px on everything that contains something", () => {
  it("the card and the surface come DOWN to the control's 8px", () => {
    // They were `--radius-lg` (10px). The Figma draws one radius, not two.
    expect(token("radius-card")).toBe("var(--radius-md)");
    expect(token("radius-surface")).toBe("var(--radius-md)");
    expect(token("radius-control")).toBe("var(--radius-md)");
    expect(token("radius-md")).toBe("0.5rem");
  });

  it("retires the frame notch, because one surface reveals nothing", () => {
    expect(token("radius-frame")).toBe("0");
  });
});

describe("type: the Figma's sizes", () => {
  it("the UI base is 14px — nav, tabs, card titles and buttons all sit here", () => {
    expect(token("text-sm")).toBe("0.875rem");
    expect(token("text-sm--line-height")).toBe("1.125rem"); // 18px
  });

  it("the small step is 12px — axis labels, legend, delta chip, Main Menu", () => {
    expect(token("text-xs")).toBe("0.75rem");
    expect(token("text-xs--line-height")).toBe("1rem"); // 16px
  });

  it("the metric numeral is 28px over 40px leading", () => {
    expect(token("text-display-md")).toBe("1.75rem");
    expect(token("text-display-md--line-height")).toBe("2.5rem");
  });
});
