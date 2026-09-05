import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * THE DRAWER OPENS, AND SHUTS ITSELF WHEN THE ROUTE MOVES.
 *
 * No jsdom: `grep -rn "jsdom\|@testing-library" tests/ package.json` returns
 * one hit before this file, and it is `freshness-poller.test.ts` saying there
 * isn't one. This suite follows that file's own pattern rather than adding
 * the repo's first DOM dependency for two behaviours that do not need one:
 * `react` is mocked wholesale, `MobileDrawer` is called directly as a plain
 * function (never rendered), its `useState`/`useEffect` calls are captured
 * instead of run by a reconciler, and stepped by hand. The returned element
 * is a plain object tree — the same shape `createElement` always builds — so
 * `find` below walks it by `type` identity to prove structure (Sheet, side
 * left, the width and fill classes, `RailContent` rendered inside) without
 * ever executing Radix's own code, which is also how a bare object tree
 * sidesteps the portal `SheetContent` renders through: nothing here asks
 * `react-dom` to commit anything.
 *
 * Everything that is a class rather than a behaviour — that the trigger is
 * `md:hidden`, that the rail is absent below `md`, that rows are 44px — is
 * pinned as source in `tests/mobile-shell.test.ts` instead, the way that file
 * already pins this shell's other geometry.
 */

let pathname = "/dashboard";
let search = "";
/** The one piece of state `MobileDrawer` owns, mirrored here by hand. */
let openState = false;
/** Every `useEffect` call the component makes on the render being inspected. */
let effects: Array<{ fn: () => void; deps: unknown[] }> = [];

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    // `MobileDrawer` calls this once, for `open`; the initial value is
    // irrelevant here because `beforeEach` already seeds `openState`.
    useState: (_init: boolean) => [
      openState,
      (next: boolean | ((prev: boolean) => boolean)) => {
        openState = typeof next === "function" ? (next as (prev: boolean) => boolean)(openState) : next;
      },
    ],
    useEffect: (fn: () => void, deps: unknown[]) => {
      effects.push({ fn, deps });
    },
  };
});

const { MobileDrawer } = await import("@/components/mobile-drawer");
const { Sheet, SheetContent, SheetTrigger } = await import("@/components/ui/sheet");
const { RailContent } = await import("@/components/sidebar");
const { Button } = await import("@/components/ui/button");

type Props = Parameters<typeof MobileDrawer>[0];
type Node = { type?: unknown; props?: Record<string, unknown> };

/** Renders `MobileDrawer` as a plain function call — see the file note. */
function draw(props: Props): Node {
  effects = [];
  return MobileDrawer(props) as unknown as Node;
}

/** Walks the returned element tree by `type` identity, depth-first. */
function find(root: Node | null | undefined, type: unknown): Node | null {
  if (root == null || typeof root !== "object") return null;
  if (root.type === type) return root;
  const children = root.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const hit = find(child as Node, type);
      if (hit) return hit;
    }
    return null;
  }
  return find(children as Node, type);
}

beforeEach(() => {
  pathname = "/dashboard";
  search = "";
  openState = false;
  effects = [];
});

describe("the phone's navigation drawer", () => {
  it("is shut until the menu button is pressed", () => {
    const tree = draw({ workspace: "Acme", views: [], hide: [] });
    const sheet = find(tree, Sheet);
    expect(sheet, "the drawer is not built on the kit's Sheet").not.toBeNull();
    expect(sheet!.props!.open).toBe(false);
    const trigger = find(tree, SheetTrigger);
    const button = find(trigger, Button);
    expect(button, "the bar's menu button").not.toBeNull();
    expect(button!.props!["aria-label"]).toBe("Open the navigation");
  });

  it("opens onto the rail's own content, rendered rather than rebuilt", () => {
    let tree = draw({ workspace: "Acme", views: [], hide: [] });
    const onOpenChange = find(tree, Sheet)!.props!.onOpenChange as (v: boolean) => void;
    // What a real click resolves to: Sheet calling its own `onOpenChange`.
    onOpenChange(true);
    expect(openState).toBe(true);

    tree = draw({ workspace: "Acme", views: [], hide: [] });
    expect(find(tree, Sheet)!.props!.open).toBe(true);
    const content = find(tree, SheetContent);
    expect(content, "the sheet's own content").not.toBeNull();
    // The workspace switcher, the search field and the nav are the RAIL's,
    // rendered here rather than rebuilt — so finding the element proves the
    // reuse, and its own props prove it was handed this render's data.
    const rail = find(content, RailContent);
    expect(rail, "RailContent rendered inside the sheet").not.toBeNull();
    expect(rail!.props!.workspace).toBe("Acme");
    // …including the control the top bar sheds on a phone.
    expect(rail!.props!.invite).toBe(true);
  });

  it("closes when the route changes under it", () => {
    let tree = draw({ workspace: "Acme", views: [], hide: [] });
    const onOpenChange = find(tree, Sheet)!.props!.onOpenChange as (v: boolean) => void;
    onOpenChange(true);
    expect(openState).toBe(true);

    pathname = "/dashboard/flows";
    tree = draw({ workspace: "Acme", views: [], hide: [] });
    // Two effects now: this one (closes on navigation) and the breakpoint
    // listener that closes the panel past `md` — `effects[0]` is this one,
    // in source order.
    expect(effects, "MobileDrawer's own two effects, captured rather than run").toHaveLength(2);
    /**
     * STEPPED BY HAND, exactly as `freshness-poller.test.ts` steps its timer
     * — and that is what this assertion actually checks: the effect's OWN
     * BODY does what it should (`setOpen(false)`) when run, not that React's
     * dependency-diffing is what decides to run it. That second fact — that
     * this effect's dependency list is `[pathname, search]`, which is the
     * reason React would re-run it on exactly this navigation — is pinned as
     * source in `tests/mobile-shell.test.ts` instead, and has to be: nothing
     * here calls a reconciler, so there is no dependency comparison to
     * observe, only the callback to invoke directly.
     */
    effects[0]!.fn();
    expect(openState, "a drawer left open over the page it just navigated to").toBe(false);
  });

  it("closes when only the view changes, which is a search param", () => {
    // The dashboard's views are `?view=` on one pathname. A drawer keyed on
    // the pathname alone stays open over the board it just switched — which
    // is exactly why `mobile-shell.test.ts` pins `[pathname, search]` as the
    // effect's own dependency list at the source. This checks the other
    // half, the effect's BODY, invoked by hand rather than triggered by a
    // dependency comparison this suite has no reconciler to run: that the
    // callback itself closes the drawer.
    let tree = draw({ workspace: "Acme", views: [], hide: [] });
    const onOpenChange = find(tree, Sheet)!.props!.onOpenChange as (v: boolean) => void;
    onOpenChange(true);
    expect(openState).toBe(true);

    search = "view=v2";
    tree = draw({ workspace: "Acme", views: [], hide: [] });
    effects[0]!.fn();
    expect(openState).toBe(false);
  });
});
