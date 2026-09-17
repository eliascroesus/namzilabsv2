import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE PERIOD CONTROL'S CALENDAR — 7 Sep 2026, rebuilt 17 Sep 2026.
 *
 * "Not preset ranges but … a calendar dropdown thing and the user can pick the
 * ranges so it can click on one date and then to another date or same day."
 *
 * The rebuild's brief was a reference: "just make it look like the calendly
 * one". What that came down to was two months instead of one — the window
 * people actually want crosses a month boundary about as often as not, and
 * drawing one meant anchoring a date and then paging away from it — plus a left
 * column carrying a preset dropdown, the two ends of the range as boxes, and
 * Cancel and Apply at its foot.
 *
 * The riskiest thing about this component cannot be caught by rendering it:
 * this suite runs with `TZ=UTC` and no DOM, so a picker doing its day maths in
 * LOCAL time would agree with every assertion here and disagree with the server
 * for anyone west of Greenwich, in the last hours of every day. That is what
 * the source scan below is for — not style policing, but the only available
 * guard against the one bug the environment cannot reproduce.
 *
 * WHAT THIS FILE STILL CANNOT SEE is whether the thing is pleasant to use. It
 * reads text. The interaction was driven in a real browser instead: a preset
 * commits from the dropdown, a pair drawn across the two months reads back in
 * the boxes, arming one box moves only that end, backwards draws the same
 * window as forwards, the same day twice is one day, and tomorrow is
 * unclickable.
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
     * The boxes print "Aug 24, 2026", which is `toLocaleDateString` — and that
     * reads LOCAL time unless told otherwise. Unpinned, a box would name the
     * day before the one the band is drawn on, for anyone west of Greenwich,
     * which is the disagreement this whole file exists to prevent.
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

describe("the left column", () => {
  it("offers the presets from the single list the URL also speaks", () => {
    /**
     * `RANGE_OPTIONS` rather than a list retyped here: the dropdown's rows and
     * the keys `?range=` accepts have to be the same six, or a shortcut writes
     * a URL that resolves to something else.
     */
    const c = code(picker);
    expect(c).toMatch(/from "@\/lib\/metrics\/range"/);
    expect(c).toMatch(/RANGE_OPTIONS\.map\(/);
  });

  it("commits a preset the moment it is chosen, because a preset is a whole answer", () => {
    // The case that should be fastest must not also pay for an Apply.
    expect(code(picker)).toMatch(/onPickPreset\?\.\(v as RangeKey\)/);
  });

  it("lets a preset overrule a half-drawn pair rather than survive under it", () => {
    /**
     * On the board this is academic — a preset navigates and the popover
     * unmounts with its state — but the component must not depend on being torn
     * down to be correct. Anywhere it stays mounted, a surviving draft would
     * keep the boxes showing a window the preset just replaced.
     */
    const c = code(picker);
    expect(c).toMatch(/if \(v === CUSTOM\) return;[\s\S]{0,120}setDraft\(null\)/);
  });

  it("shows the window in force, and says Custom when no preset spells it", () => {
    const c = code(picker);
    expect(c).toMatch(/const selected = draft \? CUSTOM : \(RANGE_OPTIONS\.find\(\(r\) => r\.key === activeKey\)\?\.key \?\? CUSTOM\)/);
    // `Custom…` is where the dropdown STANDS, not something it does: the
    // calendar beside it is how a custom range gets made.
    expect(c).toMatch(/if \(v === CUSTOM\) return/);
  });

  it("drops the menu below the trigger rather than lifting it over the panel", () => {
    /**
     * A `Select` opens item-aligned by default, which lifts the menu so the
     * CHOSEN row lands on the trigger. With `Custom…` selected — the last of
     * seven — that threw the menu up over the column's own heading and off the
     * top of the popover.
     */
    expect(code(picker)).toMatch(/position="popper"/);
  });

  it("keeps Cancel and Apply at the foot however tall the calendar is", () => {
    // A five-row month and a six-row month must not move the buttons.
    expect(code(picker)).toMatch(/mt-auto flex gap-2/);
  });
});

describe("the two date boxes", () => {
  it("arms one end, so the next click moves only that end", () => {
    /**
     * Changing a window's end should be one click, not a redraw of the whole
     * thing. The other end is read off `shown` so it cannot drift from the band,
     * and the result is a finished pair, so it applies like any other.
     */
    const c = code(picker);
    expect(c).toMatch(/const \[editing, setEditing\] = useState<"from" \| "to" \| null>\(null\)/);
    expect(c).toMatch(/spend\(order\(day, editing === "from" \? shown\.to : shown\.from\)\)/);
    expect(c, "focusing a field is what aims it").toMatch(/onFocus=\{onAim\}/);
  });

  it("hands what was typed to the parser, and parses it nowhere else", () => {
    /**
     * The month arrows step ONE month, so January 2025 was twenty presses away.
     * What the fields accept is `day-input.ts`'s business and is pinned by its
     * own suite — including that it never reaches for `new Date(text)`, which
     * reads `8/19/2026` in LOCAL time against a grid that is entirely UTC. What
     * matters HERE is only that the typed string goes there and nowhere else.
     *
     * Deliberately not a blanket ban on `new Date(` in this file: `prettyDay`
     * calls it on a NUMBER, which is unambiguous and correct. An assertion
     * broad enough to catch the bug was broad enough to fail on the fix.
     */
    const c = code(picker);
    expect(c).toMatch(/from "@\/lib\/metrics\/day-input"/);
    expect(c).toMatch(/const parsed = parseDayInput\(typing\)/);
    expect(c, "the typed string is never parsed by hand").not.toMatch(/new Date\(typing/);
    expect(c, "nor by Date.parse").not.toMatch(/Date\.parse\(typing/);
  });

  it("holds what is being typed apart from what is shown", () => {
    /**
     * Without the split every keystroke would be re-formatted under the cursor —
     * you could not delete the comma in "Aug 19, 2026" without it growing back.
     */
    const c = code(picker);
    expect(c).toMatch(/const \[typing, setTyping\] = useState<string \| null>\(null\)/);
    expect(c).toMatch(/const text = typing \?\? \(day \? prettyDay\(day\) : ""\)/);
    // Good or bad, the field goes back to the canonical spelling: a rejected
    // entry snapping back is how somebody learns it was rejected.
    expect(c).toMatch(/setTyping\(null\);\s*\n\s*if \(parsed\) onType\(parsed\)/);
  });

  it("clamps a typed future date rather than accepting one", () => {
    // A tile is a RESULT. `parseCustomRange` clamps a hand-edited URL the same
    // way, so both doors land on the same window.
    expect(code(picker)).toMatch(/const at = day > todayKey \? todayKey : day/);
  });

  it("catches Escape while an edit is pending, so it does not close the popover", () => {
    // Everywhere else Escape means "undo this edit"; unhandled it would discard
    // the edit AND the popover around it.
    expect(code(picker)).toMatch(/e\.key === "Escape" && typing !== null[\s\S]{0,120}stopPropagation/);
  });

  it("empties the end box mid-pair, which is what the grid cannot say", () => {
    /**
     * A calendar cannot show "about to start" and "about to finish"
     * unambiguously — the grid looks identical in both. The boxes can: the
     * start holds the anchor and the end goes back to its placeholder.
     */
    const c = code(picker);
    expect(c).toMatch(/const boxFrom = anchor \?\? shown\?\.from \?\? null/);
    expect(c).toMatch(/const boxTo = anchor \? null : \(shown\?\.to \?\? null\)/);
    expect(c).toContain("End date");
  });

  it("names the pair on screen, not the draft", () => {
    /**
     * THE BUG THIS ASSERTION HOLDS SHUT. Reading only `draft` left the boxes
     * empty under a grid that was visibly showing the window in force, because
     * opening the popover draws `value` and creates no draft. The boxes have to
     * name whatever the band is drawn from.
     */
    expect(code(picker)).toMatch(/const shown = draft \?\? value \?\? null/);
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

  it("APPLIES on the second click rather than waiting for a button", () => {
    /**
     * "when I click on the calendar on one and then the other to get the range
     * then it should auto apply". Two clicks on a calendar is not a
     * half-finished thought that wants confirming, it is the answer.
     *
     * The anchor still makes the first click a promise rather than a selection;
     * `order` at commit is what makes the same day twice a single day, and a
     * right-to-left drag the same window as left-to-right.
     */
    const c = code(picker);
    expect(c).toMatch(/if \(!anchor\) \{[\s\S]{0,60}setAnchor\(day\)/);
    expect(c).toMatch(/spend\(order\(anchor, day\)\)/);
    expect(c, "Apply is left for the typed path only").toMatch(/disabled=\{!draft\}/);
    expect(c).toMatch(/onClick=\{\(\) => draft && spend\(draft\)\}/);
  });

  it("clears the draft on the way out, so nothing outlives the commit it spent", () => {
    /**
     * THE BUG THIS HOLDS SHUT, caught by driving the component somewhere it
     * stays mounted. `shown` reads `draft ?? value`, so a draft that survived
     * its own commit kept the fields and the band describing the window BEFORE
     * the one just applied — the parent updated `value` and nothing on screen
     * moved. On the board the popover unmounts and takes the state with it,
     * which is exactly why it was invisible there.
     */
    expect(code(picker)).toMatch(/const spend = \(next: \{ from: string; to: string \}\) => \{\s*\n\s*setDraft\(null\)/);
  });

  it("orders every pair the same way, wherever it was made", () => {
    // One helper, so the anchor path and the armed-box path cannot disagree
    // about which of two days is the start.
    expect(code(picker)).toMatch(/const order = \(a: string, b: string\) => \(a <= b \? \{ from: a, to: b \} : \{ from: b, to: a \}\)/);
  });

  it("previews under the pointer, including while one end is armed", () => {
    const c = code(picker);
    expect(c).toMatch(/onMouseEnter=\{\(\) => onEnter\(cell\.key\)\}/);
    expect(c, "an armed end previews against the other one").toMatch(
      /editing && shown && hover \?[\s\S]{0,120}order\(hover, shown\.to\)/,
    );
  });
});

describe("how the selection is drawn", () => {
  it("runs the band under the numbers as one span, not seven blocks", () => {
    /**
     * With a horizontal gap between cells a selected week is a row of separate
     * blocks, and the eye reads blocks as seven days picked rather than one
     * range.
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

  it("leaves the band square where a week breaks", () => {
    /**
     * The reference's own answer and the better one: a rounded cap at the end
     * of a week says "the range stops here" about a range that carries on into
     * the next line.
     */
    /**
     * Pulled out POSITIVELY first. A bare `not.toMatch` over the whole file
     * would also pass if the band layer were deleted outright — the vacuous
     * green this repo has been bitten by before. Finding the expression is what
     * makes the absence of rounding on it mean something.
     */
    const band = code(picker).match(/cn\("pointer-events-none absolute inset-y-0 bg-brand-soft"[\s\S]*?\)\n/)?.[0];
    expect(band, "the band layer should be here to check").toBeTruthy();
    expect(band, "no rounded caps on the band").not.toMatch(/rounded/);
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
     * The column divider has to run the full height of the panel — a rule that
     * stops 16px short at both ends reads as a stray mark rather than as the
     * edge of a region — and it cannot do that from inside the popover's own
     * padding box.
     */
    expect(code(read("src/app/dashboard/board-controls.tsx"))).toMatch(/<PopoverContent align="end" className="w-auto p-0">/);
  });
});
