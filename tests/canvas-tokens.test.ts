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

function token(name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`));
  if (!m) throw new Error(`--${name} is not a hex literal in globals.css`);
  return m[1].toLowerCase();
}

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

  it("both tokens it names exist as hex literals in the theme", () => {
    // `token()` throws when the variable is missing or stops being a hex, so
    // deleting or renaming either one fails here rather than at runtime, where
    // an unresolved var() silently falls back to React Flow's own default.
    expect(token("color-canvas-bg")).toMatch(/^#[0-9a-f]{6}$/);
    expect(token("color-canvas-dot")).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("the dots stay subtler than the surface they sit on", () => {
    // A dot grid is a depth cue, not content. If someone darkens the dots far
    // enough to compete with a card's border, that is a regression, not a
    // preference — the grid should read as texture and vanish under attention.
    const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [br, bgn, bb] = hex(token("color-canvas-bg"));
    const [dr, dg, db] = hex(token("color-canvas-dot"));
    const delta = Math.max(br - dr, bgn - dg, bb - db);
    // The floor is what a first pass got wrong: #e7e4f2 measured as tastefully
    // subtle at 100% and rendered as a flat, dotless field at 83%, because
    // React Flow scales the pattern with the viewport. The ceiling keeps the
    // grid lighter than a card's own border, so a dot can never be mistaken
    // for an edge.
    expect(delta).toBeGreaterThan(20); // survives being zoomed out
    expect(delta).toBeLessThan(45); // never competes with a border
  });
});
