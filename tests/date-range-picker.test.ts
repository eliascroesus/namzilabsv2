import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE PERIOD CONTROL'S CALENDAR — 7 Sep 2026.
 *
 * "Not preset ranges but … a calendar dropdown thing and the user can pick the
 * ranges so it can click on one date and then to another date or same day."
 *
 * The riskiest thing about this component cannot be caught by rendering it:
 * this suite runs with `TZ=UTC` and no DOM, so a picker doing its day maths in
 * LOCAL time would agree with every assertion here and disagree with the server
 * for anyone west of Greenwich, in the last hours of every day. That is what
 * the source scan below is for — not style policing, but the only available
 * guard against the one bug the environment cannot reproduce.
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

describe("what the grid lets you pick", () => {
  it("disables every day after today", () => {
    // A tile is a RESULT; the forward view is the Calendar. `parseCustomRange`
    // clamps a hand-edited future end for the same reason — this is the half
    // that stops one being produced.
    const c = code(picker);
    expect(c).toMatch(/const future = cell\.key > todayKey/);
    expect(c).toMatch(/disabled=\{future\}/);
    expect(c, "and the month arrow cannot walk past today either").toMatch(/disabled=\{month >= monthKeyOf\(now\)\}/);
  });

  it("commits on the SECOND click, so one date is an anchor and two are a range", () => {
    /**
     * "click on one date and then to another date or same day". The anchor
     * makes the first click a promise rather than a selection; ordering the
     * pair at commit is what makes the same day twice a single day, and a
     * right-to-left drag the same window as left-to-right.
     */
    const c = code(picker);
    expect(c).toMatch(/if \(!anchor\) \{[\s\S]{0,60}setAnchor\(day\)/);
    expect(c).toMatch(/onPick\(anchor <= day \? anchor : day, anchor <= day \? day : anchor\)/);
  });

  it("previews the half-made range under the pointer, and says so in words", () => {
    // A calendar cannot show "about to start" and "about to finish"
    // unambiguously — the grid looks identical in both.
    const c = code(picker);
    expect(c).toMatch(/onMouseEnter=\{\(\) => setHover\(cell\.key\)\}/);
    expect(c).toContain("Pick the second date, or the same one again for a single day.");
    expect(c).toContain("Pick a start date.");
  });

  it("draws the two edges as fills and the days between as a wash", () => {
    // Without the split a ten-day range is one solid bar and you cannot see
    // which two days you actually picked.
    const c = code(picker);
    expect(c).toMatch(/selected && !edge && "bg-brand-soft/);
    expect(c).toMatch(/edge && "bg-primary/);
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
     * `src/components/ui` and `src/components/flow`. Forty-two day cells
     * wrapped in the kit's `Button` would each bring a height, a padding and a
     * variant a grid square wants none of.
     */
    expect(code(picker)).toContain("<button");
  });

  it("is OURS, not vendored, so the primitive sweep does not own it", () => {
    expect(read("tests/vendored-primitives.test.ts")).toContain('"date-range-picker.tsx"');
  });
});
