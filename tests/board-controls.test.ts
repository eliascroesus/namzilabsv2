import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * THE BOARD'S FILTERS, AS THEY ARRIVE.
 *
 * These controls exist to make a press land before the server answers, and the
 * pending half of that can only be seen in a browser. What CAN be pinned here
 * is the half that has to survive without JavaScript at all — and it is the
 * half most easily lost, because the whole point of the component is the
 * `onClick`.
 *
 * A range pill is still an `<a href>` with the range in it: middle-click, copy
 * link, open-in-new-tab and a first paint before hydration all depend on that,
 * and every one of them breaks silently the day someone "simplifies" it into a
 * `<button onClick>`. The rendered markup is the only place that shows.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

// The actions reach for the database the moment the module loads, and one of
// them pulls in `server-only`, which throws inside a client module. Nothing
// here submits anything — what is under test is what the strip SAYS. Same
// mock-then-dynamic-import shape `board-render.test.ts` uses for the board.
vi.mock("@/app/dashboard/board-actions", () => ({
  renameViewAction: async () => ({ ok: true }),
  duplicateViewAction: async () => ({ ok: true, viewId: "copy" }),
  deleteViewAction: async () => ({ ok: true }),
}));

const { BoardControls, RangeLink, TileArea, ViewTab } = await import("@/app/dashboard/board-controls");

// Children go in the props bag rather than as a third argument: these
// components declare `children` as required, and `createElement`'s overloads
// only see the props object.
const board = (children: React.ReactNode) => renderToStaticMarkup(createElement(BoardControls, { children }));

const pill = (key: string, active: string) =>
  createElement(RangeLink, {
    key,
    href: `/dashboard?range=${key}`,
    rangeKey: key,
    activeRange: active,
    className: "pill",
    activeClassName: "is-on",
    idleClassName: "is-off",
    children: key,
  });

describe("the range pills", () => {
  it("render as real links carrying their own range", () => {
    const html = board([pill("today", "7d"), pill("7d", "7d")]);
    expect(html).toContain('href="/dashboard?range=today"');
    expect(html).toContain('href="/dashboard?range=7d"');
  });

  it("mark the server's range as current, and only that one", () => {
    const html = board([pill("today", "7d"), pill("7d", "7d")]);
    // One `aria-current`, on the pill whose key the server rendered — a screen
    // reader otherwise hears seven identical links and no indication of which
    // is on.
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toContain('class="pill is-on">7d');
    expect(html).toContain('class="pill is-off">today');
  });
});

describe("the tile area", () => {
  it("shows the tiles it was given while nothing is in flight", () => {
    const html = board(createElement(TileArea, { count: 3, children: createElement("p", { children: "the real tiles" }) }));
    expect(html).toContain("the real tiles");
    // No skeletons on a settled board — they belong to the pending state alone.
    expect(html).not.toContain("aria-busy");
  });

});

describe("a control outside the provider", () => {
  it("fails loudly rather than rendering a link that can never show it is working", () => {
    // The pills and the tile area only work as a pair. A stray one would render
    // as an ordinary anchor that never lights and never skeletons — a
    // regression with no symptom until someone complains the board feels slow
    // again.
    expect(() => renderToStaticMarkup(pill("today", "today"))).toThrow(/inside <BoardControls>/);
  });
});

describe("the view tabs", () => {
  const tab = (id: string | null, active: string | null, name: string) =>
    createElement(ViewTab, {
      key: id ?? "default",
      href: id ? `/dashboard?range=7d&view=${id}` : "/dashboard?range=7d",
      viewId: id,
      activeView: active,
      // The menu is a client-only affordance; these assertions are about the
      // anchor underneath it, which must survive whether or not it is there.
      canEdit: false,
      defaultHref: "/dashboard?range=7d",
      children: name,
    });

  it("are real links carrying their own view", () => {
    /**
     * The same promise the range pills make, for the same reasons: the view is
     * in the URL, so a link pasted into Slack opens on the view its sender was
     * looking at, and back and forward work. All of that dies silently the day
     * someone turns these into `<button onClick>`.
     */
    const html = board([tab(null, null, "Dashboard"), tab("v2", null, "Ops")]);
    expect(html).toContain('href="/dashboard?range=7d"');
    expect(html).toContain('href="/dashboard?range=7d&amp;view=v2"');
    expect(html).toContain("Dashboard");
    expect(html).toContain("Ops");
  });

  it("mark exactly one tab as current, including the default one", () => {
    /**
     * The default view has no row and no `?view=` in the URL, so its id is null
     * and "no view selected" and "the default view is selected" are the SAME
     * state. A screen reader hearing several identical links and no indication
     * of which is on is the failure this pins — the same one the range track
     * had before `aria-current`.
     */
    const onDefault = board([tab(null, null, "Dashboard"), tab("v2", null, "Ops")]);
    expect(onDefault.match(/aria-current="page"/g)).toHaveLength(1);
    expect(onDefault.indexOf('aria-current="page"')).toBeLessThan(onDefault.indexOf("Ops"));

    const onOps = board([tab(null, "v2", "Dashboard"), tab("v2", "v2", "Ops")]);
    expect(onOps.match(/aria-current="page"/g)).toHaveLength(1);
    expect(onOps.indexOf('aria-current="page"')).toBeGreaterThan(onOps.indexOf("Dashboard"));
  });
});

/**
 * SWITCHING VIEWS MUST NOT DISTURB THE REST OF THE BOARD.
 *
 * Three symptoms, one cause, all reported together: "it changes height and
 * stuff and some text removes and the timeline thing with 7 days or yesterday
 * stops being selected for a second when swapping views".
 *
 * `picked` was one bare string shared by every control. Pressing a view tab put
 * a view id in it, the range pills compared that id against "7d" and
 * "yesterday", nothing matched, and every pill went dark until the navigation
 * settled. Meanwhile `TileArea` skeletoned for a
 * navigation that changes NO number — a view is the same metrics arranged
 * differently — so the board collapsed into placeholder cards and back.
 *
 * None of this is reachable through `renderToStaticMarkup`, which never has a
 * transition in flight, so it is pinned as source text: the house style for an
 * invariant that spans components. Sabotage any one of the four and the
 * matching assertion fails.
 */
describe("a view switch is a re-arrangement, not a re-answer", () => {
  const src = readFileSync(join(process.cwd(), "src/app/dashboard/board-controls.tsx"), "utf8");

  it("scopes the optimistic pick to the control that was pressed", () => {
    // Sabotage: drop either `.dim` guard and the other control lights (or
    // unlights) on a press that was never about it.
    expect(src).toMatch(/picked\?\.dim === "range" \? picked\.key : activeRange/);
    expect(src).toMatch(/picked\?\.dim === "view" \? picked\.key : \(activeView \?\? ""\)/);
  });

  it("clears the pick when a press carries no dimension, so none outlives its navigation", () => {
    // Sabotage: `if (pick) setPicked(pick)` — the shape this replaced. The
    // source menu then leaves the last range or view pick standing, and the
    // empty-string key of the DEFAULT view never registers at all.
    expect(src).toContain("setPicked(pick ?? null)");
  });

  it("holds the real tiles still while only the arrangement changes", () => {
    // Sabotage: gate this on `pending` alone — the shipped behaviour — and the
    // board skeletons for a switch that cannot change a single number on
    // screen. The gate is unchanged: a view switch never reaches the skeleton
    // branch, so the real tiles stay mounted at their real sizes.
    //
    // The caption this used to check with it is gone. It stated a count and a
    // "newest number N ago" above a board where every tile already carries its
    // own as-of line, and it was removed rather than restyled.
    expect(src).toContain("if (!pending || !answering(picked)) {");
    /**
     * ...but "hold them still" was implemented as "change nothing at all", so a
     * tab press moved the pill and then sat there for a whole round trip with
     * no sign it had been heard. Opacity shifts no box by a pixel — it cannot
     * bring back the height change or the blanked caption this test exists to
     * prevent — while still saying the arrangement is being replaced.
     */
    expect(src).toMatch(/pending && "pointer-events-none opacity-55"/);
    expect(src, "the wash must not be able to reflow the board").not.toMatch(
      /pending && ".*(h-|w-|p-|m-|hidden|grid-cols)/,
    );
    expect(src).toMatch(/function answering\(picked: Pick \| null\): boolean \{\s*return picked\?\.dim !== "view";/);
  });
});

describe("a view tab carries its own menu", () => {
  const tab = (o: { id: string | null; active: string | null; canEdit: boolean; name: string }) =>
    createElement(ViewTab, {
      href: "/dashboard?range=7d",
      viewId: o.id,
      activeView: o.active,
      canEdit: o.canEdit,
      defaultHref: "/dashboard?range=7d",
      children: o.name,
    });

  it("offers rename and delete on the view you are standing on", () => {
    const html = board([tab({ id: "v2", active: "v2", canEdit: true, name: "Ops" })]);
    expect(html).toContain("Options for Ops");
  });

  it("shows no menu on a tab you are not on, so the strip is names rather than dots", () => {
    const html = board([tab({ id: "v2", active: null, canEdit: true, name: "Ops" })]);
    expect(html).not.toContain("Options for Ops");
  });

  it("never offers one on the default view, which has no row to rename or delete", () => {
    // Sabotage: drop the `viewId != null` half of `editable` and the product
    // grows a Delete button for a view that cannot be deleted — it is the
    // absence of a row that makes it free. See the schema note.
    const html = board([tab({ id: null, active: null, canEdit: true, name: "Dashboard" })]);
    expect(html).not.toContain("Options for Dashboard");
  });

  it("shows nothing to a member who may not edit the board", () => {
    const html = board([tab({ id: "v2", active: "v2", canEdit: false, name: "Ops" })]);
    expect(html).not.toContain("Options for Ops");
    expect(html).toContain("Ops");
  });
});
