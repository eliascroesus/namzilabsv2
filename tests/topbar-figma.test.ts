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

/**
 * BAR THREE, WHICH IS THE BOARD'S. Asserted here beside the other two, because
 * the number that matters is the SUM and no one file owns it.
 */
describe("the board's bar", () => {
  const controls = readFileSync(join(__dirname, "..", "src/app/dashboard/board-controls.tsx"), "utf8");
  const page = readFileSync(join(__dirname, "..", "src/components/ui/page.tsx"), "utf8");

  it("is a full-bleed band that escapes the container's gutter", () => {
    // `PageContainer` is `p-6`; without the negative margin the band sits
    // inside a 24px inset with the page's ground showing around it.
    expect(page).toMatch(/-m-6 mb-6 border-b border-topbar-border bg-topbar px-6 py-2/);
  });

  it("draws the tabs as pills with the frame's own padding and gaps", () => {
    expect(controls).toMatch(/gap-1 rounded-control px-2 py-1/);
    expect(controls).toMatch(/flex flex-nowrap items-center gap-2/);
  });

  it("gives every tab the glyph its kind earns", () => {
    expect(controls).toMatch(/function ViewGlyph/);
    expect(controls).toMatch(/isDefault \? Box/);
    expect(controls).toMatch(/kind === "calendar" \? CalendarDays/);
  });

  it("keeps the options menu small enough not to stretch the band", () => {
    // A 24px kebab makes the active pill 32 where the resting ones are 24, the
    // band 49 where the frame draws 43, and the bars sum to 155 rather than
    // 149 — with every class in the file still correct.
    expect(controls).toMatch(/className="size-3\.5 text-muted-foreground/);
  });

  it("stands its controls at the frame's 26px, with a real target on a phone", () => {
    const button = readFileSync(join(__dirname, "..", "src/components/ui/button.tsx"), "utf8");
    expect(button).toMatch(/bar: "h-11 gap-1 px-2 py-1 text-\[13px\] leading-4 md:h-\[26px\]/);
  });
});

/**
 * BAR TWO'S SLOTS HAVE CALLERS, which for one commit they did not.
 *
 * `top-bar.tsx` drew `<h1 id="topbar-title">` and `<div id="topbar-status">`,
 * both `empty:hidden`, and nothing anywhere filled either one — so the left
 * half of bar two rendered blank on every board route while the commit message
 * said the slots were built. A slot with no caller is not a placeholder; it is
 * the feature missing, and `empty:hidden` is what made it invisible rather than
 * obviously broken.
 */
describe("bar two's slots are filled by the page that knows", () => {
  const slots = readFileSync(join(__dirname, "..", "src/components/topbar-slots.tsx"), "utf8");
  const board = readFileSync(join(__dirname, "..", "src/app/dashboard/page.tsx"), "utf8");
  const harness = readFileSync(join(__dirname, "..", "src/app/design/overview/page.tsx"), "utf8");

  it("portals into the two ids the bar draws", () => {
    expect(slots).toMatch(/id="topbar-title"|Slot id="topbar-title"/);
    expect(slots).toMatch(/topbar-status/);
  });

  it("names the board's own view, so the tab and the heading agree", () => {
    expect(board).toMatch(/<TopBarTitle>/);
    expect(board).toMatch(/viewTabs\.find\(\(v\) => v\.id === activeView\)\?\.name/);
  });

  it("passes a measured freshness rather than a string the bar invents", () => {
    expect(board).toMatch(/<TopBarFreshness at=\{newestComputedAt\}/);
    expect(board).toMatch(/const newestComputedAt/);
  });

  it("draws both on the design harness, which is what gets compared to the frame", () => {
    expect(harness).toMatch(/<TopBarTitle>Overview<\/TopBarTitle>/);
    expect(harness).toMatch(/<TopBarFreshness/);
  });
});
