import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { asViewKind, VIEW_KINDS } from "@/lib/board/types";

/**
 * THE CALENDAR AS A VIEW KIND, AND THE FOUR WAYS IT COULD REGRESS SILENTLY.
 *
 * It was `/dashboard/calendar` with a row in the rail, which said it was a
 * separate part of the product. It never was: `materializeFlow` computes the
 * dashboard's range pills, the chart buckets and every calendar day in ONE
 * `tileByRange` call and splits the answer into `byRange` and `byDay`, so a
 * calendar is a third way of drawing numbers the board already holds.
 *
 * Most of these are SOURCE assertions, for the reason `board-shape.test.ts`
 * gives: the failures being guarded are two files disagreeing, a query getting
 * fatter, or a driver feature that PGlite has and production does not. None of
 * those can be caught by rendering either side.
 */
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** Prose about a rule is not the rule — `check-ui.ts` strips for the same reason. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const page = read("src/app/dashboard/page.tsx");
const actions = read("src/app/dashboard/board-actions.ts");
const picker = read("src/app/dashboard/view-template-picker.tsx");
const board = read("src/components/calendar/calendar-board.tsx");
const sidebar = read("src/components/sidebar.tsx");

describe("the third kind", () => {
  it("round-trips through the one function that interprets it", () => {
    // `dashboard_views.kind` is plain text with a default and NO check
    // constraint (schema.ts), so the database has no opinion about the
    // vocabulary — this function is the whole of the validation, which is what
    // made a third kind need no migration.
    expect(asViewKind("calendar")).toBe("calendar");
    expect(asViewKind("custom")).toBe("custom");
    expect(asViewKind("groups")).toBe("groups");
    expect(VIEW_KINDS).toEqual(["groups", "custom", "calendar"]);
  });

  it("still reads anything unrecognised as the board every workspace had", () => {
    // A hand-edited form post must not be able to mint a view nothing renders.
    for (const junk of ["", "Calendar", "CALENDAR", "week", null, undefined, 7, {}]) {
      expect(asViewKind(junk)).toBe("groups");
    }
  });
});

describe("what a calendar view costs on every freshness poll", () => {
  it("computes NO classic metrics", () => {
    /**
     * THE LARGEST SAVING ON THIS PAGE. Classic metrics are not stored — each is
     * a live `events` query per render and a funnel is one query PER STAGE — and
     * this block re-runs on every `router.refresh()` and every twelve-second
     * poll. A calendar draws one materialised metric's `byDay` and cannot show a
     * classic metric at all, so every one of those queries would be paid for and
     * discarded.
     */
    expect(page).toMatch(/activeKind === "calendar"\s*\?\s*\[\]/);
  });

  it("reads the NARROW tile projection, never the board's own", () => {
    // `calendarFlowTiles` selects the name, the six spelling keys and `byDay`;
    // `publishedFlowTiles` selects everything EXCEPT `byDay` because sixty-odd
    // day entries per tile on a twelve-second query is real money. Reading the
    // wrong one either ships kilobytes nobody draws or draws nothing.
    expect(page).toMatch(/calendarFlowTiles\(db, orgId\)/);
    const branch = page.slice(page.indexOf('if (activeKind === "calendar" && !loadError)'));
    expect(branch.slice(0, 1200)).not.toMatch(/publishedFlowTiles/);
  });

  it("asks for no groups, because a calendar has no columns", () => {
    const branch = page.slice(page.indexOf('} else if (activeKind === "calendar"'), page.indexOf("} else {"));
    expect(branch).not.toMatch(/listBoardGroups/);
    // It reuses the placements read rather than growing a near-identical
    // sibling: a calendar view holds exactly one placement, so "this view's
    // placements" already answers "which metric".
    expect(branch).toMatch(/listTilePlacements/);
  });

  it("costs no extra query to offer the picker its metric list", () => {
    // On a calendar view the list comes from the narrow read; on any other view
    // from the flow tiles the board already holds. A third read here would be a
    // round trip per render to fill a dropdown.
    const opts = page.slice(page.indexOf("const calendarOptions"), page.indexOf("const calendarSelected"));
    expect(opts).not.toMatch(/await/);
  });
});

describe("the board still has its furniture", () => {
  it("carries the view strip and the board actions into the calendar branch", () => {
    /**
     * THE ONE THING THAT WOULD BREAK QUIETLY. `viewStrip` and `boardActions` are
     * rendered by `BoardLayout`/`CustomBoard`, not by the page — so a branch
     * that forgets them loses the tab strip and the `+`, and the only way back
     * to another view is the browser's back button.
     */
    const branch = page.slice(page.indexOf('{!emptyWorkspace && activeKind === "calendar" ? ('));
    const head = branch.slice(0, branch.indexOf("<CalendarBoard"));
    expect(head).toMatch(/\{viewStrip\}/);
    expect(head).toMatch(/\{boardActions\}/);
  });

  it("remounts the board when the view changes", () => {
    // `CalendarBoard` seeds its selected metric once — that is what stops the
    // poller yanking a metric mid-read — so a different view must be a
    // different component instance. Same reason `BoardLayout` is keyed.
    const branch = page.slice(page.indexOf("<CalendarBoard"));
    expect(branch.slice(0, 400)).toMatch(/key=\{activeView \?\? "default"\}/);
  });

  it("puts its own time control where every view puts one", () => {
    /**
     * NOT MERELY "hides the period pills", which is what this asserted first.
     * Six live pills that changed nothing would be the interface offering what
     * it cannot do — but the SLOT is right: the header beside the title is
     * where every view says what span it is reading, and a calendar reads in
     * months. Dropping the pills and leaving the slot empty made a calendar tab
     * look like a different kind of page, which is the thing being fixed.
     */
    expect(page).toMatch(/activeKind === "calendar" \? \(\s*<div id="calendar-period"/);
    // And the metric picker lands where a groups board puts "New group" and a
    // canvas puts "+ Add" — the control that changes what you are looking at.
    expect(page).toMatch(/<div id="calendar-tools"/);
    expect(page).toMatch(/hosted\b/);
  });

  it("sits in the SAME groove the period pills do, imported not re-spelled", () => {
    /**
     * THE DRIFT THIS CATCHES, WHICH NOBODY FILES A BUG FOR. Both controls
     * answer "what span am I reading" in the same header slot, and each used to
     * draw its own well: the range track 40px on `--period-bg`, the month
     * stepper 36px on `--background`. Switching from a Columns tab to a
     * Calendar tab moved the header row and changed the surface under it — each
     * one looks fine alone, which is exactly why a test has to hold them
     * together. `BOARD_GRID` is spelled once for the same reason one layout
     * down.
     */
    expect(board).toMatch(/className=\{PERIOD_TRACK\}/);
    expect(page).toMatch(/className=\{PERIOD_TRACK\}/);
    // Neither may go back to spelling the groove itself.
    for (const [name, src] of [["calendar-board", board], ["page", page]] as const) {
      expect(src, `${name} re-spells the period groove`).not.toMatch(/h-10 items-center gap-0\.5 rounded-full/);
    }
  });

  it("puts the month's summary AFTER the sheet it summarises", () => {
    /**
     * Best day, average day, days with data and the as-of are conclusions drawn
     * from the squares — "24 on Aug 10" means nothing until you have seen the
     * month. Above the grid they were three figures asking to be read before
     * the thing they describe, and they pushed the calendar itself down.
     */
    const grid = board.indexOf('<Card variant="surface" padding="none"');
    const stats = board.indexOf('<StatChip label="Best day">');
    expect(grid).toBeGreaterThan(-1);
    expect(stats).toBeGreaterThan(grid);
    expect(board.indexOf("Numbers as of")).toBeGreaterThan(grid);
  });

  it("keeps a self-contained bar when there is no chrome to portal into", () => {
    // `/design` renders the board bare. A kit page showing a calendar with no
    // controls would be documenting something that does not exist.
    expect(board).toMatch(/hosted \? \(/);
    expect(board).toMatch(/<Slot id="calendar-tools">/);
    expect(board).toMatch(/<Slot id="calendar-period">/);
    // The prop is a PROP, not a probe: probing the DOM means one frame rendered
    // in the wrong shape.
    expect(board).toMatch(/hosted = false/);
  });
});

describe("choosing the metric", () => {
  it("is written in ONE statement, because the deployed driver has no sessions", () => {
    /**
     * `db.transaction()` THROWS on `neon-http` — "No transactions support in
     * neon-http driver" — and DB_DRIVER defaults to "http". PGlite is a real
     * embedded Postgres WITH sessions, so a behavioural suite is greener than
     * production by construction and cannot catch this. `adoptDefaultView`
     * shipped exactly this bug once; `duplicateViewAction` carried it for its
     * whole life, failing on every press while its tests passed.
     *
     * Matched as a CALL rather than a mention: this file's own comments discuss
     * `db.transaction()` at length.
     */
    expect(code(actions)).not.toMatch(/(?:return|await)\s+\w+\.transaction\(/);
    expect(actions).toMatch(/function newViewCte\(/);
    expect(actions).toMatch(/with v as \(/);
  });

  it("validates the key's SHAPE rather than trusting the post", () => {
    // A malformed key would sit in the table forever matching nothing. A
    // well-formed key naming a deleted metric is fine and expected — a
    // placement is allowed to outlive its tile, which is how republishing a
    // flow restores a board.
    expect(actions).toMatch(/\^flow:\[\\w-\]\+:\[\\w-\]\+\$/);
  });

  it("replaces rather than appends, so a calendar holds exactly one", () => {
    // The unique index stops the SAME key being stored twice and has nothing to
    // say about two different ones. Arity is the writer's job.
    const fn = actions.slice(actions.indexOf("export async function setCalendarMetricAction"));
    expect(fn).toMatch(/delete from/);
    expect(fn).toMatch(/insert into/);
    // And it refuses to write a calendar's metric onto a view of another kind.
    expect(fn).toMatch(/kind = 'calendar'/);
  });

  it("gates the write on the same permission every other board write takes", () => {
    const fn = actions.slice(actions.indexOf("export async function setCalendarMetricAction"));
    expect(fn).toMatch(/if \(await blocked\(ctx\)\) return fail\(RANK_BLOCKS\)/);
    // And the page does not hand the action to a viewer who may not use it.
    expect(page).toMatch(/access\.can\("create_flows"\) && activeView \? setCalendarMetricAction\.bind/);
  });

  it("crosses the RSC boundary as a server action, not as a function", () => {
    /**
     * A server action reference serializes; an ordinary closure does not, and
     * passing one from a server component fails the build. This is what lets
     * `/design` render `CalendarBoard` by simply omitting the prop — the trap
     * `EmptyCanvas` fell into, which needed a whole `-preview` wrapper because
     * it takes a plain `onStart`.
     */
    expect(board).toMatch(/onPick\?: \(fd: FormData\) => Promise</);
    expect(read("src/app/design/page.tsx")).not.toMatch(/onPick=/);
  });

  it("says so when the write fails, instead of looking like it worked", () => {
    // Local state has already moved, so a silent refusal shows up later, on a
    // different screen, as the old metric coming back.
    expect(board).toMatch(/setSaveError/);
    expect(board).toMatch(/if \(!r\.ok\) setSaveError/);
  });
});

describe("the states a calendar view can be in", () => {
  it("names a metric that is gone rather than drawing an empty month", () => {
    // A placement may outlive its tile, and the metric may simply be hidden
    // from this viewer by rank. Thirty blank squares under a working month
    // stepper is a calendar claiming a quiet month.
    expect(board).toMatch(/const missing =/);
    expect(board).toMatch(/This metric is no longer available/);
    // The sheet does not render at all in that state.
    expect(board).toMatch(/\{!missing && \(/);
  });

  it("does not distinguish deletion from a rank block in what it says", () => {
    // A member who cannot see a metric must not learn from an error message
    // that it exists.
    const msg = board.slice(board.indexOf("This metric is no longer available"));
    expect(msg.slice(0, 400)).toMatch(/deleted, unpublished, or it is not shared with you/);
  });

  it("tells a failed read apart from an empty workspace", () => {
    // Collapsing the two renders our outage as the customer's empty workspace.
    expect(page).toMatch(/calendarRowsFailed/);
    expect(page).toMatch(/if \(calRows == null\) calendarRowsFailed = true;/);
  });

  it("filters the metric list by the same rank gate the board applies", () => {
    const branch = page.slice(page.indexOf('if (activeKind === "calendar" && !loadError)'));
    expect(branch.slice(0, 2000)).toMatch(/access\.canSeeMetric\(`flow:\$\{r\.flowId\}`\)/);
  });

  it("creates on the first press, without asking which metric", () => {
    /**
     * THIS ASSERTION REPLACED ITS OWN OPPOSITE, and the swap is the point.
     *
     * The Calendar card briefly opened a SECOND STEP listing every published
     * metric, and refused to create anything when the list was empty
     * (`calendarOptions.length === 0 ? …`). Both halves were wrong for the same
     * reason: the board already carries a metric dropdown, so the modal was
     * charging a decision up front for something the view lets you change in one
     * press and then remembers — and the refusal made the template work for some
     * workspaces and not others, to deliver a sentence the empty view says
     * anyway.
     *
     * So all three cards post immediately, and the calendar carries the first
     * metric with it.
     */
    expect(picker).not.toMatch(/needsMetric/);
    expect(picker).not.toMatch(/setPicking/);
    expect(picker).toMatch(/name="tileKey" value=\{calendarOptions\[0\]\?\.key \?\? ""\}/);
  });

  it("names the view Calendar, not the metric it opens on", () => {
    // Name a tab after its first metric and switching the dropdown makes the
    // strip lie. The metric is not what the view IS.
    expect(picker).toMatch(/name="label" value="Calendar"/);
  });

  it("treats a missing first metric as ordinary, not as a refusal", () => {
    /**
     * A workspace with nothing published has no first metric to send. The view
     * is created with no placement row and the board says there is nothing
     * published yet — which is the truth, and is where that sentence belongs.
     */
    const fn = actions.slice(actions.indexOf("export async function addViewAction"));
    expect(fn).not.toMatch(/error=no_metric/);
    // The key is still shape-checked, so a malformed one cannot be stored.
    expect(fn).toMatch(/\^flow:\[\\w-\]\+:\[\\w-\]\+\$/);
    // And a calendar with no key takes the plain insert rather than the CTE.
    expect(fn).toMatch(/if \(tileKey\) \{/);
  });

  it("drops the source filter, which cannot reach a stored day map", () => {
    // The source narrows which EVENTS a number is computed from; every square
    // here comes from the tile's `byDay`, already computed. Pressing a source
    // would re-render the page and leave all 31 squares identical.
    expect(page).toMatch(/sources\.length > 0 && activeKind !== "calendar" &&/);
    // Refresh all stays — recomputing the flows is what fills the squares in.
    expect(page).toMatch(/refreshAllFlowsAction/);
  });
});

describe("the route it replaced", () => {
  it("is gone, along with its skeleton", () => {
    expect(existsSync(join(root, "src/app/dashboard/calendar"))).toBe(false);
  });

  it("is gone from the rail", () => {
    expect(sidebar).not.toMatch(/href: "\/dashboard\/calendar"/);
  });

  it("leaves no revalidate pointing at a dead path", () => {
    /**
     * THE MISS THAT WOULD HAVE BEEN INVISIBLE. `refreshFlowAction` and its
     * siblings revalidated `/dashboard/calendar` so a recompute showed up on
     * the calendar. That path no longer exists, and `revalidatePath` on a route
     * that is not there does nothing and reports nothing — every calendar would
     * quietly go stale after a recompute.
     */
    const flowActions = read("src/app/dashboard/flows/actions.ts");
    expect(code(flowActions)).not.toMatch(/revalidatePath\("\/dashboard\/calendar"\)/);
    // The line each one collapsed into is still there.
    expect(code(flowActions)).toMatch(/revalidatePath\("\/dashboard"\)/);
  });

  it("moved the sheet somewhere both the board and /design can import it", () => {
    expect(page).toMatch(/from "@\/components\/calendar\/calendar-board"/);
    expect(read("src/app/design/page.tsx")).toMatch(/from "@\/components\/calendar\/calendar-board"/);
  });
});
