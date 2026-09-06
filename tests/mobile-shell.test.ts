import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE PHONE LAYOUT, PINNED WHERE IT ACTUALLY LIVES.
 *
 * Below `md` the rail is not rendered and a drawer carries it instead. Every
 * half of that is a class — `hidden md:block` on the footprint, `md:hidden`
 * on the trigger — so it is pinned as source, the way this shell's other
 * geometry already is. The one thing that is genuinely BEHAVIOUR (the drawer
 * opens, and closes when the route changes under it) is in
 * `tests/mobile-drawer.test.ts`, which pays for a DOM.
 */
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const sidebar = read("src/components/sidebar.tsx");
const drawer = read("src/components/mobile-drawer.tsx");
const bar = read("src/components/top-bar.tsx");
const frame = read("src/components/app-frame.tsx");
const skeleton = read("src/components/shell-skeleton.tsx");

describe("the rail below md", () => {
  it("is not rendered at all — footprint, panel and toggle together", () => {
    // The <aside> IS the footprint. Hiding the panel alone would leave a
    // 56px column of nothing on the left of every phone screen.
    expect(code(sidebar)).toMatch(/"relative z-20 hidden h-full shrink-0 md:block"/);
  });

  it("hands its content to a component both it and the drawer render", () => {
    expect(sidebar).toMatch(/export function RailContent\(/);
    expect(code(sidebar)).toMatch(/<RailContent hide=\{hide\} views=\{views\} workspace=\{workspace\} account=\{account\} \/>/);
    expect(code(drawer)).toMatch(/<RailContent[\s\S]{0,160}invite/);
  });

  it("is not copied into the drawer, which is the whole point", () => {
    /**
     * THE FAILURE THIS EXISTS TO STOP is a drawer that reimplements the rail
     * — two nav lists, two search rows, two answers to "which view am I on",
     * drifting apart on the first change to either. If any of these strings
     * appears in the drawer's own file, the tree was copied rather than
     * rendered.
     */
    for (const literal of ["Main Menu", "Get Free Access", "aria-keyshortcuts", "LayoutDashboard"]) {
      expect(drawer, `the drawer re-spells ${literal}`).not.toContain(literal);
    }
  });
});

describe("the drawer", () => {
  it("is the kit's sheet, on the left, at the export's width and fill", () => {
    expect(drawer).toContain('side="left"');
    expect(drawer).toContain("w-[280px]");
    expect(drawer).toContain("bg-chrome");
    expect(drawer).toContain("border-border");
  });

  it("hides the trigger with a class; closes the open panel with a breakpoint listener", () => {
    /**
     * SLICED OVER THE COMMENT-STRIPPED FILE, NOT THE RAW ONE. The comment
     * sitting between `</SheetTrigger>` and `<SheetContent` talks ABOUT
     * `md:hidden` (explaining why it is no longer there) — so a slice of the
     * raw source would find that literal string in the PROSE and pass this
     * assertion even if the class had been removed from the Button itself.
     * Stripping comments first is what lets a removed class actually fail
     * this test.
     */
    const stripped = code(drawer);
    const trigger = stripped.slice(stripped.indexOf("<SheetTrigger"), stripped.indexOf("<SheetContent"));
    expect(trigger).toContain("md:hidden");
    /**
     * THE PANEL DOES NOT HIDE ITSELF IN CSS ANY MORE. It used to carry
     * `md:hidden` too, and that was the bug: CSS can hide the PANEL, but
     * Radix's own dialog state — the overlay, the scroll lock, the focus
     * trap — all read `open`, not a media query, so a drawer left "open" in
     * React while a resize past 768px painted over it left that machinery
     * attached to a panel nobody could see or reach. It closes ITSELF at the
     * breakpoint instead, via `matchMedia`, so there is nothing left for a
     * class on `SheetContent` to hide.
     */
    expect(stripped.slice(stripped.indexOf("<SheetContent"))).not.toMatch(/className="[^"]*\bmd:hidden\b/);
    expect(drawer).toContain('window.matchMedia("(min-width: 768px)")');
    expect(stripped).toMatch(/query\.matches\)\s*setOpen\(false\)/);
    expect(stripped).toMatch(/addEventListener\("change", closeAboveMd\)/);
    expect(stripped).toMatch(/removeEventListener\("change", closeAboveMd\)/);
  });

  it("opens the rail's own tree by pinning it, not by re-styling it", () => {
    // `REVEAL` fades on `group-data-[pinned=true]/rail`. No wrapper, no
    // labels — this is the line that makes the reuse work.
    expect(code(drawer)).toMatch(/group\/rail[^"]*"[\s\S]{0,120}data-pinned="true"/);
  });

  it("closes on navigation, and on a change of view", () => {
    /**
     * `usePathname` ALONE IS NOT ENOUGH, and this is the assertion that says
     * why: the dashboard's views are `?view=` on one pathname, so a drawer
     * keyed on the path only would stay open over the board it just changed.
     * `sidebar.tsx` already calls `useSearchParams()` in this same tree, so
     * the dynamic-rendering cost was paid before this task existed.
     */
    expect(drawer).toContain("usePathname");
    expect(drawer).toContain("useSearchParams");
    expect(code(drawer)).toMatch(/useEffect\([\s\S]{0,120}setOpen\(false\)[\s\S]{0,80}\[pathname, search\]\)/);
  });

  it("carries the two acts the bar sheds", () => {
    expect(code(drawer)).toMatch(/invite\b/);
    expect(code(sidebar)).toMatch(/\{invite && \(/);
  });
});

describe("the top bar below md", () => {
  it("takes a menu slot and draws it before the mark", () => {
    const header = bar.slice(bar.indexOf("<header"));
    expect(header.indexOf("{menu}")).toBeGreaterThan(-1);
    expect(header.indexOf("{menu}")).toBeLessThan(header.indexOf("Namzilabs"));
    expect(code(frame)).toMatch(/<TopBar[\s\S]{0,240}menu=\{<MobileDrawer/);
  });

  it("draws the menu button at 32px, on the avatar circle, with its light-theme outline", () => {
    // Comment-stripped for the same reason the slice above is: the prose
    // between the tags is not code, and should not be able to satisfy a
    // check about it.
    const stripped = code(drawer);
    const trigger = stripped.slice(stripped.indexOf("<SheetTrigger"), stripped.indexOf("<SheetContent"));
    expect(trigger).toContain('size="icon"');
    // `border border-input` is the edge: in light, `--avatar` is white on a
    // white bar and the circle is invisible without it; in dark `--input`
    // aliases `--border` and the outline costs nothing. Bare `bg-avatar`
    // with no outline is the pre-fix bug (I1) and must not come back.
    expect(trigger).toContain("rounded-full border border-input bg-avatar");
  });

  it("draws the bar's bell and avatar circles with the same outline", () => {
    const stripped = code(bar);
    expect(stripped).toContain("relative rounded-full border border-input bg-avatar");
    expect(stripped).toContain("rounded-full border border-input bg-avatar text-xs font-semibold text-foreground");
  });

  it("drops both acts below md, and has no greeting left to drop", () => {
    /**
     * THERE IS NO GREETING ANY MORE, 6 SEP 2026. This used to assert that one
     * span carried `max-sm:hidden` (the phone) plus `peer-[:not(:empty)]:
     * hidden` (yielding the centre to the builder's portalled toolbar). The
     * owner had "Welcome back!" removed outright, so the span, both rules and
     * the `peer` they arbitrated are gone — a phone rule for an element that
     * does not render is a rule nobody can evaluate.
     *
     * What the phone still owes is below: the two ACTS step aside at `md`.
     */
    expect(code(bar), "no greeting to hide").not.toContain("Welcome back");
    // Exactly two controls step aside at `md` — Invite members and New flow.
    // Counted over the CODE: the note above them names both by hand, and a
    // rule that can read its own explanation counts to four.
    expect(code(bar).match(/hidden md:inline-flex/g) ?? []).toHaveLength(2);
    expect(code(bar)).toContain("Invite members");
    expect(code(bar)).toContain("New flow");
  });
});

describe("touch targets below md", () => {
  it("gives every rail row 44px, and hands it back at md", () => {
    expect(sidebar).toMatch(/const SLOT = "[^"]*\bmin-h-11\b[^"]*\bmd:min-h-0\b/);
  });

  it("gives the nested view rows the same, since they are nav rows too", () => {
    // The view link and the "Show all" fold, between `ViewList` and the
    // frame component below it. `SLOT` is a module constant above this
    // region, so its own `min-h-11` cannot be what satisfies the count.
    const list = sidebar.slice(sidebar.indexOf("const ViewList"), sidebar.indexOf("export function Sidebar"));
    expect(list.match(/min-h-11[^"]*md:min-h-0/g) ?? []).toHaveLength(2);
  });
});

describe("the skeleton mirrors the phone layout too", () => {
  it("reserves no rail below md", () => {
    expect(code(skeleton)).toMatch(/hidden w-\[56px\][^"]*md:block/);
  });

  it("drops the panel's corner below md, in both files", () => {
    expect(code(skeleton)).toContain("md:rounded-tr-frame bg-panel");
    expect(code(frame)).toContain("md:rounded-tr-frame bg-panel");
  });
});
