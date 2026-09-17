import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE PERIOD CONTROL'S CALENDAR — 7 Sep 2026, rebuilt 17 Sep 2026.
 *
 * "Not preset ranges but … a calendar dropdown thing and the user can pick the
 * ranges so it can click on one date and then to another date or same day."
 *
 * The rebuild's own brief: "more like calendly because calendly has made it
 * extremely easy for users and very comfortable to change dates and ranges".
 * What that came down to was two months instead of one — the window people
 * actually want crosses a month boundary about as often as not, and drawing one
 * meant anchoring a date and then paging away from it — plus the return of the
 * preset shortcuts, which had been removed along with the segmented pill track
 * they used to live in.
 *
 * The riskiest thing about this component cannot be caught by rendering it:
 * this suite runs with `TZ=UTC` and no DOM, so a picker doing its day maths in
 * LOCAL time would agree with every assertion here and disagree with the server
 * for anyone west of Greenwich, in the last hours of every day. That is what
 * the source scan below is for — not style policing, but the only available
 * guard against the one bug the environment cannot reproduce.
 *
 * WHAT THIS FILE STILL CANNOT SEE is whether the thing is pleasant to use. It
 * reads text. The interaction was driven in a real browser instead — presets
 * commit on one click, a pair drawn across the two months reads back as eight
 * days, backwards draws the same window as forwards, the same day twice is one
 * day, and tomorrow is unclickable.
 */
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const picker = read("src/components/ui/date-range-picker.tsx");
/** Comments explain the rules and must not be able to satisfy them. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the calendar does its arithmetic in UTC, like everything else", () => {
  it("never reads a local date component", () => {
    /**
     * `getDate`, `getMonth`, `getFullYear` and `getDay` are the local-time
     * family. The whole product dates records in UTC (`resolveRange`,
     * `calendarDayRanges`), so a grid built from these would put a day in the
     * wrong column and pick a window the server does not agree with.
     */
    const c = code(picker);
    for (const m of ["getDate()", "getMonth()", "getFullYear()", "getDay()", "getHours()"]) {
      expect(c, `local ${m} in a UTC calendar`).not.toContain(m);
    }
  });

  it("pins the timezone on every formatter it runs", () => {
    /**
     * The footer prints "Aug 24, 2026", which is `toLocaleDateString` — and
     * that reads LOCAL time unless told otherwise. Unpinned, the footer would
     * name the day before the one the band is drawn on, for anyone west of
     * Greenwich, which is the disagreement this whole file exists to prevent.
     */
    const c = code(picker);
    for (const call of c.match(/toLocaleDateString\([^)]*\)/g) ?? []) {
      expect(call, "a formatter with no timeZone reads local").toContain('timeZone: "UTC"');
    }
    expect(c.match(/toLocaleDateString/g) ?? [], "and there is one to check").not.toHaveLength(0);
  });

  it("takes today as a prop rather than reading the clock", () => {
    /**
     * It renders on the server first and hydrates on the client. A bare
     * `new Date()` inside would compute "today" twice, once per side, and the
     * two would disagree across a UTC midnight — the grid would disable a
     * different set of days than the one that was painted.
     */
    const c = code(picker);
    expect(c).toMatch(/now,/);
    expect(c).toMatch(/now: Date;/);
    expect(c, "no clock read inside the component").not.toMatch(/=\s*new Date\(\)/);
  });

  it("borrows the calendar view's own grid rather than minting a second one", () => {
    // Two surfaces drawing days from one pure module, so a month can never
    // start on a different weekday in the header than it does on the Calendar.
    expect(code(picker)).toMatch(/from "@\/lib\/metrics\/calendar"/);
    for (const fn of ["monthGrid", "WEEKDAYS", "monthLabel", "dayKey", "monthKeyOf"]) {
      expect(code(picker), `${fn} should come from the shared module`).toContain(fn);
    }
  });
});

describe("two months, which is the whole point of the rebuild", () => {
  it("derives the earlier month from the later one, and draws both", () => {
    /**
     * `month` names the LATER of the pair. That way round on purpose: the two
     * have to open on [last month, THIS month], and a picker keyed on the
     * earlier one would open on [this month, NEXT month] and spend half its
     * width on days that are all disabled.
     */
    const c = code(picker);
    expect(c).toMatch(/const months: MonthKey\[\] = \[monthBefore\(month\), month\]/);
    expect(c, "and both are rendered").toMatch(/months\.map\(/);
  });

  it("hides the EARLIER month when there is no room, never the one holding today", () => {
    // Every backward range ends on today; a picker that hid today would be
    // hiding the day the customer is anchored to.
    expect(code(picker)).toMatch(/i === 0 \? "hidden md:block" : undefined/);
  });

  it("still cannot walk past the month holding today", () => {
    expect(code(picker)).toMatch(/disabled=\{month >= monthKeyOf\(now\)\}/);
  });
});

describe("the shortcuts came back", () => {
  it("draws one row per preset, from the single list the URL also speaks", () => {
    /**
     * `RANGE_OPTIONS` rather than a list retyped here: the rail's rows and the
     * keys `?range=` accepts have to be the same six, or a shortcut writes a
     * URL that resolves to something else.
     */
    const c = code(picker);
    expect(c).toMatch(/from "@\/lib\/metrics\/range"/);
    expect(c).toMatch(/RANGE_OPTIONS\.map\(/);
  });

  it("commits a preset on ONE click, because a preset is a whole answer", () => {
    // The case that should be fastest must not also pay for an Apply.
    expect(code(picker)).toMatch(/onClick=\{\(\) => onPickPreset\?\.\(r\.key\)\}/);
  });

  it("marks the row the board is standing on", () => {
    expect(code(picker)).toMatch(/const on = r\.key === activeKey/);
    expect(code(picker)).toMatch(/aria-current=\{on \? "true" : undefined\}/);
  });
});

describe("what the grid lets you pick", () => {
  it("disables every day after today", () => {
    // A tile is a RESULT; the forward view is the Calendar. `parseCustomRange`
    // clamps a hand-edited future end for the same reason — this is the half
    // that stops one being produced.
    const c = code(picker);
    expect(c).toMatch(/const future = cell\.key > todayKey/);
    expect(c).toMatch(/disabled=\{future\}/);
  });

  it("drafts on the SECOND click, and Apply is what spends it", () => {
    /**
     * "click on one date and then to another date or same day". The anchor
     * makes the first click a promise rather than a selection; ordering the
     * pair at commit is what makes the same day twice a single day, and a
     * right-to-left drag the same window as left-to-right.
     *
     * The pair stops at a DRAFT rather than going straight out, because every
     * commit re-renders the board and drops every tile to a skeleton — worth a
     * look before it is spent.
     */
    const c = code(picker);
    expect(c).toMatch(/if \(!anchor\) \{[\s\S]{0,60}setAnchor\(day\)/);
    expect(c).toMatch(/setDraft\(\{ from: anchor <= day \? anchor : day, to: anchor <= day \? day : anchor \}\)/);
    expect(c, "and Apply is the only thing that calls onPick with it").toMatch(/onPick\(draft\.from, draft\.to\)/);
    expect(c, "dead until there is something to spend").toMatch(/disabled=\{!draft\}/);
  });

  it("previews the half-made range under the pointer, and says so in words", () => {
    // A calendar cannot show "about to start" and "about to finish"
    // unambiguously — the grid looks identical in both.
    const c = code(picker);
    expect(c).toMatch(/onMouseEnter=\{\(\) => onEnter\(cell\.key\)\}/);
    expect(c).toContain("Pick the second date, or the same one again for a single day.");
    expect(c).toContain("Pick a start date.");
  });

  it("names the band in the footer, not the draft", () => {
    /**
     * THE BUG THIS ASSERTION HOLDS SHUT. Reading only `draft` made the footer
     * say "Pick a start date." underneath a grid that was visibly showing the
     * window in force — opening the popover draws `value` and creates no
     * draft. The words have to name whatever the band is drawn from.
     */
    expect(code(picker)).toMatch(/const shown = draft \?\? value \?\? null/);
  });
});

describe("how the selection is drawn", () => {
  it("runs the band under the numbers as one span, not seven blocks", () => {
    /**
     * With a horizontal gap between cells a selected week is a row of separate
     * rounded blocks, and the eye reads blocks as seven days picked rather than
     * one range.
     */
    expect(code(picker)).toMatch(/border-spacing-x-0/);
    expect(code(picker)).toMatch(/absolute inset-y-0 bg-brand-soft/);
  });

  it("stops the band at the MIDDLE of each endpoint", () => {
    /**
     * The half-cell is what makes the shape read: the disc marks the day, and
     * the wash leaves it in one direction only. Run the band to the cell walls
     * and both ends grow a tail pointing out of the range, which reads as two
     * more days selected than there are.
     */
    const c = code(picker);
    expect(c).toMatch(/start \? "left-1\/2"/);
    expect(c).toMatch(/end \? "right-1\/2"/);
  });

  it("draws no band at all for a single day", () => {
    // There is nothing between one day and itself, and a half-band on each side
    // of one disc is a shape that means nothing.
    expect(code(picker)).toMatch(/selected && lo !== hi \?/);
  });

  it("fills the two edges, so a long range still shows which days you picked", () => {
    expect(code(picker)).toMatch(/edge && "bg-primary/);
  });

  it("names today by a ring, so it survives being inside a selection", () => {
    expect(code(picker)).toMatch(/aria-current=\{cell\.key === todayKey \? "date" : undefined\}/);
    expect(code(picker)).toMatch(/cell\.key === todayKey && !edge && "ring-1/);
  });
});

describe("where it lives, and why", () => {
  it("sits under ui/, because a day cell is a raw button", () => {
    /**
     * `check-ui`'s hand-rolled-button rule allows `<button>` only under
     * `src/components/ui` and `src/components/flow`. Eighty-four day cells
     * wrapped in the kit's `Button` would each bring a height, a padding and a
     * variant a grid square wants none of.
     */
    expect(code(picker)).toContain("<button");
  });

  it("is OURS, not vendored, so the primitive sweep does not own it", () => {
    expect(read("tests/vendored-primitives.test.ts")).toContain('"date-range-picker.tsx"');
  });

  it("owns its padding, and the popover that holds it hands over none", () => {
    /**
     * The footer's rule has to reach both walls of the panel — a divider that
     * stops 16px short reads as an underline on the text above it rather than
     * as the edge of a region — and it cannot do that from inside the
     * popover's own padding box.
     */
    expect(code(read("src/app/dashboard/board-controls.tsx"))).toMatch(/<PopoverContent align="end" className="w-auto p-0">/);
  });
});
