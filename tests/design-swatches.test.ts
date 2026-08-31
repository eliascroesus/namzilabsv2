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
    // `ink-*` WAS the second ramp here. It was the dark-surface ladder, and it
    // existed because the product was a dark band around a light page and
    // needed two greys. One surface, one ramp: both the surface half and the
    // ink half of the page's tables are now `neutral-*`.
    expect(rows.some((r) => r.cls.startsWith("neutral-"))).toBe(true);
    expect(rows.some((r) => r.cls === "neutral-950")).toBe(true);
  });

  for (const { cls, hex } of rows) {
    it(`${cls} is captioned ${hex}`, () => {
      expect(hex).toBe(token(`color-${cls}`));
    });
  }
});

/**
 * THE SAME PROMISE, FOR THE TYPE TABLE — which did not have one, and drifted
 * the first time the scale moved.
 *
 * The kit page prints a pixel value beside every step. When the scale was
 * re-pitched onto Untitled UI's, `text-title` went 17px → 18px and the page
 * carried on claiming 17px: a documentation page stating a number the product
 * contradicts, with nothing to notice. Colour captions have been pinned since
 * the day they were written; this is the other half of the same table.
 */
describe("the /design type captions match the scale", () => {
  const rows = [...page.matchAll(/\{\s*token:\s*"text-([a-z-]+)",[^}]*?px:\s*"(\d+)px"/g)].map((m) => ({
    token: m[1],
    px: Number(m[2]),
  }));

  it("finds the table (a parse matching nothing would pass everything)", () => {
    expect(rows.length).toBeGreaterThanOrEqual(6);
  });

  for (const { token: name, px } of rows) {
    it(`text-${name} is captioned ${px}px`, () => {
      const m = css.match(new RegExp(`--text-${name}:\\s*([0-9.]+)rem\\s*;`));
      expect(m, `--text-${name} is not a rem literal in globals.css`).toBeTruthy();
      // 16px root, which is what every browser ships and nothing here changes.
      expect(Number(m![1]) * 16).toBe(px);
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

  /**
   * ONE COLOUR, BECAUSE THERE IS ONE THEME.
   *
   * This used to assert a media-query PAIR — a light answer and a dark one —
   * and the pair is now the bug rather than the fix. With the light theme gone,
   * a `prefers-color-scheme: light` entry would paint the address bar `#f5f5f5`
   * above an app that is `#0f1011` on every machine, for every visitor whose OS
   * happens to be set to light. So the shape being pinned is a bare string, and
   * the assertion below is what stops the pair growing back.
   */
  const declared = layout.match(/themeColor:\s*"(#[0-9a-fA-F]{6})"/)?.[1].toLowerCase();

  it("declares exactly one themeColor, with no per-scheme split", () => {
    expect(declared).toBeTruthy();
    expect(layout).not.toMatch(/prefers-color-scheme/);
    expect(layout).toMatch(/colorScheme:\s*"dark"/);
  });

  /**
   * `--background` is an alias in `:root` (it points at the neutral ramp), so
   * it is resolved one hop rather than re-typed here — which is the whole
   * point: the meta tag and the stylesheet must not be able to hold two
   * different opinions.
   */
  const resolve = (selector: string) => {
    const src = css.match(new RegExp(`(?:^|\\n)${selector}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
    const direct = src.match(/--background:\s*(#[0-9a-fA-F]{6})\s*;/)?.[1];
    if (direct) return direct.toLowerCase();
    const alias = src.match(/--background:\s*var\(--([a-z0-9-]+)\)/)?.[1];
    return css.match(new RegExp(`--${alias}:\\s*(#[0-9a-fA-F]{6})`))?.[1].toLowerCase();
  };

  it("equals --background in :root", () => {
    const background = resolve(":root");
    expect(background).toBeTruthy();
    expect(declared).toBe(background);
  });

  /**
   * THE THEME THAT IS GONE MUST STAY GONE. A `.dark` block reappearing in
   * globals.css means either the light theme came back without this file
   * hearing about it, or forty roles are being kept in step by hand again.
   */
  it("has no .dark role block to disagree with", () => {
    expect(css).not.toMatch(/(?:^|\n)\.dark\s*\{/);
  });
});
