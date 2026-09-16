import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { orderViews, stripSignature } from "@/lib/board/strip-order";

/**
 * THE RANGE THAT KEPT RESETTING TO "LAST 7 DAYS" — 16 Sep 2026.
 *
 * The owner reported it three times, and the first two fixes were aimed at the
 * wrong layer: `boardHref` carries the range correctly, the page's `qs()` merges
 * it correctly, and the rail reads it live off the URL. Every href in the
 * product was right. The strip simply was not re-rendering the ones it had.
 *
 * It held the tab OBJECTS in `useState` and re-synced them on a signature of
 * `key:pos` — which is stable across exactly the change that matters, because
 * picking a window rewrites every `href` and touches neither key nor pos. So
 * the tabs went on pointing at the window the page was opened with.
 *
 * These test the two halves of the rule that replaced it: the signature still
 * means "which views, in what order" (so a drag is not reset by a navigation),
 * and the order is a list of KEYS resolved against the live views (so nothing
 * but the order can ever be stale).
 */

type Tab = { key: string; pos: string; href: string; name: string };

const tabs = (range: string | null): Tab[] =>
  ["default", "calls", "money"].map((key, i) => ({
    key,
    pos: `a${i}`,
    name: key,
    href: range ? `/dashboard?range=${range}&view=${key}` : `/dashboard?view=${key}`,
  }));

describe("the signature says which views exist, not what they link to", () => {
  it("does not change when only the hrefs are rebuilt", () => {
    /**
     * THE PROPERTY THE OLD CODE RELIED ON AND THE NEW CODE STILL NEEDS. The
     * effect this feeds resets a drag in progress, so a navigation must not
     * fire it. That is correct — and it is also why the tab objects could not
     * live behind it.
     */
    const before = stripSignature(tabs(null));
    const after = stripSignature(tabs("2026-09-01..2026-09-16"));
    expect(after).toBe(before);
  });

  it("changes when a view is added, removed or reordered", () => {
    const base = stripSignature(tabs(null));
    expect(stripSignature(tabs(null).slice(0, 2)), "a deleted view").not.toBe(base);
    expect(stripSignature([...tabs(null), { key: "new", pos: "a9", name: "New", href: "/x" }]), "an added view").not.toBe(base);
    const moved = tabs(null).map((t) => (t.key === "money" ? { ...t, pos: "a0h" } : t));
    expect(stripSignature(moved), "a reordered view").not.toBe(base);
  });
});

describe("the strip's order resolves against the live views", () => {
  it("picks up a rebuilt href without the order changing at all", () => {
    /**
     * THE REGRESSION, EXACTLY AS THE OWNER HIT IT. The strip is holding an
     * order it took when the board had no window. The user then draws
     * 1–16 Sep, the server rebuilds every href, and the signature — correctly —
     * does not move. What the strip renders must still be the NEW hrefs.
     *
     * The old code stored the tab objects, so this returned the first list and
     * "Calls" navigated to a URL with no `range=` in it.
     */
    const held = tabs(null).map((t) => t.key);
    const fresh = tabs("2026-09-01..2026-09-16");

    const rendered = orderViews(held, fresh);

    expect(rendered.map((t) => t.href)).toEqual([
      "/dashboard?range=2026-09-01..2026-09-16&view=default",
      "/dashboard?range=2026-09-01..2026-09-16&view=calls",
      "/dashboard?range=2026-09-01..2026-09-16&view=money",
    ]);
    expect(rendered.every((t) => t.href.includes("range=")), "every tab carries the drawn window").toBe(true);
  });

  it("keeps a local reorder while still taking the fresh hrefs", () => {
    // Both halves at once: the drag is the strip's to remember, the link is not.
    const dragged = ["money", "default", "calls"];
    const rendered = orderViews(dragged, tabs("2026-09-01..2026-09-16"));

    expect(rendered.map((t) => t.key)).toEqual(["money", "default", "calls"]);
    expect(rendered[0].href).toContain("range=2026-09-01..2026-09-16");
  });

  it("appends a view the order has not heard of yet, rather than dropping it", () => {
    // A view created in another tab arrives by refresh; for one render the
    // order has no key for it. A strip one tab short is a worse lie than a tab
    // briefly in the wrong place.
    const rendered = orderViews(["default", "calls"], tabs(null));
    expect(rendered.map((t) => t.key)).toEqual(["default", "calls", "money"]);
  });

  it("drops a key whose view is gone", () => {
    const rendered = orderViews(["default", "deleted", "calls"], tabs(null).slice(0, 2));
    expect(rendered.map((t) => t.key)).toEqual(["default", "calls"]);
  });
});

describe("the strip does not keep server-derived fields in state", () => {
  it("holds keys, not tab objects", () => {
    /**
     * The structural half of the fix, asserted on the source because it is a
     * statement about a React hook. `useState(views)` is the bug: it captures
     * the hrefs. Keys cannot go stale, because a key is the only thing a drag
     * is allowed to change.
     */
    const src = readFileSync(join(process.cwd(), "src/app/dashboard/board-controls.tsx"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    expect(code, "storing the tab objects is what froze the hrefs").not.toMatch(/useState\(\s*views\s*\)/);
    expect(code, "the strip must render through orderViews").toMatch(/orderViews\(/);
    expect(code, "and re-sync on the shared signature").toMatch(/stripSignature\(/);
  });
});
