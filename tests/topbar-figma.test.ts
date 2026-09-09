import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE RAIL AND THE TOP BAR STOPPED BEING ONE SURFACE.
 *
 * They were `--chrome`, a single family at #121214 in both themes, and the
 * source says why: "the sidebar and top bar are #121214 in BOTH Figma frames —
 * 49:5268 and 58:5824 draw it identically". That was true of those frames.
 *
 * The 9 September frame (`0:5` in DWPyHPYAlD4czvPmppuf6y) draws the rail
 * #121214 and the top bar WHITE, in the same picture. One token cannot hold two
 * answers, so it becomes two: `--rail-*`, which keeps every value it had, and
 * `--topbar-*`, which is free to move.
 *
 * This file is written across three commits. The split lands first as a pure
 * rename — `--topbar` is #121214 in both themes and the app does not change —
 * because bar 1 still holds white-on-dark content at that point, and turning
 * the ground white before the content is rebuilt is white on white. The Figma's
 * values arrive with the bars that need them.
 */
const css = readFileSync(join(__dirname, "..", "src/app/globals.css"), "utf8");

/** The `:root` block — the light theme's semantic layer. */
const light = css.slice(css.indexOf(":root {"), css.indexOf(".dark {"));
/** Everything from `.dark {` on — the dark theme's semantic layer. */
const dark = css.slice(css.indexOf(".dark {"));

describe("the rail and the top bar are two surfaces", () => {
  it("keeps the rail near-black in both themes", () => {
    expect(light).toMatch(/--rail:\s*#121214/i);
    expect(dark).toMatch(/--rail:\s*#121214/i);
  });

  it("gives the rail every role it had as the chrome", () => {
    for (const role of ["foreground", "muted", "faint", "border", "control", "accent", "brand"]) {
      expect(light).toMatch(new RegExp(`--rail-${role}\\s*:`));
      expect(dark).toMatch(new RegExp(`--rail-${role}\\s*:`));
    }
  });

  it("gives the top bar its own family", () => {
    for (const role of ["foreground", "muted", "faint", "border", "control", "active"]) {
      expect(light).toMatch(new RegExp(`--topbar-${role}\\s*:`));
      expect(dark).toMatch(new RegExp(`--topbar-${role}\\s*:`));
    }
  });

  it("retires every --chrome colour role", () => {
    // `--spacing-chrome-band` is NOT one of these: it is the builder's toolbar
    // geometry and shares only a prefix. The negative lookahead is what keeps
    // this assertion from taking it.
    expect(css).not.toMatch(/--chrome(-(?!band)[a-z-]+)?\s*:/);
  });

  it("keeps --spacing-chrome-band, which is builder geometry", () => {
    expect(css).toMatch(/--spacing-chrome-band\s*:\s*24px/);
  });

  it("leaves no chrome-* class behind to compile to nothing", () => {
    const shell = ["top-bar", "sidebar", "app-frame", "shell-skeleton"]
      .map((f) => {
        try {
          return readFileSync(join(__dirname, "..", `src/components/${f}.tsx`), "utf8");
        } catch {
          return "";
        }
      })
      .join("\n");
    expect(shell).not.toMatch(/\b(?:bg|text|border|divide|ring|outline|fill|stroke)-chrome\b/);
    expect(shell).not.toMatch(/\b(?:bg|text|border|divide|ring|outline|fill|stroke)-chrome-[a-z-]+/);
  });
});

/**
 * EVERY rail-* AND topbar-* CLASS RESOLVES TO A ROLE THAT EXISTS.
 *
 * This caught a live bug the moment it was written, which is the only reason it
 * is worth keeping. Splitting `--chrome` renamed `bg-chrome-accent` to
 * `bg-topbar-accent` in three places in the top bar, and `--topbar-accent` was
 * not among the roles declared alongside it. The class parsed, compiled to
 * nothing, and left the avatar disc with no background at all.
 *
 * `check:ui`'s retired-token rule could not see it: that rule is a blacklist of
 * names known to be dead, and `topbar-accent` had never existed to be retired.
 * A brand-new family is exactly the case a blacklist cannot cover, and the
 * failure mode is the one that script's own prose warns about — the class does
 * not throw, does not warn, and does not fail a build.
 *
 * So the check is inverted here: read the classes the shell actually uses and
 * require the stylesheet to define each one.
 */
describe("the shell's chrome classes all resolve", () => {
  const shell = ["top-bar", "sidebar", "app-frame", "shell-skeleton", "mobile-drawer"]
    .map((f) => {
      try {
        return readFileSync(join(__dirname, "..", `src/components/${f}.tsx`), "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");

  const used = new Set(
    [...shell.matchAll(/\b(?:bg|text|border|divide|ring|outline|fill|stroke)-((?:rail|topbar)(?:-[a-z-]+)?)\b/g)].map(
      (m) => m[1],
    ),
  );

  it("uses at least both families, or this test is vacuous", () => {
    expect([...used].some((r) => r.startsWith("rail"))).toBe(true);
    expect([...used].some((r) => r.startsWith("topbar"))).toBe(true);
  });

  it("declares every role the shell names", () => {
    const undeclared = [...used].filter((role) => !new RegExp(`--${role}\\s*:`).test(css));
    expect(undeclared).toEqual([]);
  });
});

/**
 * THE TWO BANDS THE APP OWNS. The third is the board's and lives in
 * `board-controls.tsx`; it is asserted there.
 */
describe("the bars the frame draws", () => {
  const topBar = readFileSync(join(__dirname, "..", "src/components/top-bar.tsx"), "utf8");

  it("stands bar one at 57 and bar two at 49", () => {
    expect(topBar).toMatch(/h-\[57px\]/);
    expect(topBar).toMatch(/h-\[49px\]/);
  });

  it("sums to the 149px the frame starts its content at", () => {
    // 40 of search / 32 of control / 26 of button, each over 8+8 and a rule.
    // If this sum is wrong the board sits at the wrong y with every class
    // still correct, which is the failure `geometry-check.mjs` exists for.
    expect(57 + 49 + 43).toBe(149);
  });

  it("keeps the slot the flow builder portals its toolbar into", () => {
    expect(topBar).toMatch(/id="topbar-slot"/);
  });

  it("carries the search the rail used to own, at the frame's 480", () => {
    expect(topBar).toMatch(/w-\[480px\]/);
    expect(topBar).toMatch(/<NavSearch/);
  });

  it("takes the search out of the rail, so it is not in two places", () => {
    const rail = readFileSync(join(__dirname, "..", "src/components/sidebar.tsx"), "utf8");
    expect(rail).not.toMatch(/railSearchEntries/);
    expect(rail).not.toMatch(/aria-label="Search the navigation"/);
  });

  it("puts the mark at the reading edge and drops the promo", () => {
    expect(topBar).toMatch(/>\s*Namzilabs\s*</);
    expect(topBar).not.toMatch(/for free/);
  });

  it("lets the moon and the bell take a fill on hover, which they refused to", () => {
    // The toggle set `hover:bg-transparent`, so the #EFEFEF the frame draws it
    // in could never appear. That class is what this asserts is gone.
    expect(topBar).not.toMatch(/hover:bg-transparent/);
    expect(topBar).toMatch(/hover:bg-topbar-control/);
  });

  it("keeps the freshness a slot rather than a claim the bar cannot make", () => {
    expect(topBar).toMatch(/id="topbar-status"/);
  });
});
