import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE EMPTY DASHBOARD, AND THE THING IT MUST NOT DO.
 *
 * A workspace with no views and nothing on them gets one card and none of this
 * page's chrome. The risk in that is not cosmetic: the default board is the
 * ABSENCE of a row, so "no view rows" is true of every workspace that has never
 * renamed its dashboard — and treating that as empty would hide a board people
 * are using behind an invitation to start one.
 *
 * These are source assertions because the condition is computed in a server
 * component that reads a database, and the interesting property is which facts
 * it consults rather than what it renders. Sabotage any one and the matching
 * assertion fails.
 */

const page = readFileSync(join(process.cwd(), "src/app/dashboard/page.tsx"), "utf8");
const picker = readFileSync(join(process.cwd(), "src/app/dashboard/view-template-picker.tsx"), "utf8");
const empty = readFileSync(join(process.cwd(), "src/components/board-empty.tsx"), "utf8");

describe("deciding a workspace is empty", () => {
  it("is one fact: are there any views", () => {
    /**
     * It carried two more, both scaffolding for a default board that was
     * SYNTHESISED rather than stored, and both broke the feature:
     *
     *   `&& !hasTiles` meant a workspace with any published metric could never
     *   be empty, so deleting every view put the board back with the metrics on
     *   it. A metric is not a board.
     *
     *   `&& groups.length === 0` protected an arrangement at `view_id IS NULL`
     *   that only the synthesised tab could reach. That tab is gone, so the
     *   check protects nothing.
     */
    expect(page).toMatch(/const emptyWorkspace = views\.length === 0;/);
    expect(page).not.toMatch(/emptyWorkspace = .*hasTiles/);
    expect(page).not.toMatch(/emptyWorkspace = .*groups\.length/);
  });

  it("has no synthesised board to fall back to", () => {
    // The regression this whole change exists to stop: rename the first view,
    // delete it, and a "Dashboard" tab nobody created came straight back.
    // Comments stripped first: the function's own note explains the tab it used
    // to conjure, and prose about a thing is not the thing. `board-shape.test.ts`
    // strips for the same reason — its cost rules failed on the word `count(*)`
    // inside the comment forbidding it.
    const types = readFileSync(join(process.cwd(), "src/lib/board/types.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(types).not.toMatch(/name: "Dashboard"/);
    expect(types).toMatch(/export function viewStrip\(views: BoardView\[\]\): BoardView\[\] \{\s*return views\.slice\(\)/);
  });

  it("costs no new query — every fact is one the page already resolved", () => {
    // `views` from navViews, `groups` from the active view's read, `hasTiles`
    // from the metric reads. If a fourth read appears in this condition it is a
    // round trip on a page that re-renders every twelve seconds in every tab.
    const cond = page.slice(page.indexOf("const emptyWorkspace"), page.indexOf("const emptyWorkspace") + 200);
    expect(cond).not.toMatch(/await/);
  });

  it("lets a load error win, so a failed read is never mistaken for an empty board", () => {
    expect(page).toMatch(/\{emptyWorkspace && !loadError \? \(/);
  });

  it("renders the card instead of the page's chrome, not beside it", () => {
    // The header is the only chrome that survived the old `!hasTiles` path —
    // the strip, the `+` and the action row already live inside TileArea. So
    // the empty branch has to sit ABOVE `BoardControls`, or the title and the
    // period pills come back.
    const branch = page.indexOf("{emptyWorkspace && !loadError ? (");
    const controls = page.indexOf("<BoardControls>");
    expect(branch).toBeGreaterThan(-1);
    expect(branch).toBeLessThan(controls);
  });
});

describe("what happens after you pick one", () => {
  /**
   * THE HOLE THIS CLOSES, WHICH WAS REACHABLE IN TWO CLICKS.
   *
   * The board used to render on `!hasTiles`: no tiles, no board. Follow the new
   * path through it — Get started → Columns → `addViewAction` inserts and
   * redirects onto the view → the workspace is no longer empty, but a brand-new
   * one still has no tiles → the checklist rendered INSTEAD of the board, so the
   * view just created had no tab strip, no `+`, no New group and nowhere to put
   * a metric.
   *
   * Custom escaped it by accident, because `hasTiles` is true for a canvas
   * whatever it holds — two templates behaving differently after creation, which
   * is what showed the condition was wrong rather than the copy.
   */
  it("gates the board on there being a board, not on there being tiles", () => {
    // The calendar branch shares this gate: `{!emptyWorkspace && activeKind
    // === "calendar" ? (…) : !emptyWorkspace ? (…) : null}`. Both arms ask the
    // same question, which is the property being pinned.
    expect(page).toMatch(/\{!emptyWorkspace && activeKind === "calendar" \? \(/);
    expect(page).toMatch(/\) : !emptyWorkspace \? \(/);
    // The old spelling must not come back.
    expect(page).not.toMatch(/\{!hasTiles && !loadError \? \(/);
  });

  it("keeps the checklist as a supplement under the board, not a replacement", () => {
    // Anchored on a string that still EXISTS. It was `"{!emptyWorkspace && ("`,
    // which the calendar branch changed — and `indexOf` answers -1 rather than
    // failing, so the comparison below would have passed against any page at
    // all. A position test has to be pinned to something present.
    const board = page.indexOf("{!emptyWorkspace && activeKind === \"calendar\" ? (");
    const checklist = page.indexOf("<OnboardingChecklist");
    expect(board).toBeGreaterThan(-1);
    expect(checklist).toBeGreaterThan(board);
    // Plus a third clause since the calendar became a view kind: onboarding
    // advice is about BUILDING metrics, and a workspace that has made a
    // calendar has one. It would also land under a month grid.
    expect(page).toMatch(/\{!hasTiles && !loadError && activeKind !== "calendar" && \(/);
  });
});

describe("the first view a workspace ever makes", () => {
  const actions = readFileSync(join(process.cwd(), "src/app/dashboard/board-actions.ts"), "utf8");

  it("is View 1, by plain arithmetic", () => {
    /**
     * It was `existing.length + (adopted ? 1 : 2)`. The `+2` existed because a
     * workspace's default board was View 1 WITHOUT having a row, so the first
     * real view was the second tab. Every view is a row now, so the count is the
     * count.
     */
    expect(actions).toMatch(/View \$\{existing\.length \+ 1\}/);
  });

  it("needs no default flag and asks nothing about a legacy board", () => {
    // Both existed to stop the synthesised tab appearing beside the new view.
    // There is no synthesised tab.
    expect(actions).not.toMatch(/isDefault: first/);
    expect(actions).not.toMatch(/hasLegacyBoard/);
  });

  it("counts the cap in rows, because a view is a row", () => {
    expect(actions).toMatch(/if \(existing\.length >= cap\) redirect\(back\("error=view_limit"\)\);/);
  });
});

describe("a refusal says so", () => {
  it("reads the two errors addViewAction can redirect with", () => {
    // Both were a navigation that changed nothing: you pressed a layout and
    // landed back where you were, with no view and no reason.
    expect(page).toMatch(/const VIEW_ERRORS = \[/);
    expect(page).toMatch(/\["rank",/);
    expect(page).toMatch(/\["view_limit",/);
    expect(page).toMatch(/one\(sp\.error\) === key/);
  });
});

describe("one picker, reached from both places", () => {
  it("the + opens it rather than a dropdown of its own", () => {
    expect(page).toMatch(/<AddViewButton\s+rangeKey=\{rangeKey\}\s+source=\{boardSource\}\s+calendarOptions=\{calendarOptions\}\s*\/>/);
    // The `<details>` it replaced is gone, not merely hidden.
    expect(page).not.toMatch(/group\/add/);
  });

  it("still gates on the same permission the dropdown did", () => {
    expect(page).toMatch(/access\.can\("create_flows"\) && \(\s*<AddViewButton/);
  });

  it("posts to the existing server action with the fields it has always taken", () => {
    // `className="h-full"` joined it so the form — which is the grid item —
    // stretches, and the button's own `h-full` has something definite to
    // resolve against. Measured: without it the Custom card sat 19px short of
    // its neighbours.
    expect(picker).toMatch(/<form key=\{t\.kind\} action=\{addViewAction\} className="h-full">/);
    for (const field of ["range", "source", "kind"]) {
      expect(picker).toMatch(new RegExp(`name="${field}"`));
    }
  });

  it("offers exactly the three kinds the schema has", () => {
    /**
     * THIS ASSERTION USED TO SAY THE OPPOSITE, and the reason it changed is
     * worth keeping rather than deleting. It read:
     *
     *   // Calendar is a route, not a view kind. A third card here would be a
     *   // template that cannot be created.
     *   expect(picker).not.toMatch(/kind: "calendar"/);
     *
     * Both halves were true when it was written and the first is no longer:
     * the calendar HAD its own route and its own row in the rail. It was never
     * a separate part of the product though — `materializeFlow` computes the
     * range pills, the chart buckets and every calendar day in one pass and
     * stores them side by side — so the route was a third way of drawing the
     * board's own numbers, wearing a destination. It is a view kind now, the
     * route is deleted, and `asViewKind` accepts three.
     *
     * The second half still holds, which is why this is a same-shaped assertion
     * rather than a deleted one: the picker must offer exactly what can be
     * created, no more.
     */
    expect(picker).toMatch(/kind: "groups"/);
    expect(picker).toMatch(/kind: "custom"/);
    expect(picker).toMatch(/kind: "calendar"/);
    // Still nothing beyond the three the column accepts.
    const kinds = new Set([...picker.matchAll(/kind: "(\w+)"/g)].map((m) => m[1]));
    expect([...kinds].sort()).toEqual(["calendar", "custom", "groups"]);
  });

  it("makes the whole card the control, and it is a submit rather than a handler", () => {
    /**
     * THE ONE PLACE THE CATALOGUE'S RULE DOES NOT APPLY, and the inversion is
     * deliberate rather than an oversight. "A card is not a button; every action
     * on it is a real control" exists because a connector card carries SEVERAL
     * acts and a clickable surface swallows them. A template card has exactly
     * one — choose this — and making the reader aim at a small button beneath a
     * large picture of the thing they are choosing is the worse interface.
     *
     * It stays a SUBMIT, so the server action and its redirect are untouched and
     * the choice still works through a form rather than through state.
     */
    expect(picker).toMatch(/<SubmitButton/);
    expect(picker).not.toMatch(/onClick=\{\(\) => [^}]*addView/);
  });

  it("shows a picture of each layout rather than an icon of it", () => {
    // Miro and Notion both lead a template picker with a thumbnail: the fastest
    // way to say what an arrangement looks like is to show a small one. Drawn
    // from tokens, not shipped as an image, so it cannot go stale unnoticed.
    expect(picker).toMatch(/function ColumnsPreview/);
    expect(picker).toMatch(/function CustomPreview/);
    expect(picker).toMatch(/<t\.Preview \/>/);
  });

  it("does not offer to create to a viewer who may not", () => {
    // A yellow button that leads to a silent `?error=rank` redirect this page
    // never reads is worse than no button.
    expect(empty).toMatch(/canCreate \? \(/);
    expect(empty).toMatch(/\{canCreate && open && \(\s*<ViewTemplatePicker/);
    expect(page).toMatch(/canCreate=\{access\.can\("create_flows"\)\}/);
  });

  it("shares the empty-card shell with the flow builder rather than copying it", () => {
    // Two ways of saying "there is nothing here yet" is a product telling you
    // something about itself — and a copy promising to stay the same is how it
    // happens anyway. Both callers import the one shell.
    const canvas = readFileSync(join(process.cwd(), "src/components/flow/flow-canvas.tsx"), "utf8");
    expect(empty).toMatch(/GetStartedCard/);
    expect(canvas).toMatch(/GetStartedCard/);
    // Neither re-spells the shell's own cap.
    expect(empty).not.toMatch(/h-1\.5 bg-primary/);
    expect(canvas).not.toMatch(/h-1\.5 bg-primary/);
  });

  it("is opened by the empty card too, from the same component", () => {
    expect(empty).toMatch(/import \{ ViewTemplatePicker, type CalendarOption \}/);
    expect(empty).toMatch(/<ViewTemplatePicker/);
  });
});
