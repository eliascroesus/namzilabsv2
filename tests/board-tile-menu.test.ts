import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE TILE'S OWN ACTS, AFTER THE FOOTLINE THAT HELD THEM WAS DELETED.
 *
 * The 6 Sep 2026 export (`node-id=14:4`) draws a metric card of exactly two
 * rows — a name over a figure — and no footline. `MetricCard` lost its
 * `actions` prop in that pass, which took Refresh and Open off every tile on
 * the groups board and "Drill in" off every legacy metric tile.
 *
 * DELETING THEM WOULD HAVE BEEN A REGRESSION DRESSED AS A DESIGN CHANGE.
 * "Open" is the only path from a number to the flow that computes it, and a
 * drawing that omits a footer is not an argument for removing the path — so
 * they moved to the hover menu this board already floats in every tile's
 * corner, where they cost the card no height.
 *
 * `tests/flow-tile-range.test.ts` used to assert both words on the CARD and
 * now asserts neither. This file is where that guarantee went: without it,
 * the two acts would have been silently removable by anyone who read the
 * export and not the argument.
 *
 * Source pins rather than a render: the menu is a client component whose
 * panel only mounts once a popover is open, and what is being guarded here is
 * that the acts EXIST and are wired to the right ids — not how a popover
 * animates.
 */
const menu = readFileSync(join(process.cwd(), "src/app/dashboard/board-tile-menu.tsx"), "utf8");
/** Comments explain the rules and must not be able to satisfy them. */
const code = menu.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the tile menu carries the acts the card's footline used to", () => {
  it("offers Refresh and Open on a flow tile", () => {
    expect(code, "Refresh is a menu row").toMatch(/<RefreshCw \/>\s*Refresh/);
    expect(code, "Open is a menu row").toMatch(/<ArrowUpRight \/>\s*Open/);
  });

  it("offers Drill in on a legacy metric tile", () => {
    // `MetricTile` in dashboard/page.tsx carried this in its own `actions`
    // slot and now carries nothing; the menu is the one place both kinds of
    // tile are wrapped, so it is the only place this can live for both.
    expect(code, "Drill in is a menu row").toMatch(/<ArrowUpRight \/>\s*Drill in/);
  });

  it("keeps Refresh a real form post, not a click handler", () => {
    /**
     * It was a `<form action={refreshFlowAction}>` with a hidden `flowId` in
     * the footline, which is what let it work with no JavaScript. Moving it
     * into a popover is not a reason to turn a server action into an
     * onClick — the menu is client-side, the SUBMIT is not.
     */
    expect(code).toMatch(/<form action=\{refreshFlowAction\}/);
    expect(code).toMatch(/name="flowId"/);
    expect(code).toMatch(/type="submit"/);
  });

  it("routes each act at the id it reads off the tile's own key", () => {
    /**
     * `BoardTile.key` is `flow:<flowId>:<outputNodeId>` or
     * `metric:<metricId>`, so the hrefs are derivable here and are not two
     * more props threaded down from a page that has already handed over the
     * title, the value and the unit key for the same object.
     */
    expect(code).toMatch(/\/dashboard\/flows\/\$\{target\.flowId\}/);
    expect(code).toMatch(/\/dashboard\/metrics\/\$\{target\.metricId\}/);
  });

  it("degrades to Move-to alone on a tile whose key it does not recognise", () => {
    // A future third kind of tile must get a working menu, not a crash and
    // not a link to `/dashboard/flows/undefined`.
    expect(code, "the parse is total").toMatch(/return null;/);
    expect(code, "the acts are gated on it").toMatch(/\{target && \(/);
  });
});
