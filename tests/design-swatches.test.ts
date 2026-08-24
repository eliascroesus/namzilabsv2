import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE KIT PAGE MUST NOT LIE ABOUT THE KIT.
 *
 * `/design` renders each swatch from its TOKEN (`bg-brand-600`) but prints the
 * hex beside it as a literal, because a documentation page that cannot show
 * the value it documents is documenting nothing. That literal is a second copy
 * of a colour that already has exactly one home, and second copies drift.
 *
 * This one drifted the first time it was given the chance: the warm re-theme
 * moved all fifteen values in globals.css and, for one render, the page showed
 * ultramarine tiles captioned `#4f46e5` and warm near-black tiles captioned
 * `#23262d`. Nothing was broken — the swatches were correct, since they read
 * the token — so nothing failed, and the only person who would ever catch it
 * is someone comparing a caption to a colour by eye.
 *
 * BRAND_KIT.md already states the rule this enforces: "if this document, the
 * tokens, and /design ever disagree, the tokens win and the other two are
 * bugs." This is the half of that sentence a machine can check.
 *
 * Sabotage-verified: changing any single hex in either file fails here alone.
 */
const root = join(__dirname, "..");
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
const page = readFileSync(join(root, "src/app/design/page.tsx"), "utf8");

/** The value `--<name>` holds in globals.css, lower-cased. */
function token(name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!m) throw new Error(`--${name} is not a hex literal in globals.css`);
  return m[1].toLowerCase();
}

/**
 * Every `{ step, cls, hex }` row the page declares, whatever ramp it belongs
 * to. Parsed from the source rather than imported: the page is a server
 * component whose module graph pulls in half the app, and the rows are plain
 * data sitting in plain sight.
 */
function swatches(): Array<{ cls: string; hex: string }> {
  const rows = [...page.matchAll(/\{\s*step:\s*"[^"]+",\s*cls:\s*"bg-([a-z]+-\d+)",\s*hex:\s*"(#[0-9a-f]{6})"\s*\}/g)];
  return rows.map((m) => ({ cls: m[1], hex: m[2] }));
}

describe("the /design swatch captions match the tokens they render", () => {
  const rows = swatches();

  it("finds the ramps (a parse that silently matches nothing would pass everything)", () => {
    // The guard that makes the rest of this file mean something: if the page
    // is reformatted and the regex stops matching, THIS fails rather than the
    // suite going quietly green on zero assertions.
    expect(rows.length).toBeGreaterThanOrEqual(15);
    expect(rows.some((r) => r.cls.startsWith("brand-"))).toBe(true);
    expect(rows.some((r) => r.cls.startsWith("ink-"))).toBe(true);
  });

  for (const { cls, hex } of rows) {
    it(`${cls} is captioned ${hex}`, () => {
      expect(hex).toBe(token(`color-${cls}`));
    });
  }
});

/**
 * THE BROWSER CHROME IS PART OF THE PAGE.
 *
 * `<meta name="theme-color">` paints mobile Safari's and Chrome's own address
 * bar. Next builds it from `export const viewport`, which is evaluated at build
 * time and therefore cannot read `var(--background)` — so the value is written
 * out, and is the last colour in the product with two homes.
 *
 * Left unpinned, the failure is silent and ugly in the specific way that
 * matters: change the app's background and the address bar keeps the old
 * colour, so the page ends under a mismatched band on exactly the devices
 * where you are least likely to be testing.
 */
describe("the theme-color meta matches the app background", () => {
  const layout = readFileSync(join(root, "src/app/layout.tsx"), "utf8");

  it("declares a themeColor", () => {
    expect(layout).toMatch(/themeColor:\s*"#[0-9a-fA-F]{6}"/);
  });

  it("equals --background", () => {
    const declared = layout.match(/themeColor:\s*"(#[0-9a-fA-F]{6})"/)?.[1].toLowerCase();
    const background = css.match(/--background:\s*(#[0-9a-fA-F]{6})\s*;/)?.[1].toLowerCase();
    expect(background).toBeTruthy();
    expect(declared).toBe(background);
  });
});
