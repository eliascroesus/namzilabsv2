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
  it("is not rendered at all — the whole column, not just its contents", () => {
    // The <aside> IS the footprint. Hiding its contents alone would leave
    // 260px of empty column down the left of every phone screen — which is
    // most of the screen, and worse than the 56px this used to guard against.
    // `md:flex` rather than `md:block` since the panel and the footprint
    // became one element on 8 Sep 2026.
    expect(code(sidebar)).toMatch(/<aside className="relative z-20 hidden h-full w-65 shrink-0 flex-col[^"]*md:flex"/);
  });

  it("hands its content to a component both it and the drawer render", () => {
    /**
     * `invite` IS GONE FROM BOTH CALLS, and that is the arrangement changing
     * rather than the guarantee weakening. The prop existed so the drawer
     * could draw "Invite members" in the foot when the top bar shed it below
     * `md`; the 8 September Figma puts that control in the rail's foot
     * permanently and takes it out of the bar entirely, so there is no second
     * state for a prop to select. Both callers now render the same tree with
     * the same four props, which is a stronger version of the same claim.
     */
    expect(sidebar).toMatch(/export function RailContent\(/);
    const call = /<RailContent hide=\{hide\} views=\{views\} workspace=\{workspace\} account=\{account\} \/>/;
    expect(code(sidebar)).toMatch(call);
    expect(code(drawer)).toMatch(call);
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

  it("renders the rail's own tree plainly, with nothing left to open", () => {
    /**
     * IT USED TO HAVE TO PIN IT. Every label in that tree rode `REVEAL`, which
     * faded on hover, on focus-within, or on `group-data-[pinned=true]/rail`.
     * A touch screen produces neither of the first two, so the drawer wrapped
     * `RailContent` in a `group/rail` carrying `data-pinned="true"` and claimed
     * the third — a drawer being a rail held open.
     *
     * The rail has one width now and reveals nothing, so that attribute selects
     * a state that does not exist. Asserting its ABSENCE is what stops it being
     * carried forward as cargo: a `data-pinned` nothing reads looks load-bearing
     * to whoever finds it next.
     */
    expect(code(drawer)).not.toMatch(/data-pinned/);
    expect(code(drawer)).not.toMatch(/group\/rail/);
    // The reuse itself is asserted above; this is only about how it is wrapped.
    expect(code(drawer)).toMatch(/<div className="flex h-full min-h-0 flex-col overflow-y-auto">/);
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

  it("needs nothing shed to it any more, because the rail owns both acts", () => {
    /**
     * The bar used to carry "Invite members" and "New flow" above `md` and
     * hand them to the drawer's foot below it — which is why the drawer set
     * `invite` and the rail did not. Both now live in the rail's own foot at
     * every width (nodes 49:5734 and 49:5744), so the drawer gets them by
     * rendering `RailContent` like everything else, and the conditional that
     * used to gate one of them is gone.
     */
    expect(code(sidebar), "the invite card is unconditional now").not.toMatch(/\{invite && \(/);
    expect(code(sidebar)).toContain("Invite Members");
    expect(code(sidebar), "and the act under it").toMatch(/>New</);
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

  it("keeps the avatar's circle, and lets the bell off its plate", () => {
    /**
     * THEY USED TO MATCH, AND THE FIGMA SEPARATES THEM. Both were a 32px
     * `--avatar` disc with an `--input` outline, on the argument that two
     * round controls a centimetre apart should be one object drawn twice.
     *
     * Node 49:5370 draws the avatar as a filled disc — it holds your initials,
     * so it needs a surface for them to sit on — and the bell as a bare glyph
     * beside the moon and the gift, which are also bare. The bell belongs to
     * THAT group now, not to the avatar; giving it a plate the other two lack
     * would make it read as the only pressable thing among three.
     */
    const stripped = code(bar);
    // `--chrome-*` since the bar became a permanently dark band: `bg-avatar`
    // and `text-foreground` are content roles that invert with the theme, and
    // this surface does not.
    expect(stripped, "the avatar keeps its disc").toContain(
      "rounded-full bg-chrome-accent text-xs font-semibold text-chrome-foreground",
    );
    expect(stripped, "the bell is bare, like the moon and the gift beside it").not.toContain(
      "relative rounded-full border border-input bg-avatar",
    );
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
    /**
     * AND NOTHING LEFT TO SHED EITHER, AS OF 8 SEP 2026. The two acts did not
     * get a better phone rule — they left the bar. "Invite members" is a card
     * in the rail's foot and "New flow" is the lime "New" under it, at every
     * width, so there is no `hidden md:inline-flex` pair here to count.
     *
     * What the phone still owes is the SHARE control and the account name,
     * which are this bar's own and step aside rather than move.
     */
    expect(code(bar), "the acts moved to the rail, not to a media query").not.toContain("New flow");
    expect(code(bar)).not.toContain("Invite members");
    expect(code(bar), "Share is the bar's own, and it steps aside").toContain("md:inline-flex");
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
    // `w-65` since 8 Sep 2026 — the rail is a constant 260px above `md` and is
    // not rendered below it, so what the ghost mirrors is the ABSENCE, and the
    // width it reserves when present had to follow the rail up from 56.
    expect(code(skeleton)).toMatch(/hidden w-65[^"]*md:block/);
  });

  it("drops the panel's corner below md, in both files", () => {
    expect(code(skeleton)).toContain("md:rounded-tr-frame bg-panel");
    expect(code(frame)).toContain("md:rounded-tr-frame bg-panel");
  });
});
