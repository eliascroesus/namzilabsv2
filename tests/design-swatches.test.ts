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
   * ONE COLOUR PER THEME, because there are two themes again.
   *
   * This has now been asserted three ways — a pair, then a bare string when the
   * light theme was deleted, and a pair again — which is exactly why it is
   * pinned at all: the tag is a build-time literal that no stylesheet can
   * reach, so it is the one colour in the product that cannot follow a token
   * and has to be checked instead.
   */
  const declared = [...layout.matchAll(/color:\s*"(#[0-9a-fA-F]{6})"/g)].map((m) => m[1].toLowerCase());

  it("declares one themeColor per scheme", () => {
    expect(layout).toMatch(/prefers-color-scheme: light/);
    expect(layout).toMatch(/prefers-color-scheme: dark/);
    expect(layout).toMatch(/colorScheme:\s*"light dark"/);
    expect(declared).toHaveLength(2);
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

  it("the light one equals --background in :root", () => {
    const background = resolve(":root");
    expect(background).toBeTruthy();
    expect(declared[0]).toBe(background);
  });

  it("the dark one equals --background in .dark", () => {
    const background = resolve("\\.dark");
    expect(background).toBeTruthy();
    expect(declared[1]).toBe(background);
  });

  /**
   * EVERY ROLE IS DECLARED IN BOTH BLOCKS, AND THIS IS THE HALF A MACHINE CAN
   * CHECK.
   *
   * A role present in one block and not the other inherits whatever the other
   * left behind — which is how the metric tile once carried ink solved for the
   * opposite surface and shipped muted labels at 2.52:1. Sixty-odd tokens kept
   * in step by hand is precisely the arrangement that produced that bug, so the
   * pairing is asserted rather than trusted.
   *
   * `--heading` is the newest example of why: it was `text-white` hard-coded for
   * the dark theme, and the moment light came back the page title was simply
   * not on the screen.
   */
  it("declares the same role names in both blocks", () => {
    const names = (selector: string) => {
      const src = css.match(new RegExp(`(?:^|\\n)${selector}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
      return new Set([...src.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]));
    };
    const light = names(":root");
    const dark = names("\\.dark");
    expect(light.size, "no :root roles found — the parser missed the block").toBeGreaterThan(20);
    expect([...light].filter((n) => !dark.has(n)), "declared in light but not dark").toEqual([]);
    expect([...dark].filter((n) => !light.has(n)), "declared in dark but not light").toEqual([]);
  });
});
