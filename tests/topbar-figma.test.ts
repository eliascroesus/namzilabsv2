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

/** The `:root` block — the light mode's semantic layer. */
const light = css.slice(css.indexOf(":root {"), css.indexOf(".dark {"));
/** `.dark {` up to `.mix {` — the dark mode's semantic layer, and ONLY it. */
const dark = css.slice(css.indexOf(".dark {"), css.indexOf(".mix {"));
/** The `.mix` block — a near-black rail over light content. */
const mix = css.slice(css.indexOf(".mix {"));

describe("the rail and the top bar are two surfaces", () => {
  it("draws the rail on its own ground in each of the three modes", () => {
    // IT USED TO BE ONE VALUE, and this assertion said so: #121214 in both
    // themes, because 49:5268 and 58:5824 drew it identically. The 10
    // September frames draw it three ways, and the SPLIT between `--rail-*`
    // and `--topbar-*` is what makes that a change to CSS rather than to the
    // shell — which is the thing this file exists to protect.
    expect(light).toMatch(/--rail:\s*#f3f3f3/i);
    expect(mix).toMatch(/--rail:\s*#121212/i);
    expect(dark).toMatch(/--rail:\s*#121212/i);
  });

  it("keeps the bar WHITE over both of the light-content modes", () => {
    // The rail moving must not drag the bar with it: `.mix` is a near-black
    // rail against a white bar, which only works while these are two families.
    expect(light).toMatch(/--topbar:\s*#ffffff/i);
    expect(mix).not.toMatch(/--topbar:/);
    // #151515 THROUGH THE RAMP, not as a literal — it is the same value the
    // button face takes, and naming it once is what keeps the bar and the
    // controls on one material when either moves.
    expect(dark).toMatch(/--topbar:\s*var\(--color-neutral-925\)/i);
  });

  it("gives the rail every role it had as the chrome, in all three modes", () => {
    for (const role of ["foreground", "muted", "faint", "border", "control", "accent", "brand"]) {
      expect(light, `:root is missing --rail-${role}`).toMatch(new RegExp(`--rail-${role}\\s*:`));
      expect(dark, `.dark is missing --rail-${role}`).toMatch(new RegExp(`--rail-${role}\\s*:`));
      // A role `.mix` forgets inherits the LIGHT value onto a near-black
      // column — near-black ink on near-black, visible only by looking.
      expect(mix, `.mix is missing --rail-${role}`).toMatch(new RegExp(`--rail-${role}\\s*:`));
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

  it("stands as ONE band of 56, because there is one band now", () => {
    // It was two, 57 and 49. Node 35:6027 draws a single 56px strip — 16 of
    // top padding, a 32px control row, 8 under it — and the band that carried
    // the search and the account is gone entirely.
    expect(topBar).toMatch(/h-14\b/);
    expect(topBar, "the old pair must not survive").not.toMatch(/h-\[57px\]|h-\[49px\]/);
  });

  it("draws no rule under itself, because the board's row carries it", () => {
    // Node 35:6027 has no border; node 35:6044 below it has
    // `border-bottom: 1px solid #E1E1E1`. Two rules 57px apart is the
    // double-seam this kit argues against everywhere else.
    expect(topBar).not.toMatch(/border-b border-topbar-border/);
  });

  it("sums to 113, which is where the board starts", () => {
    // 56 of chrome + 57 of the board's own row. If this sum is wrong the board
    // sits at the wrong y with every class still correct, which is the failure
    // `geometry-check.mjs` exists for.
    expect(56 + 57).toBe(113);
  });

  it("keeps the slot the flow builder portals its toolbar into", () => {
    expect(topBar).toMatch(/id="topbar-slot"/);
  });

  it("carries no search, because the rail owns it again", () => {
    // Node 0:5 drew the field here at 480x40 and none in the rail; node
    // 35:5931 draws it in the rail and none here. This reverses, and the
    // assertion reverses with it — the product must have ONE search, and this
    // pair is what stops it having two.
    expect(topBar).not.toMatch(/NavSearch|w-\[480px\]/);
    const rail = readFileSync(join(__dirname, "..", "src/components/sidebar.tsx"), "utf8");
    expect(rail).toMatch(/aria-label="Search the navigation"/);
    expect(rail).toMatch(/railSearchEntries/);
  });

  it("carries no account and no mark either — both left with the band", () => {
    // The avatar went to the rail's foot (node 35:6000). The wordmark is
    // deleted rather than moved: no 10 September frame draws a product name
    // anywhere in the chrome, and the argument that took it off once already
    // still holds. The gift went with it — node 51:5756 put it here and these
    // frames draw nothing like it.
    expect(topBar).not.toMatch(/>\s*Namzilabs\s*</);
    expect(topBar).not.toMatch(/for free|<Gift/);
    expect(topBar, "the avatar is the rail's now").not.toMatch(/account\.initials/);
    const rail = readFileSync(join(__dirname, "..", "src/components/sidebar.tsx"), "utf8");
    expect(rail).toMatch(/aria-label="Your profile"/);
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

  it("is a band in the CHROME, with no container left to escape", () => {
    /**
     * IT WAS `-m-6 mb-6 … sticky top-0`, and all three classes existed to
     * survive being inside `PageContainer`: the negative margin escaped the
     * page's 24px, the bottom margin put it back, and `sticky` pinned it
     * against a scroller it should never have been in.
     *
     * It is a sibling of the top bar now (`AppFrame`'s `band` prop), so it
     * sits in the chrome's own box: no margin to cancel, no scroller to pin
     * against, and the 24px beneath it is `PageContainer`'s own `pt-6` — one
     * owner for that distance rather than two that had to agree.
     *
     * `pb-4 pt-2` is node 35:6044's `padding: 8px 24px 16px` and survives.
     */
    expect(page).toMatch(/band \? "border-b border-topbar-border bg-topbar px-6 pb-4 pt-2"/);
    expect(page, "nothing left to escape").not.toMatch(/-m-6 mb-6 border-b border-topbar-border/);
    expect(page, "and nothing left to pin against").not.toMatch(/sticky top-0 z-20 -m-6/);
  });

  it("draws the tabs as pills with the frame's own padding and gaps", () => {
    expect(controls).toMatch(/gap-1\.5 rounded-control px-2\.5 py-1\.5/);
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

  it("stands its controls at the kit's one height, with no rung of their own", () => {
    /**
     * WAS the frame's 26px, in a `bar` rung added for it. Node 0:5 draws a 26px
     * control and a 43px third bar; at that size a 13px label sits in a box
     * half again its height and the whole chrome reads smaller than the CRM the
     * frame was drawn against, which measures ~32px on the same control.
     * `button.tsx`'s own note had it right — ONE control height — so the rung is
     * gone rather than retuned, and the bars follow: 57 + 49 + 49 = 155.
     */
    const button = readFileSync(join(__dirname, "..", "src/components/ui/button.tsx"), "utf8");
    expect(button, "no second control height").not.toMatch(/^\s*bar: "/m);
    expect(button).toMatch(/default: "h-8 px-3 text-button/);
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
    expect(board).toMatch(/<TopBarTitle range=/);
    expect(board).toMatch(/viewTabs\.find\(\(v\) => v\.id === activeView\)\?\.name/);
  });

  it("hands the title the RESOLVED window, not the preset's label", () => {
    /**
     * Node 35:6028 draws "Overview - Sat, 1 Sep - Sat, 1 Sep" while the control
     * to its right reads "Today". They are not duplicates: one is the name of a
     * choice, the other is what that choice currently means, and a preset's
     * meaning moves under it every midnight. `labelForRange` answers the first
     * question and would make this strip say "Today - Today".
     */
    expect(board).toMatch(/windowLabel\(range\)/);
    expect(board, "not the preset's word").not.toMatch(/<TopBarTitle range=\{labelForRange/);
  });

  it("passes a measured freshness rather than a string the bar invents", () => {
    expect(board).toMatch(/<TopBarFreshness at=\{newestComputedAt\}/);
    expect(board).toMatch(/const newestComputedAt/);
  });

  it("draws both on the design harness, which is what gets compared to the frame", () => {
    // The harness has no board behind it, so it spells the frame's own window
    // rather than resolving one. It must still draw the CLUSTER — a harness
    // that shows a bare title is pixel-correct against a frame the real board
    // does not match, which is the failure this block already exists for.
    expect(harness).toMatch(/<TopBarTitle range="[^"]+">Overview<\/TopBarTitle>/);
    expect(harness).toMatch(/<TopBarFreshness/);
  });
});

/**
 * THE REAL BOARD'S CONTROLS, NOT THE HARNESS'S.
 *
 * This block exists because the harness lied by omission for two commits.
 * `/design/overview` builds its OWN four buttons — it has no board behind it,
 * so it cannot instantiate `AddChartMenu` or a refresh form — which means it
 * can be pixel-correct against the frame while the actual dashboard is not.
 * That is exactly what happened: Add stayed lime, Refresh kept a lowercase "a",
 * and Compare To was never added to the real row at all, while every screenshot
 * of the harness looked right.
 *
 * So the assertions below read `dashboard/page.tsx` and `custom-board.tsx` —
 * the files a customer actually sees — and the harness is checked separately
 * above. A design page that cannot drift from the product is worth more than
 * one that renders faster.
 */
describe("the board's own control row matches the frame", () => {
  const board = readFileSync(join(__dirname, "..", "src/app/dashboard/page.tsx"), "utf8");
  const canvas = readFileSync(join(__dirname, "..", "src/app/dashboard/custom-board.tsx"), "utf8");

  it("draws Add outlined, not filled with the brand", () => {
    expect(canvas).toMatch(/variant="white"/);
    expect(canvas).not.toMatch(/variant="accent"[^>]*onClick=\{\(\) => setOpen/);
  });

  it("carries Compare To, disabled until there is a series behind it", () => {
    expect(board).toMatch(/Compare To/);
    expect(board).toMatch(/disabled\s*\n\s*title="Comparison periods are not built yet"/);
  });

  it("capitalises Refresh All the way the frame does", () => {
    expect(board).toMatch(/Refresh All/);
    expect(board).not.toMatch(/>\s*Refresh all\s*</);
  });

  it("stands all four at the frame's 26px rung", () => {
    // RangeMenu's trigger lives in board-controls.tsx; the other three here.
    const controls = readFileSync(join(__dirname, "..", "src/app/dashboard/board-controls.tsx"), "utf8");
    // No `size` at all now — the kit's default IS the bar's height.
    expect(controls).toMatch(/variant="white"/);
    expect(board).not.toMatch(/size="bar"/);
    expect(canvas).not.toMatch(/size="bar"/);
  });
});

/**
 * THE BOARD THE CUSTOMER OPENS GETS THE BAND, and this is the third time a
 * change landed on the harness and not on it.
 *
 * `/design/overview` builds its own controls and passes its own props, so it
 * can be pixel-correct against the frame while `dashboard/page.tsx` is not. It
 * was, twice: Add stayed lime with Compare To missing, and then the third bar
 * kept `PageHeader`'s in-content padding while the harness had `band` — so the
 * board's controls sat on the page's own ground instead of on a white band,
 * which is the first thing anyone notices.
 *
 * Asserted as a PAIR rather than one file at a time. A prop that has to be
 * passed in two places is a prop that will be passed in one.
 */
describe("the harness and the board pass the same header", () => {
  const board = readFileSync(join(__dirname, "..", "src/app/dashboard/page.tsx"), "utf8");
  const harness = readFileSync(join(__dirname, "..", "src/app/design/overview/page.tsx"), "utf8");
  const header = (src: string) => src.slice(src.indexOf("<PageHeader"), src.indexOf("<PageHeader") + 1400);

  it("gives both the full-bleed band", () => {
    expect(header(board), "the real board's PageHeader").toMatch(/^\s*<PageHeader[\s\S]*?\bband\b/m);
    expect(header(harness), "the harness's PageHeader").toMatch(/^\s*<PageHeader[\s\S]*?\bband\b/m);
  });

  it("gives both the same tabs slot, so neither grows a second arrangement", () => {
    expect(header(board)).toMatch(/tabs=\{viewStrip\}/);
    expect(header(harness)).toMatch(/tabs=\{viewStrip\}/);
  });
});
