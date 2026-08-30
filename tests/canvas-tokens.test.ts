import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE CANVAS READS THE TOKENS — IT DOES NOT COPY THEM.
 *
 * This file used to pin two literal hexes in flow-canvas.tsx against the two
 * tokens in globals.css, on the belief that React Flow's `<Background>` takes
 * `color`/`bgColor` as plain strings an SVG pattern could not resolve a
 * `var()` through. That is not what v12 does: both props are written as INLINE
 * CUSTOM PROPERTIES (`--xy-background-pattern-color-props`,
 * `--xy-background-color-props`) which its own stylesheet then reads, and a
 * custom property holding `var(--color-canvas-dot)` resolves by ordinary
 * variable indirection. Verified in a browser: the dot computes to
 * rgb(217,217,217) through the chain.
 *
 * So the duplication is gone, and with it the drift this file was written to
 * catch — one definition cannot disagree with itself. What is left worth
 * pinning is that the canvas keeps REFERENCING the tokens (a future edit
 * pasting a hex back in is the regression now), and that the two values stay
 * in the relationship the grid depends on.
 */
const root = join(__dirname, "..");
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
const canvas = readFileSync(join(root, "src/components/flow/flow-canvas.tsx"), "utf8");

/**
 * The theme-varying tokens live in `:root` and `.dark` now — `@theme` holds
 * constants and cannot answer differently under a class — so each one has TWO
 * values and both have to hold the relationship below. Scoped by block, or a
 * lookup would return whichever definition came first in the file and quietly
 * measure the light theme twice.
 */
/**
 * `(?:,[^{]*)?` — THE BLOCK MAY BE ONE OF SEVERAL SELECTORS ON ITS RULE.
 *
 * `:root` is written `:root, .dark .tile-surface { … }` now: the metric tile is
 * a light island inside the dark theme, and it gets there by NAMING the light
 * role block a second time rather than by re-declaring ninety values that would
 * then drift. Matching `:root\s*\{` stopped finding it, and the failure was the
 * unhelpful kind — "no :root block in globals.css" — for a rule that is right
 * there. Tolerate the selector list; keep requiring the block to start a line,
 * which is what stops `.dark` matching `.dark .tile-surface`.
 */
function block(selector: string): string {
  const m = css.match(new RegExp(`(?:^|\\n)${selector}\\s*(?:,[^{]*)?\\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`no ${selector} block in globals.css`);
  return m[1];
}

function token(name: string, selector: string): string {
  const src = block(selector);
  const m = src.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`));
  if (!m) {
    // A `var(--x)` here is not a failure — it is one token pointing at another,
    // which is how the light canvas reuses the neutral ramp. Follow it once.
    const alias = src.match(new RegExp(`--${name}:\\s*var\\(--([a-z0-9-]+)\\)\\s*;`));
    if (alias) return token(alias[1], "@theme");
    throw new Error(`--${name} is neither a hex nor an alias in ${selector}`);
  }
  return m[1].toLowerCase();
}

/** Both themes, so neither can regress without the other noticing. */
const THEMES = [
  { name: "light", selector: ":root" },
  { name: "dark", selector: "\\.dark" },
];

describe("the canvas Background matches the theme tokens", () => {
  const bg = canvas.match(/<Background\b[^>]*\/>/);

  it("renders exactly one Background", () => {
    expect(canvas.match(/<Background\b/g)).toHaveLength(1);
  });

  it("its bgColor references --color-canvas-bg", () => {
    expect(bg?.[0]).toContain(`bgColor="var(--color-canvas-bg)"`);
  });

  it("its dot color references --color-canvas-dot", () => {
    expect(bg?.[0]).toContain(`color="var(--color-canvas-dot)"`);
  });

  it("names no colour of its own", () => {
    // The point of the rewrite: a hex pasted back onto the Background is a
    // second definition of a colour that already has one.
    expect(bg?.[0]).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  for (const { name, selector } of THEMES) {
    it(`resolves both tokens to hex literals in the ${name} theme`, () => {
      // `token()` throws when the variable is missing or stops resolving, so
      // deleting or renaming either one fails here rather than at runtime,
      // where an unresolved var() falls back to React Flow's own default.
      expect(token("canvas-bg", selector)).toMatch(/^#[0-9a-f]{6}$/);
      expect(token("canvas-dot", selector)).toMatch(/^#[0-9a-f]{6}$/);
    });

    it(`keeps the dots subtler than the surface they sit on — ${name}`, () => {
      /**
       * A dot grid is a depth cue, not content. Darken the dots far enough to
       * compete with a card's border and that is a regression, not a
       * preference — the grid should read as texture and vanish under
       * attention.
       *
       * ABSOLUTE difference, not signed: in the light theme the dot is darker
       * than its surface and in the dark theme it is lighter, so a signed
       * subtraction measures the light theme and reads the dark one as zero.
       */
      const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      const bgc = hex(token("canvas-bg", selector));
      const dot = hex(token("canvas-dot", selector));
      const delta = Math.max(...bgc.map((v, i) => Math.abs(v - dot[i])));
      // The floor is what a first pass got wrong: #e7e4f2 measured as
      // tastefully subtle at 100% and rendered as a flat, dotless field at
      // 83%, because React Flow scales the pattern with the viewport. The
      // ceiling keeps the grid lighter than a card's own border, so a dot can
      // never be mistaken for an edge.
      expect(delta).toBeGreaterThan(20); // survives being zoomed out
      expect(delta).toBeLessThan(45); // never competes with a border
    });
  }
});
