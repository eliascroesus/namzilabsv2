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
 * `top-chrome-band`. Replace that with an arbitrary value and
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

  /**
   * THE BAND IS THE INSET NOW, AND NOTHING ELSE.
   *
   * It used to be 24 + 58 + 24: the canvas's inset, the toolbar island floating
   * over it, and the gap below. That toolbar moved into the app's top bar —
   * the builder had two stacked bars and the upper one covered the flow being
   * edited — so there is no island left to clear.
   *
   * The remaining floating chrome is the zoom column at the bottom-left, which
   * measures from the foot and never from this.
   */
  const inset = Number(one(toolbar, /absolute bottom-(\d+) left-\d+ z-10/, "the zoom column's inset")) * SPACING_STEP;

  it("equals the canvas's own inset, because no bar floats over it any more", () => {
    expect(band).toBe(inset);
  });

  it("keeps no floating bar across the top of the canvas", () => {
    // The regression this replaces: re-float the toolbar and the panel, the
    // banners and the canvas all measure against a bar that is covering them.
    expect(toolbar).not.toMatch(/absolute inset-x-6 top-\d+/);
    expect(toolbar).toMatch(/TopBarPortal/);
  });

  it("is referenced by the panel, which is the only thing that emits it", () => {
    // Tailwind v4 drops an unreferenced theme variable from the stylesheet.
    // ONE reference now that everything lives in a single top bar and the foot
    // of the canvas is free — so this pin matters more, not less: delete that
    // one class name and the variable leaves the build entirely.
    expect(panel).toMatch(/\btop-chrome-band\b/);
  });

  it("starts below the bar and runs to the foot of the canvas", () => {
    // The band is a TOP measurement: there is one bar and it is at the top, so
    // the foot takes the plain 24px inset like every other floating edge.
    const aside = one(panel, /(<aside[\s\S]{0,600}?data-config-panel[\s\S]{0,600}?>)/, "the panel's <aside>");
    expect(aside).not.toMatch(/\binset-y-0\b/);
    expect(aside).toMatch(/\bright-6\b/);
    expect(aside).toMatch(/\btop-chrome-band\b/);
    expect(aside).toMatch(/\bbottom-6\b/);
  });

  it("leaves the chrome nailed down — nothing slides for the panel", () => {
    // The step-aside this replaced: a `panelInset` that moved the right island
    // and the bottom bar whenever a step was selected.
    expect(toolbar).not.toMatch(/panelInset/);
    expect(toolbar).not.toMatch(/panelOpen/);
    expect(toolbar).not.toMatch(/transition-\[right\]/);
  });
});
