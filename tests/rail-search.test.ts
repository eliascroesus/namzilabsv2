import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { railSearchEntries, viewHref } from "@/lib/rail-search";

/**
 * THE RAIL'S SEARCH, WIRED — 7 Sep 2026.
 *
 * It was a `<Button>` with no handler, wearing `aria-keyshortcuts="Meta+K"` for
 * a palette nobody had built: the control announced a binding, looked like a
 * field, and did nothing at all. The owner asked "why is the search a button
 * and not an input field? it should be able to search like the different nav
 * things or like theme light and dark etc."
 *
 * Two halves are worth pinning. The ENTRIES are derived from the same arrays
 * the column renders — a second hand-written list would drift, and one of the
 * five destinations is rank-gated, so a private copy would happily offer a page
 * the rail deliberately hides. And the SHAPE: a real input, results in place of
 * the nav, because this column scrolls and would clip a floating panel.
 */
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
/**
 * THE FIELD WENT TO THE BAR AND CAME BACK, so the markup half of these tests
 * reads `sidebar.tsx` again.
 *
 * Node 0:5 drew the search at 480x40 in the top bar and none in the rail, and
 * for one day it lived in `nav-search.tsx`. Nodes 35:5920–35:5939 draw it back
 * in the column at 228x36 and draw none in the bar, so that file is deleted
 * and its behaviour is inline in the rail.
 *
 * THE DATA HALF NEVER MOVED — `railSearchEntries`, `viewHref` — which is why
 * this file did not split in two either time, and why the round trip cost one
 * constant here rather than a rewrite.
 */
const search = read("src/components/sidebar.tsx");
/** Comments explain the rules and must not be able to satisfy them. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const THEMES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;
const ITEMS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Flows", href: "/dashboard/flows" },
];

describe("what the rail's search can find", () => {
  it("offers the pages it was handed, and no others", () => {
    // `items` arrives ALREADY through the `hide` gate, which is the whole
    // reason this takes an array instead of reading NAV itself: a member
    // without `view_integrations` never sees Apps in the column, and must not
    // find it here either.
    const labels = railSearchEntries({ items: ITEMS, views: [], themes: THEMES })
      .filter((e) => e.kind === "page")
      .map((e) => e.label);
    expect(labels).toEqual(["Dashboard", "Flows"]);
    expect(labels, "a gated page cannot appear").not.toContain("Apps");
  });

  it("sends the default board to bare /dashboard, and a named view to its id", () => {
    // The default board has no `?view=` — it has no row until it is adopted.
    // Getting this wrong opens the default board with the wrong tab lit.
    expect(viewHref({ id: null, isDefault: true })).toBe("/dashboard");
    expect(viewHref({ id: "v9", isDefault: true })).toBe("/dashboard");
    expect(viewHref({ id: "v9" })).toBe("/dashboard?view=v9");
  });

  it("names a theme so the word people type is in the label", () => {
    /**
     * "Theme: Dark", not "Dark". Someone reaching for it types "theme" or
     * "dark" and only one of those is in a bare label — and a VIEW called
     * "Light" would otherwise be indistinguishable from the theme beside it.
     */
    const themes = railSearchEntries({ items: [], views: [], themes: THEMES }).filter((e) => e.kind === "theme");
    expect(themes.map((e) => e.label)).toEqual(["Theme: Light", "Theme: Dark", "Theme: System"]);
    expect(themes.every((e) => e.kind === "theme" && e.theme)).toBe(true);
  });

  it("keeps the three kinds distinguishable, because they are drawn differently", () => {
    // A destination is an <a> the browser can open in a new tab; setting the
    // theme is a press. The renderer branches on `kind`, so a kind that went
    // missing would render a theme as a link to nowhere.
    const kinds = new Set(
      railSearchEntries({ items: ITEMS, views: [{ id: "v1", name: "Ops" }], themes: THEMES }).map((e) => e.kind),
    );
    expect([...kinds].sort()).toEqual(["page", "theme", "view"]);
  });
});

describe("the rail draws it as a field, not a button", () => {
  it("types into a real Input carrying the shortcut it announces", () => {
    const c = code(search);
    expect(c).toMatch(/<input\b[\s\S]{0,600}aria-keyshortcuts="Meta\+K"/);
    expect(c, "and it is controlled").toMatch(/value=\{query\}/);
    expect(c, "no Button wearing the shortcut any more").not.toMatch(/<Button[^>]*aria-keyshortcuts/);
  });

  it("binds ⌘K to focus it, on the window", () => {
    /**
     * The attribute has announced this since the 264px column while nothing
     * implemented it — an a11y claim the product could not honour. A listener
     * on the FIELD could never fire: the field is what the shortcut focuses.
     */
    const c = code(search);
    expect(c).toMatch(/e\.key !== "k" \|\| !\(e\.metaKey \|\| e\.ctrlKey\)/);
    expect(c).toMatch(/field\.current\?\.focus\(\)/);
    expect(c).toMatch(/window\.addEventListener\("keydown"[\s\S]{0,60}capture: true/);
    expect(c, "and unbinds it").toMatch(/window\.removeEventListener\("keydown"/);
  });

  it("is gone from the BAR, so the product has one search and not two", () => {
    // The direction of this assertion has now flipped twice. What it protects
    // is unchanged: exactly one search in the chrome. `page-width.test.ts` and
    // `topbar-figma.test.ts` hold the other halves.
    const bar = read("src/components/top-bar.tsx");
    expect(bar).not.toMatch(/aria-keyshortcuts="Meta\+K"/);
    expect(bar).not.toMatch(/railSearchEntries/);
    expect(bar).not.toMatch(/role="listbox"/);
  });

  it("filters the column IN PLACE, because it still cannot float", () => {
    /**
     * THE CONSTRAINT, NOT A PREFERENCE — and there are two of them now, where
     * this comment used to name one. The <nav> is `overflow-y-auto`, which
     * makes it the clipping box for an absolutely-positioned child; the
     * <aside> around it is `overflow-hidden`, which makes it a second one.
     * Either alone cuts a dropdown off at the column's foot. Filtering in
     * place needs no portal and is what "search the nav things" means.
     *
     * The bar had neither box, which is why the field grew a floating panel
     * during its day there — and why that panel could not come back with it.
     */
    const c = code(search);
    expect(c).toMatch(/role="listbox"/);
    expect(c, "a non-empty query is what swaps the column").toMatch(/\{q \? \(/);
    expect(c, "no absolute panel under the field").not.toMatch(/absolute[^"]*top-full/);
    expect(c, "and none anywhere in the column").not.toMatch(/role="listbox"[\s\S]{0,200}absolute/);
  });

  it("filters over the SAME arrays the column renders", () => {
    // Not NAV and not `views` — `items` (post-`hide`) and `ordered` (sorted),
    // so the search cannot disagree with the rows above it.
    const c = code(search);
    expect(c).toMatch(/railSearchEntries\(\{/);
    expect(c).toMatch(/items: items\.map\(/);
    expect(c).toMatch(/views: ordered,/);
    expect(c).toMatch(/themes: CHOICES,/);
  });

  it("says so when nothing matches", () => {
    expect(code(search)).toMatch(/No matches\./);
  });
});
