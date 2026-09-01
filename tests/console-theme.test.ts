import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE FOUR NUMBERS THE DESIGN SUPPLIED, PINNED WHERE THEY LIVE.
 *
 * Everything else in this kit is argued: a ratio is measured, a radius is
 * justified against the reference, a spacing follows from a rhythm. These four
 * are not. They arrived as values — "the light blue is 00C0E8", "the background
 * is 1B191A", "all buttons and timeline buttons have 999 radius", "the spacing
 * between the icons in the left navbar is 8px" — and a supplied value has no
 * internal reason a later refactor can rediscover.
 *
 * That is exactly the class of constant that drifts silently. `#00c0e8` looks
 * like a colour somebody chose and could re-choose; `gap-2` looks like a
 * spacing that could round to `gap-1.5` in a tidy-up and nobody would blink.
 * The ratios in globals.css defend themselves — change the ground and the
 * numbers beside it become provably wrong. These do not, so they are defended
 * here.
 *
 * This test says nothing about whether the values are GOOD. It says they are
 * the ones that were asked for, which is the only claim available about a
 * supplied constant.
 *
 * Sabotage-verified: each of the four assertions fails alone when its value is
 * changed at its source.
 */
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const css = read("src/app/globals.css");
const button = read("src/components/ui/button.tsx");
const page = read("src/components/ui/page.tsx");
const sidebar = read("src/components/sidebar.tsx");

/** globals.css with every comment removed, so prose cannot answer for a value. */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** A declaration's value. Comments stripped; first match wins. */
function token(name: string): string | null {
  return bare.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim().toLowerCase() ?? null;
}

/**
 * The same, but read from inside `.dark`. Necessary rather than fussy: the two
 * themes declare the SAME role names, `:root` comes first, and several roles
 * legitimately differ between them — `--canvas-bg` is #f5f5f5 on the light page
 * and near-black on the console. An unscoped lookup silently answers with the
 * light value and the assertion then tests the wrong theme.
 */
function darkToken(name: string): string | null {
  const start = bare.indexOf(".dark {");
  const block = bare.slice(start, bare.indexOf("\n}", start));
  return block.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim().toLowerCase() ?? null;
}

describe("the console's supplied constants", () => {
  it("fills with #00c0e8 and grounds on #1b191a", () => {
    // The blue is the FILL step, because it was supplied as the shape of a
    // button — `--primary` reads `brand-600` and nothing else may be the
    // primary. The ground is `neutral-950`, which every surface is cut from.
    expect(token("color-brand-600")).toBe("#00c0e8");
    expect(token("color-neutral-950")).toBe("#1b191a");
    expect(token("primary")).toBe("var(--color-brand-600)");
  });

  it("keeps the canvas and the chrome on one colour", () => {
    // Not decoration: the canvas was FROZEN at #1b191a while the chrome sat
    // four counts off it, and globals.css carried a note admitting the gap.
    // The ground moving to meet it is what closed that, so if the two ever
    // diverge again the note above `--canvas-bg` is a lie.
    expect(darkToken("canvas-bg")).toBe(token("color-neutral-950"));
  });

  it("draws every button and every period pill as a full capsule", () => {
    // On `buttonVariants`' BASE, not on `--radius-control`: that token was
    // 9999px for one commit and 51 files inherited it, so fields, menu rows and
    // small panels all went capsule-shaped. The token must stay a rectangle.
    expect(button).toMatch(/"inline-flex shrink-0[^"]*\brounded-full\b/);
    expect(page).toMatch(/PERIOD_PILL =\s*\n?\s*"[^"]*\brounded-full\b/);
    expect(token("radius-control")).toBe("var(--radius-md)");
    expect(token("radius-md")).toBe("0.5rem");
  });

  it("spaces the rail's icons 8px apart, in both of its groups", () => {
    // The rail has TWO stacks — the scrolling nav and the pinned foot — and
    // they have to agree, or the gap changes halfway down a single column of
    // icons. Both were `gap-0.5` (2px).
    const gaps = [...sidebar.matchAll(/flex[^"]*\bflex-col\b[^"]*\bgap-(\S+)/g)].map((m) => m[1]);
    expect(gaps.length).toBeGreaterThanOrEqual(2);
    for (const g of gaps) expect(g, "a rail column that is not 8px apart").toBe("2");
  });

  it("keeps the period control's groove — only its corners were asked to move", () => {
    /**
     * A REGRESSION TEST FOR OVER-REACH, not for a value.
     *
     * The brief was "all buttons and timeline buttons have 999 radius". The
     * pass that implemented it also deleted the track's border, its fill and
     * its enclosure, leaving six bare labels on the page — a redesign nobody
     * asked for, delivered under a radius change. This asserts the three
     * properties that were silently dropped, so the next tidy-up of this
     * control has to be deliberate about losing them.
     */
    const track = page.match(/PERIOD_TRACK =\s*\n?\s*"([^"]+)"/)?.[1] ?? "";
    expect(track, "the groove lost its border").toMatch(/\bborder-border\b/);
    expect(track, "the groove lost its fill").toMatch(/\bbg-control\b/);
    expect(track, "the groove lost its enclosure").toMatch(/\boverflow-hidden\b/);
    // And the part that WAS asked for: both the track and its segments are
    // capsules, which is what makes a lit segment sit inside the groove
    // instead of rattling around in a rectangle.
    expect(track).toMatch(/\brounded-full\b/);
  });

  it("fills the Add button with literal white", () => {
    // Specified as a colour rather than a role, and #FFFFFF is not any token:
    // `--foreground` — the nearest role, and how `default` gets a light button
    // on the console — is #E8E6E7, four counts off.
    expect(button).toMatch(/white:\s*"[^"]*\bbg-white\b/);
    expect(read("src/app/dashboard/custom-board.tsx")).toMatch(/variant="white"[\s\S]{0,200}?>\s*<Plus \/>\s*Add\b/);
  });

  it("gives a workspace chip its fill and its ink from the same key", () => {
    /**
     * THE BUG THIS EXISTS FOR ALREADY SHIPPED ONCE. The chip used to sit on a
     * hue derived from the workspace name and drew its initials in a
     * hard-coded `text-white`. When the colours were removed the FILL left and
     * the INK stayed, so every chip was white-on-white in the light theme —
     * present in the DOM, announced to a screen reader, invisible.
     *
     * So the assertion is structural rather than chromatic: both halves are
     * set together, from one `key`, in the style attribute — and neither is a
     * class that a call site could drop half of.
     */
    const chip = sidebar.match(/export function WorkspaceChip[\s\S]*?\n}/)?.[0] ?? "";
    expect(chip).toMatch(/const key = workspaceHue\(/);
    expect(chip).toMatch(/style=\{\{\s*background: groupBadge\(key\),\s*color: groupInk\(key\)\s*\}\}/);
    expect(chip, "an ink class can outlive the fill it was solved against").not.toMatch(/text-white|text-background/);
  });
});
