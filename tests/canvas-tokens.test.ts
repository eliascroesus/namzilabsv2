import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE CANVAS COLOURS EXIST TWICE, SO PIN THEM TOGETHER.
 *
 * React Flow's `<Background>` takes `color` and `bgColor` as plain strings and
 * writes them onto an SVG pattern — it cannot take `var(--color-canvas-dot)`.
 * So the dot grid's two colours are the one place in the product where a
 * palette value is written as a literal hex outside globals.css, and the whole
 * point of `--color-canvas-bg` / `--color-canvas-dot` is that the page behind
 * the canvas, the design page's dot preview and the canvas itself can never
 * drift apart.
 *
 * That is a promise nothing enforced. This enforces it: change the token and
 * this fails until the canvas follows. Sabotage-verified — editing either hex
 * in flow-canvas.tsx fails this test alone.
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

  it("its bgColor is --color-canvas-bg", () => {
    expect(bg?.[0]).toContain(`bgColor="${token("color-canvas-bg")}"`);
  });

  it("its dot color is --color-canvas-dot", () => {
    expect(bg?.[0]).toContain(`color="${token("color-canvas-dot")}"`);
  });

  it("the dots stay subtler than the surface they sit on", () => {
    // A dot grid is a depth cue, not content. If someone darkens the dots far
    // enough to compete with a card's border, that is a regression, not a
    // preference — the grid should read as texture and vanish under attention.
    const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [br, bgn, bb] = hex(token("color-canvas-bg"));
    const [dr, dg, db] = hex(token("color-canvas-dot"));
    const delta = Math.max(br - dr, bgn - dg, bb - db);
    expect(delta).toBeGreaterThan(6); // still visible
    expect(delta).toBeLessThan(30); // still subtle
  });
});
