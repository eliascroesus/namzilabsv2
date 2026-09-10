import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrast } from "./helpers/contrast";

/**
 * THE BLUE THEME'S VALUES, PINNED WHERE THEY LIVE.
 *
 * The 10 September 2026 Figma (nodes 35:5917 / 35:6331 / 35:6745) SUPPLIED
 * these colours, and a supplied value has no internal reason a later refactor
 * can rediscover — the same argument `console-theme.test.ts` makes about the
 * four numbers it guards. `#568cff` looks like a colour somebody chose and
 * could re-choose. It is, and this file is where re-choosing it costs a test.
 *
 * IT WAS `lime-theme.test.ts` UNTIL THE RE-THEME, and the rename is the point:
 * a file named for the value it guards cannot quietly outlive it. The lime's
 * own assertions are not deleted, they are INVERTED — the ratios that made
 * #B6FF56 need a solved-down stroke are still measured here, as the reason the
 * blue does not need one.
 *
 * Where this file differs from `console-theme.test.ts`: the ratios are
 * MEASURED here rather than quoted in a comment. A claim in BRAND_KIT.md and
 * the assertion defending it are then the same calculation, so a value cannot
 * drift away from the prose that justifies it.
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

/** The `.mix` block's text, on its own. */
function mixBlock(): string {
  const start = bare.indexOf(".mix {");
  expect(start, "there is no `.mix` block to read").toBeGreaterThan(-1);
  return bare.slice(start, bare.indexOf("\n}", start));
}

/** A role read from inside `.mix` — null when that block does not set it. */
function mixToken(name: string): string | null {
  return mixBlock().match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim().toLowerCase() ?? null;
}

describe("the brand ramp is blue", () => {
  it("brand-400 is the Figma's #568CFF", () => {
    expect(token("color-brand-400")).toBe("#568cff");
  });

  it("carries none of the lime it replaced", () => {
    // Every rung of the old ramp, plus the two alpha spellings of it that a
    // find-and-replace on the hex would have missed.
    expect(bare).not.toMatch(/#b6ff56|#c9ff7d|#a2e844|#8acc2e|#6fa61c|#4f7a00|#3d5e00|#f4ffe4|#e9ffc9|#dbffa6/i);
    expect(bare).not.toMatch(/rgb\(182 255 86/i);
  });

  it("the text step clears 4.5:1 on white, and the brand itself does not", () => {
    // The role `brand-800` exists for exactly this gap: brand-coloured TEXT on
    // a white card. If the brand ever clears 4.5:1 on its own, this rung is
    // redundant and should be deleted rather than left as decoration.
    const text = token("color-brand-800")!;
    expect(text).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrast(text, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("color-brand-400")!, "#ffffff")).toBeLessThan(4.5);
  });
});

describe("the fill keeps near-black ink, now on blue", () => {
  it("--primary-foreground is #1f1f1f in EVERY mode", () => {
    // A primary button is one object; the ink on it does not change with the
    // mode. `.mix` does not restate it, and must not: the fill is content
    // vocabulary and `.mix` only ever overrides the rail.
    expect(lightToken("primary-foreground")).toBe("#1f1f1f");
    expect(darkToken("primary-foreground")).toBe("#1f1f1f");
    expect(mixToken("primary-foreground")).toBeNull();
  });

  it("the fill clears 4.5:1 under its own ink", () => {
    expect(contrast(token("color-brand-400")!, "#1f1f1f")).toBeGreaterThanOrEqual(4.5);
  });

  it("records why the Figma's own #2E2E2E was deepened one count", () => {
    // Node 35:6023 draws the New button's label at #2E2E2E. That measures
    // 4.27:1 on this fill — a hair under what a 13px label owes — which is the
    // whole reason the shipped ink is #1F1F1F and not the export's value.
    expect(contrast(token("color-brand-400")!, "#2e2e2e")).toBeLessThan(4.5);
  });

  it("would NOT have cleared it under WHITE — which is why the ink is dark", () => {
    // The reflex on a blue fill is white ink, and on THIS blue it is illegal.
    // Deepening the fill until white worked would have thrown away the value
    // the Figma actually supplies, so the ink moved instead.
    expect(contrast(token("color-brand-400")!, "#ffffff")).toBeLessThan(4.5);
  });
});

describe("--marker is ONE value now, which is what the re-theme bought", () => {
  const brand = () => token("color-brand-400")!;

  it("is the brand itself on dark, clearing 4.5:1 on the page", () => {
    expect(darkToken("marker")).toBe("var(--color-brand-400)");
    expect(contrast(brand(), "#121214")).toBeGreaterThanOrEqual(4.5);
  });

  it("is the SAME value on light, because #568CFF can draw on white", () => {
    // THE FORK RETIRED HERE. Under the lime this role had to be
    // `brand-800` on light, because #B6FF56 is 1.20:1 on white — not a dim
    // line, an absent one. The blue clears the 3:1 a line or a glyph owes, so
    // both themes point at the same rung and node 35:7208's single blue dot is
    // drawable in both frames.
    expect(lightToken("marker")).toBe("var(--color-brand-400)");
    expect(contrast(brand(), "#ffffff")).toBeGreaterThanOrEqual(3);
  });

  it("still may not be brand-coloured TEXT on white", () => {
    // The 3:1 above buys a LINE and nothing more. If this ever passes 4.5:1
    // the distinction is gone and `brand-800` should go with it.
    expect(contrast(brand(), "#ffffff")).toBeLessThan(4.5);
  });

  it("records why the lime needed a second value and the blue does not", () => {
    expect(contrast("#b6ff56", "#ffffff")).toBeLessThan(3);
  });
});

describe("one surface on dark, and a rail that is no longer constant", () => {
  it("page, chrome and panel are all #121214 ON DARK", () => {
    expect(token("color-neutral-950")).toBe("#121214");
    expect(token("color-neutral-925")).toBe("#121214");
    expect(darkToken("background")).toBe("var(--color-neutral-950)");
    expect(darkToken("topbar")).toBe("#121214");
    expect(darkToken("panel")).toBe("var(--background)");
  });

  it("THE RAIL FLIPS NOW, and that is the whole of `.mix`", () => {
    // It was #121214 in both themes, and this assertion said so. The 10
    // September frames draw it three ways: light over light content (35:5917),
    // near-black over light content (35:6331), near-black over dark (35:6745).
    expect(lightToken("rail")).toBe("#f3f3f3");
    expect(mixToken("rail")).toBe("#121214");
    expect(darkToken("rail")).toBe("#121214");
    // The bar does NOT follow it — it is white over both light rails.
    expect(lightToken("topbar")).toBe("#ffffff");
    expect(mixToken("topbar")).toBeNull();
  });

  it("`.mix` overrides the RAIL and nothing else", () => {
    // This is the claim the block's own comment makes, and the one that keeps
    // the third mode cheap. A non-rail role appearing here means a content
    // value has been forked per-mode, which is how a two-theme kit becomes a
    // three-theme kit by accident.
    const declared = [...mixBlock().matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((n) => !n.startsWith("rail"))).toEqual([]);
  });

  it("every rail role is set in all three modes, so none can fall through", () => {
    // A `--rail-*` that `.mix` forgets inherits the LIGHT value onto a
    // near-black column — white-on-white, and only visible by looking.
    const names = [...bare.slice(0, bare.indexOf("\n.dark {")).matchAll(/--(rail[a-z-]*):/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThanOrEqual(8);
    for (const n of names) {
      expect(mixToken(n), `.mix is missing --${n}`).not.toBeNull();
      expect(darkToken(n), `.dark is missing --${n}`).not.toBeNull();
    }
  });

  it("the light rail's own ink clears its own ground", () => {
    // The rail is a surface with its own vocabulary; on light it is the one
    // place `--foreground` would be wrong. Measured, not asserted by name.
    expect(contrast(lightToken("rail-foreground")!, lightToken("rail")!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(lightToken("rail-muted")!, lightToken("rail")!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(lightToken("rail-faint")!, lightToken("rail")!)).toBeGreaterThanOrEqual(3);
  });

  it("records why the Figma's own #8E8E8E is not the light rail's label ink", () => {
    // 2.95:1 on #F3F3F3 — under what a row you are meant to read and click
    // owes. Substituted with #6B6B6B; see the substitution log.
    expect(contrast("#8e8e8e", "#f3f3f3")).toBeLessThan(4.5);
  });

  it("THE GUTTER IS VISIBLE: page and panel differ wherever they touch", () => {
    // The 8px inset only draws something if these two are a real step apart.
    // On dark they deliberately are not — the hairline does that work — so
    // this is a light-mode invariant, and it is the one the frame turns on.
    expect(lightToken("panel")).not.toBe(lightToken("background"));
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

  it("brings the frame's corner back, because there is a surface behind it", () => {
    // It was 0 on the argument that a corner cut into #121214 to reveal
    // #121214 draws nothing. Node 35:6024 puts 8px of page around the panel,
    // so there is something to reveal again.
    expect(token("radius-frame")).toBe("0.5rem");
  });

  it("pins the gutter to the radius, so an inset can never go missing", () => {
    // A radius with no inset is a corner cut into its own neighbour, and an
    // inset with no radius is a plain gap. They ship together or not at all.
    expect(token("spacing-frame")).toBe("0.5rem");
    expect(token("spacing-frame")).toBe(token("radius-frame"));
  });
});

describe("type: the Figma's sizes", () => {
  it("the UI base is 14px — nav, tabs, card titles and buttons all sit here", () => {
    expect(token("text-sm")).toBe("0.875rem");
    expect(token("text-sm--line-height")).toBe("1.125rem"); // 18px
  });

  it("the small step is 13px — axis labels, legend, delta chip, Main Menu", () => {
    /**
     * 12px UNTIL 10 SEP 2026, and it was the smallest thing in the product and
     * the most used — the freshness line, both chart axes, the legend, the caps
     * label, the invite card, every caption. Beside a 14px row it read as fine
     * print, which is most of what "everything looks small" was once the
     * controls came back to the kit's 32px.
     *
     * THE LINE BOX DID NOT MOVE. 16px at 13 rather than at 12, so no row grew
     * and the three bars still sum to 155 — only the glyphs changed.
     */
    expect(token("text-xs")).toBe("0.8125rem");
    expect(token("text-xs--line-height")).toBe("1rem"); // 16px
  });

  it("the metric numeral is 28px over 40px leading", () => {
    expect(token("text-display-md")).toBe("1.75rem");
    expect(token("text-display-md--line-height")).toBe("2.5rem");
  });
});
