import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE PANEL'S TOP EDGE AND THE ISLAND'S HEIGHT ARE ONE MEASUREMENT.
 *
 * The config panel stops short of both chrome bars so that neither has to move
 * out of its way — the top-right island and the bottom bar used to slide left
 * whenever the panel opened. That only holds while
 *
 *     --spacing-chrome-band  ==  inset + island height + inset
 *
 * and the three numbers on the right live in FlowToolbar.tsx as Tailwind
 * classes, while the one on the left lives in globals.css. Nothing but this
 * test connects them: grow the islands and the panel silently overlaps the
 * chrome again, with no error anywhere.
 *
 * It also pins the token's ONLY reference. Tailwind v4 emits a theme variable
 * to :root only when a generated utility uses it, so `--spacing-chrome-band`
 * exists in the stylesheet purely because ConfigPanel writes
 * `top-chrome-band bottom-chrome-band`. Replace that with arbitrary values and
 * the variable vanishes from the build — a failure that already cost an
 * afternoon once on `--radius-frame`, where the class was on the element, the
 * token was missing from :root, and it looked exactly like a scanner bug.
 *
 * Sabotage-verified: changing the island's padding, its control height, the
 * inset, or the band alone fails this file and nothing else.
 */
const root = join(__dirname, "..");
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
const toolbar = readFileSync(join(root, "src/components/flow/FlowToolbar.tsx"), "utf8");
const panel = readFileSync(join(root, "src/components/flow/ConfigPanel.tsx"), "utf8");

/** Tailwind's spacing scale: `top-6` is 6 × 4px. */
const SPACING_STEP = 4;

function one(source: string, re: RegExp, what: string): string {
  const m = source.match(re);
  if (!m) throw new Error(`could not find ${what}`);
  return m[1];
}

describe("the chrome band", () => {
  const band = Number(one(css, /--spacing-chrome-band:\s*(\d+)px\s*;/, "--spacing-chrome-band"));
  // Island(): `p-[7px]` around a 42px control, plus 1px of border on each side.
  const pad = Number(one(toolbar, /rounded-card border border-border bg-white p-\[(\d+)px\]/, "the island's padding"));
  const control = Number(one(toolbar, /flex h-\[(\d+)px\] w-\[\d+px\] shrink-0 items-center justify-center rounded-control text-foreground/, "the island's control height"));
  // The top island's own distance from the viewport edge.
  const inset = Number(one(toolbar, /absolute left-6 top-(\d+) z-10 flex max-w-/, "the top island's inset")) * SPACING_STEP;

  it("equals inset + island + inset", () => {
    const island = 1 + pad + control + pad + 1;
    expect(island).toBe(58);
    expect(band).toBe(inset + island + inset);
  });

  it("is referenced by the panel, which is the only thing that emits it", () => {
    // Tailwind v4 drops an unreferenced theme variable from the stylesheet.
    expect(panel).toMatch(/\btop-chrome-band\b/);
    expect(panel).toMatch(/\bbottom-chrome-band\b/);
  });

  it("keeps the panel clear of both bars", () => {
    // The panel is positioned by the band alone: no inset-y-0, no margin that
    // would put it back over the chrome.
    const aside = one(panel, /(<aside[\s\S]{0,600}?data-config-panel[\s\S]{0,600}?>)/, "the panel's <aside>");
    expect(aside).not.toMatch(/\binset-y-0\b/);
    expect(aside).toMatch(/\bright-6\b/);
  });

  it("leaves the chrome nailed down — nothing slides for the panel", () => {
    // The step-aside this replaced: a `panelInset` that moved the right island
    // and the bottom bar whenever a step was selected.
    expect(toolbar).not.toMatch(/panelInset/);
    expect(toolbar).not.toMatch(/panelOpen/);
    expect(toolbar).not.toMatch(/transition-\[right\]/);
  });
});
