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
  it("requires all three facts, not just the absence of view rows", () => {
    // `views.length === 0` ALONE is the dangerous version: it is true of every
    // workspace whose board predates views.
    expect(page).toMatch(/const emptyWorkspace = views\.length === 0 && groups\.length === 0 && !hasTiles;/);
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
    expect(page).toMatch(/\{!emptyWorkspace && \(/);
    // The old spelling must not come back.
    expect(page).not.toMatch(/\{!hasTiles && !loadError \? \(/);
  });

  it("keeps the checklist as a supplement under the board, not a replacement", () => {
    const board = page.indexOf("{!emptyWorkspace && (");
    const checklist = page.indexOf("<OnboardingChecklist");
    expect(checklist).toBeGreaterThan(board);
    expect(page).toMatch(/\{!hasTiles && !loadError && \(/);
  });
});

describe("the first view a workspace ever makes", () => {
  const actions = readFileSync(join(process.cwd(), "src/app/dashboard/board-actions.ts"), "utf8");
  const store = readFileSync(join(process.cwd(), "src/lib/board/store.ts"), "utf8");

  it("is View 1, not View 2", () => {
    // The name counts the unrowed default board as View 1, which is right for
    // every workspace that has one — and an empty workspace does not.
    expect(actions).toMatch(/View \$\{existing\.length \+ \(adopted \|\| first \? 1 : 2\)\}/);
  });

  it("becomes the default board, so no phantom tab is synthesised beside it", () => {
    /**
     * `viewStrip` prepends a "Dashboard" tab whenever no row is flagged
     * `isDefault`. Without this the workspace that was just shown the
     * Get-started card — for the express purpose of NOT auto-creating a default
     * board — got one back the instant it made a real view.
     */
    expect(actions).toMatch(/isDefault: first,/);
  });

  it("asks the database, not the client, whether the workspace was really empty", () => {
    /**
     * A forged "I came from the empty screen" field would flag the new view
     * default on a workspace whose board predates views — which stops the tab
     * being synthesised and leaves that board reachable from nowhere. A
     * visibility bug from a hidden input.
     */
    expect(actions).toMatch(/const first = existing\.length === 0 && !\(await hasLegacyBoard\(db, ctx\.orgId\)\)/);
    expect(actions).not.toMatch(/fd\.get\("first"\)/);
  });

  it("checks placements as well as groups", () => {
    // A board can hold tiles in the ungrouped row without ever having had a
    // column, and that is still a board somebody arranged.
    const fn = store.slice(store.indexOf("export async function hasLegacyBoard"));
    expect(fn).toMatch(/dashboardGroups/);
    expect(fn).toMatch(/dashboardTilePlacements/);
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
    expect(page).toMatch(/<AddViewButton rangeKey=\{rangeKey\} source=\{boardSource\} \/>/);
    // The `<details>` it replaced is gone, not merely hidden.
    expect(page).not.toMatch(/group\/add/);
  });

  it("still gates on the same permission the dropdown did", () => {
    expect(page).toMatch(/access\.can\("create_flows"\) && <AddViewButton/);
  });

  it("posts to the existing server action with the fields it has always taken", () => {
    expect(picker).toMatch(/<form action=\{addViewAction\}>/);
    for (const field of ["range", "source", "kind"]) {
      expect(picker).toMatch(new RegExp(`name="${field}"`));
    }
  });

  it("offers exactly the two kinds the schema has", () => {
    expect(picker).toMatch(/kind: "groups"/);
    expect(picker).toMatch(/kind: "custom"/);
    // Calendar is a route, not a view kind. A third card here would be a
    // template that cannot be created.
    expect(picker).not.toMatch(/kind: "calendar"/);
  });

  it("does not make the choice cards clickable — the action is a real control", () => {
    // The house rule the connector catalogue states outright. A card that is
    // itself a button swallows the submit inside it.
    expect(picker).not.toMatch(/<Card[^>]*onClick/);
  });

  it("does not offer to create to a viewer who may not", () => {
    // A yellow button that leads to a silent `?error=rank` redirect this page
    // never reads is worse than no button.
    expect(empty).toMatch(/canCreate \? \(/);
    expect(empty).toMatch(/\{canCreate && open && <ViewTemplatePicker/);
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
    expect(empty).toMatch(/import \{ ViewTemplatePicker \}/);
    expect(empty).toMatch(/<ViewTemplatePicker/);
  });
});
