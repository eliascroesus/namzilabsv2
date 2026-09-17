"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { RANGE_OPTIONS, type RangeKey } from "@/lib/metrics/range";
import { parseDayInput } from "@/lib/metrics/day-input";
import { dayKey, daysInMonth, monthBefore, monthGrid, monthKeyOf, monthLabel, WEEKDAYS, type MonthKey } from "@/lib/metrics/calendar";

/**
 * TWO MONTHS YOU PICK TWO DAYS ON — the period control's calendar.
 *
 * The owner asked for it in one sentence: "a calendar dropdown thing and the
 * user can pick the ranges so it can click on one date and then to another date
 * or same day or depending on what range it wants to see." So: first click sets
 * an anchor, the grid previews as the pointer moves, the second click draws the
 * pair. The same day twice is one day, which is what the sentence's "or same
 * day" asks for and what a range picker usually gets wrong.
 *
 * ═══ WHY IT WAS REBUILT ═══
 *
 * The brief was Calendly: "calendly has made it extremely easy for users and
 * very comfortable to change dates and ranges". What Calendly gets right here
 * is not the styling — it is that you can see your whole range while you are
 * making it.
 *
 * The first version showed ONE month, and that is the whole bug. The window a
 * customer most often wants is "the last few weeks", which crosses a month
 * boundary about as often as not. Drawing it meant clicking the start date,
 * clicking `›` — which paints a completely different month, so the day just
 * anchored is now off-screen — and then clicking the end date on faith. You
 * could not see your own range while you were making it.
 *
 * It also had NO presets, because they were removed when it was written: the
 * six were a segmented pill track and the owner's word was "not preset ranges
 * but … a calendar dropdown thing". That correctly killed the TRACK, and took
 * the shortcuts with it. "Last 30 days" went from one click to two clicks and
 * two pieces of date arithmetic done by the customer.
 *
 * ═══ THE SHAPE IS CALENDLY'S, AND THE PARTS ARE THIS KIT'S ═══
 *
 * A left column — heading, the preset dropdown, the two dates, and Cancel and
 * Apply at its foot — with the two months to the right of it. The dropdown is
 * the kit's own `Select`, which already draws a bordered trigger with a chevron
 * and ticks the chosen row, so the one place this could have drifted into a
 * second visual language instead reuses the one the rest of the product speaks.
 *
 * THE TWO DATE BOXES ARE FIELDS. They began read-only and that was wrong: the
 * month arrows step ONE month, so a window starting in January 2025 was twenty
 * presses away, and a control whose brief is "comfortable to change dates"
 * cannot ask that. `parseDayInput` reads what is typed — explicitly, per
 * format, never through `new Date`, which would parse half of them in local
 * time against a grid that is entirely UTC.
 *
 * They are targets as well: focusing one aims the next calendar click at that
 * end, so moving a window's end is one click rather than redrawing the whole
 * window. And they carry the half-made state, which is the one thing a calendar
 * grid cannot say about itself — mid-pair the start box holds your anchor and
 * the end box goes back to reading "End date".
 *
 * ═══ THE GRID APPLIES ITSELF; TYPING WAITS FOR APPLY ═══
 *
 * Two clicks on a calendar is not a half-finished thought that wants
 * confirming, it is the answer, so a pair completed on the grid commits itself.
 * A preset is the same: a COMPLETE answer the instant it is picked, and making
 * the fastest case pay for an Apply would be backwards.
 *
 * TYPING IS THE ONE THING THAT WAITS, and the asymmetry is the point rather
 * than an inconsistency. Committing a typed field the moment it parsed would
 * close the popover as soon as you tabbed out of the FIRST of the two boxes,
 * before you had said what the second one was. So the fields collect a draft
 * and Apply spends it, which is the only thing Apply is for.
 *
 * `Custom…` is in the list because the reference's is, and it is the honest
 * name for where the dropdown stands once you have drawn a window by hand.
 * Choosing it deliberately does nothing: the calendar beside it is how a custom
 * range gets made, and a row that re-drew the grid would be a second way to do
 * the same thing.
 *
 * ═══ EVERY DATE IN THIS FILE IS UTC, and that is not pedantry ═══
 *
 * The whole product dates records in UTC (`resolveRange`, `calendarDayRanges`),
 * and this suite runs with `TZ=UTC` and no DOM — so a picker doing its day
 * maths in LOCAL time would agree with every test and disagree with the server
 * for anyone west of Greenwich, on the last hours of every day. `Date.UTC` and
 * `getUTC*` only, and `now` arrives as a prop rather than being read here,
 * because this renders on the server first and a bare `new Date()` would
 * compute today twice — once per side of the hydration boundary — and disagree
 * across a midnight.
 *
 * IT BORROWS THE CALENDAR VIEW'S OWN GRID. `monthGrid` emits Sunday-first weeks
 * padded with nulls, `WEEKDAYS` names the columns, `monthLabel` prints the month
 * in UTC. That module is pure on purpose; the two surfaces that draw days in
 * this product draw them from one place, so a month can never start on a
 * different weekday in the header than it does on the Calendar.
 *
 * DAYS AFTER TODAY ARE DISABLED. A tile is a RESULT — the forward view is the
 * Calendar, which draws days still to come quieter than days that happened.
 * `parseCustomRange` clamps a hand-edited future end for the same reason; this
 * is the half that stops one being produced in the first place.
 *
 * IT LIVES IN `ui/` BECAUSE THE DAY CELLS ARE `<button>`s. `check-ui`'s
 * hand-rolled-button rule allows a raw button only under `src/components/ui`
 * and `src/components/flow`, and 84 of them wrapped in the kit's `Button`
 * (which brings a height, a padding and a variant a grid square wants none of)
 * would be worse. It is in vendored-primitives' OURS set: ours, not vendored.
 *
 * STILL MISSING: arrow-key navigation of the grid. Every day is a tab stop, so
 * reaching the end of a month by keyboard is thirty presses, and two months
 * made that worse rather than better. The fix is a roving `tabIndex` with
 * arrow handling, which needs imperative focus management and deserves its own
 * change rather than riding along with a redesign.
 */

/** "2026-08-19" → the UTC midnight that starts it. */
const dayMs = (key: string) => Date.parse(`${key}T00:00:00Z`);

/** "Aug 19, 2026" — pinned locale and UTC, like every other formatter here. */
const prettyDay = (key: string) =>
  new Date(dayMs(key)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** The one spelling this component stores a pair in: earlier day first. */
const order = (a: string, b: string) => (a <= b ? { from: a, to: b } : { from: b, to: a });

/**
 * The dropdown's value when the window in force is one nobody picked from the
 * list. A real key would have to be a seventh `RangeKey`, which `resolveRange`
 * would then have to answer for — this is a value for the SELECT, not for the
 * URL, and it never leaves this file.
 */
const CUSTOM = "custom";

export function DateRangePicker({
  /** Today, in the caller's own clock — see the header on why this is a prop. */
  now,
  /** The window currently in force, so the grid opens on it. */
  value,
  /**
   * The range key in force, so the dropdown can show its own label. A drawn
   * window (`2026-08-03..2026-08-14`) matches nothing here and reads "Custom…",
   * which is what it is.
   */
  activeKey,
  onPick,
  /** Absent on the design gallery, where there is no URL to push a preset into. */
  onPickPreset,
  onCancel,
}: {
  now: Date;
  value?: { from: string; to: string } | null;
  activeKey?: string;
  onPick: (from: string, to: string) => void;
  onPickPreset?: (key: RangeKey) => void;
  onCancel?: () => void;
}) {
  const todayKey = dayKey(now);
  /**
   * `month` names the LATER of the two months on screen, and the earlier one is
   * derived from it. That way round because the pair has to open on
   * [last month, this month] — a picker that opened on [this month, NEXT month]
   * would spend half its width on days that are all disabled.
   */
  const [month, setMonth] = useState<MonthKey>(() => monthKeyOf(value?.to ? dayMs(value.to) : now));
  /** The first click of a pair. `null` means the next click starts one. */
  const [anchor, setAnchor] = useState<string | null>(null);
  /** What the pointer is over, so a half-made range previews. */
  const [hover, setHover] = useState<string | null>(null);
  /** The pair Apply would commit. `null` means nothing has been drawn yet. */
  const [draft, setDraft] = useState<{ from: string; to: string } | null>(null);
  /** Which date box is armed, so the next click moves only that end. */
  const [editing, setEditing] = useState<"from" | "to" | null>(null);

  /**
   * The pair on screen: the draft if one has been drawn, else the window in
   * force. Everything below — the band, the two boxes, what an armed end is
   * measured against — reads this one value, so they cannot disagree.
   */
  const shown = draft ?? value ?? null;

  /** The band, including whatever the pointer is currently proposing. */
  const pending =
    anchor ? order(anchor, hover ?? anchor)
    : editing && shown && hover ? (editing === "from" ? order(hover, shown.to) : order(shown.from, hover))
    : shown;
  const lo = pending?.from ?? null;
  const hi = pending?.to ?? null;

  /**
   * A PAIR COMPLETED ON THE GRID APPLIES ITSELF.
   *
   * It used to stop at a draft and wait for Apply, and that was one click too
   * many for the gesture the whole control is built around: two clicks on a
   * calendar is not a half-finished thought that wants confirming, it is the
   * answer. The owner's words — "when I click on the calendar on one and then
   * the other to get the range then it should auto apply".
   *
   * TYPING STILL WAITS, and the asymmetry is the point rather than an
   * inconsistency. Committing a typed field the moment it parsed would close
   * the popover as soon as you tabbed out of the FIRST of the two boxes, before
   * you had said what the second one was. So the fields collect a draft and
   * Apply spends it, which is the only thing Apply is for now.
   */
  /**
   * SPEND A PAIR, AND LEAVE NOTHING BEHIND IT.
   *
   * Clearing the draft is the whole reason this is a function rather than three
   * calls to `onPick`. `shown` reads `draft ?? value`, so a draft that outlives
   * the commit that spent it keeps the fields and the band describing the
   * window BEFORE the one just applied — the parent updates `value` and nothing
   * on screen moves. On the board the popover unmounts and takes the state with
   * it, which is exactly why this was invisible there and turned up the moment
   * the component was driven somewhere it stays mounted.
   */
  const spend = (next: { from: string; to: string }) => {
    setDraft(null);
    setAnchor(null);
    setHover(null);
    setEditing(null);
    onPick(next.from, next.to);
  };

  const commit = (day: string) => {
    // An armed end moves ONE side and leaves the other where it was — and that
    // is a finished pair too, so it applies like any other.
    if (editing && shown) {
      spend(order(day, editing === "from" ? shown.to : shown.from));
      return;
    }
    if (!anchor) {
      setAnchor(day);
      return;
    }
    spend(order(anchor, day));
  };

  /**
   * A DATE THAT WAS TYPED, held as a draft for Apply.
   *
   * Clamped to today for the same reason the grid disables tomorrow: a tile is
   * a RESULT. `parseCustomRange` clamps a hand-edited URL identically, so a
   * typed future date lands on the same window either way — and because the
   * field snaps back to the canonical spelling afterwards, the clamp is
   * something you SEE rather than something that happens to you.
   */
  const typed = (end: "from" | "to", day: string) => {
    const at = day > todayKey ? todayKey : day;
    const base = shown ?? { from: at, to: at };
    setAnchor(null);
    setHover(null);
    setDraft(end === "from" ? order(at, base.to) : order(base.from, at));
  };

  /** Focusing a field aims the next calendar click at that end. */
  const aim = (end: "from" | "to") => {
    setAnchor(null);
    setHover(null);
    setEditing(end);
  };

  const months: MonthKey[] = [monthBefore(month), month];
  /** Mid-pair the start box holds the anchor and the end box empties. */
  const boxFrom = anchor ?? shown?.from ?? null;
  const boxTo = anchor ? null : (shown?.to ?? null);
  /** A drawn window is `Custom…` however the board's own key spells it. */
  const selected = draft ? CUSTOM : (RANGE_OPTIONS.find((r) => r.key === activeKey)?.key ?? CUSTOM);

  return (
    /**
     * IT OWNS ITS OWN PADDING, and the popover is handed `p-0`. The column
     * divider has to run the full height of the panel — a rule that stops 16px
     * short at both ends reads as a stray mark rather than as the edge of a
     * region — and it cannot do that from inside a parent's padding box.
     */
    <div className="flex flex-col md:flex-row" onMouseLeave={() => setHover(null)}>
      <div className="flex flex-col gap-3 border-b border-border p-3 md:w-72 md:shrink-0 md:border-b-0 md:border-r">
        <p className="text-sm font-medium text-foreground">Date range</p>

        <Select
          value={selected}
          onValueChange={(v) => {
            // `Custom…` is where the dropdown STANDS, not something it does —
            // the calendar beside it is how a custom range gets made.
            if (v === CUSTOM) return;
            /**
             * A preset REPLACES whatever was half-drawn. On the board this is
             * academic — the preset navigates and the popover unmounts with its
             * state — but the component must not depend on being torn down to
             * be correct, and anywhere it stays mounted a surviving draft would
             * keep the two boxes showing a window the preset just overruled.
             */
            setDraft(null);
            setAnchor(null);
            setEditing(null);
            onPickPreset?.(v as RangeKey);
          }}
        >
          <SelectTrigger className="w-full" aria-label="Range preset" disabled={!onPickPreset}>
            <SelectValue />
          </SelectTrigger>
          {/**
           * `popper`, NOT the kit default. A `Select` normally opens
           * item-aligned — it lifts the menu so the CHOSEN row lands over the
           * trigger, which is right for a long list you are scrubbing through
           * and wrong here: picking `Custom…`, the last of seven, threw the
           * menu up over the panel's own heading and off the top of the
           * popover. Six short answers want a menu that drops, and matching the
           * trigger's width keeps the column reading as one control.
           */}
          <SelectContent position="popper" className="w-(--radix-select-trigger-width)">
            {RANGE_OPTIONS.map((r) => (
              <SelectItem key={r.key} value={r.key}>
                {r.label}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM}>Custom…</SelectItem>
          </SelectContent>
        </Select>

        {/* THE TWO ENDS, TYPEABLE. Also targets: focusing one aims the next
            calendar click at that end, so moving a window's end is one click
            and reaching January 2025 is one sentence rather than twenty presses
            of the month arrow. */}
        <div className="flex items-center gap-2">
          <DateField label="Start date" day={boxFrom} armed={editing === "from"} onAim={() => aim("from")} onType={(d) => typed("from", d)} />
          <span className="shrink-0 text-xs text-muted-foreground">to</span>
          <DateField label="End date" day={boxTo} armed={editing === "to"} onAim={() => aim("to")} onType={(d) => typed("to", d)} />
        </div>

        {/* `mt-auto` pins these to the foot of the column however tall the
            calendar beside them happens to be — a five-row month and a six-row
            month must not move the buttons. */}
        <div className="mt-auto flex gap-2 pt-1">
          <Button variant="default" size="sm" className="flex-1" onClick={() => onCancel?.()}>
            Cancel
          </Button>
          <Button
            variant="accent"
            size="sm"
            className="flex-1"
            // Nothing drawn means Apply would re-commit the window already in
            // force: a round trip, every tile to a skeleton, the same numbers
            // back.
            disabled={!draft}
            onClick={() => draft && spend(draft)}
          >
            Apply
          </Button>
        </div>
      </div>

      <div className="p-3">
        {/* ONE HEADER FOR BOTH MONTHS, arrows at the outside edges. The two
            labels sit over their own grids, so the row reads as a single span
            of time rather than as two independent calendars. */}
        <div className="mb-1 flex items-center gap-1">
          <Button variant="ghost" size="iconSm" aria-label="Previous month" onClick={() => setMonth(monthBefore(month))}>
            <ChevronLeft />
          </Button>
          {/* `aria-live` so a screen reader hears the months change under the
              arrows — the grids below re-render silently otherwise. */}
          <span aria-live="polite" className="flex flex-1 justify-around gap-2 text-sm font-medium text-foreground">
            {/* Below `md` only the later month is drawn, so only its name
                belongs in the header. */}
            <span className="hidden md:block">{monthLabel(months[0])}</span>
            <span>{monthLabel(months[1])}</span>
          </span>
          <Button
            variant="ghost"
            size="iconSm"
            aria-label="Next month"
            // Never past the month holding today: every day beyond it is
            // disabled, so an empty grid would be a control that goes somewhere
            // and shows nothing.
            disabled={month >= monthKeyOf(now)}
            onClick={() => setMonth(monthKeyOf(dayMs(`${month}-01`) + daysInMonth(month) * 86_400_000))}
          >
            <ChevronRight />
          </Button>
        </div>

        <div className="flex gap-5">
          {months.map((m, i) => (
            // The earlier month is the one that goes when there is no room for
            // two: the later one holds today, and a picker that hid today would
            // be hiding the day every backward range ends on.
            <div key={m} className={i === 0 ? "hidden md:block" : undefined}>
              <MonthTable month={m} todayKey={todayKey} lo={lo} hi={hi} onEnter={setHover} onPick={commit} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * ONE END OF THE RANGE — typeable, and a target for the grid.
 *
 * It began as a read-only box, and that was the wrong call: the month arrows
 * step ONE month, so a window starting in January 2025 was twenty presses away,
 * and a control whose whole brief is "comfortable to change dates" cannot make
 * you do that. It is a real field now, parsed by `parseDayInput` — which
 * matches each accepted spelling explicitly rather than handing the string to
 * `new Date`, because that function reads `8/19/2026` in LOCAL time and the
 * whole product dates in UTC.
 *
 * ═══ WHAT IS TYPED IS NOT WHAT IS SHOWN, UNTIL IT SETTLES ═══
 *
 * `typing` holds the in-progress text and `null` means "show the canonical
 * day". Without that split, every keystroke would be re-formatted under the
 * cursor — you could not delete the comma in "Aug 19, 2026" without it growing
 * back. On blur or Enter the text is parsed and thrown away either way: a good
 * entry is replaced by the canonical spelling of the day it named, and a bad
 * one snaps back to the date still in force, which is how somebody learns it
 * was rejected without an error message appearing inside a popover.
 *
 * ESCAPE IS CAUGHT WHILE AN EDIT IS PENDING. It reaches the popover otherwise
 * and closes the whole thing, so the key that everywhere else means "undo this
 * edit" would instead discard the edit AND the popover around it.
 *
 * ARMED IS ITS OWN RING, not the focus ring. Focusing aims the next calendar
 * click at this end, and clicking the calendar blurs the field — so if the mark
 * were `focus-visible` it would vanish at the exact moment it became true.
 */
function DateField({
  label,
  day,
  armed,
  onAim,
  onType,
}: {
  label: string;
  day: string | null;
  armed: boolean;
  onAim: () => void;
  onType: (day: string) => void;
}) {
  const [typing, setTyping] = useState<string | null>(null);
  const text = typing ?? (day ? prettyDay(day) : "");

  const settle = () => {
    if (typing === null) return;
    const parsed = parseDayInput(typing);
    setTyping(null);
    if (parsed) onType(parsed);
  };

  return (
    <Input
      aria-label={label}
      placeholder={label}
      value={text}
      onFocus={onAim}
      onChange={(e) => setTyping(e.target.value)}
      onBlur={settle}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          settle();
        }
        if (e.key === "Escape" && typing !== null) {
          // See the header: otherwise this closes the popover instead.
          e.stopPropagation();
          setTyping(null);
        }
      }}
      className={cn("min-w-0 flex-1 px-2 text-xs tabular-nums", armed && "border-primary ring-1 ring-primary")}
    />
  );
}

/**
 * ONE MONTH'S GRID.
 *
 * Split out because it is drawn twice and the band arithmetic below is the
 * fiddly part of the component — two copies of it is how one month ends up
 * drawing the range's end differently from the other.
 */
function MonthTable({
  month,
  todayKey,
  lo,
  hi,
  onEnter,
  onPick,
}: {
  month: MonthKey;
  todayKey: string;
  lo: string | null;
  hi: string | null;
  onEnter: (day: string) => void;
  onPick: (day: string) => void;
}) {
  return (
    /**
     * `border-spacing-x-0` IS WHAT MAKES THE BAND A BAND. With a horizontal gap
     * the selection is a row of separate blocks — seven islands rather than one
     * span — and the eye reads islands as seven days picked, not one range. The
     * vertical gap stays, because week rows ARE separate things.
     */
    <table className="border-separate border-spacing-x-0 border-spacing-y-1" role="grid">
      <thead>
        <tr>
          {WEEKDAYS.map((d) => (
            // Three letters now that there is width for them: a header with "S"
            // twice and "T" twice is one you have to count along.
            <th key={d} scope="col" className="pb-1 text-2xs font-medium uppercase tracking-wide text-faint">
              {d}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {monthGrid(month).map((week, wi) => (
          <tr key={wi}>
            {week.map((cell, ci) => {
              if (!cell) return <td key={ci} />;
              const future = cell.key > todayKey;
              const selected = lo != null && hi != null && cell.key >= lo && cell.key <= hi;
              const start = cell.key === lo;
              const end = cell.key === hi;
              const edge = start || end;
              /**
               * THE BAND IS ITS OWN LAYER, BEHIND THE NUMBERS, and it stops at
               * the MIDDLE of each endpoint rather than at the cell wall. That
               * half-cell is the entire reason the shape reads correctly: the
               * filled disc marks the day picked, and the wash leaves it
               * travelling in one direction only — out of the start, into the
               * end. Run the band to the cell edges instead and both endpoints
               * grow a tail pointing out of the range, which reads as two more
               * days selected than there are.
               *
               * SQUARE WHERE A ROW BREAKS, which is the reference's answer and
               * the better one: a rounded cap at the end of a week says "the
               * range stops here" about a range that carries on into the next
               * line. A straight edge at the wall says the opposite, correctly.
               *
               * A single-day range (`lo === hi`) gets no band at all: there is
               * nothing between one day and itself, and a half-band on each
               * side of one disc is a shape that means nothing.
               */
              const band =
                selected && lo !== hi ?
                  cn("pointer-events-none absolute inset-y-0 bg-brand-soft", start ? "left-1/2" : "left-0", end ? "right-1/2" : "right-0")
                : null;
              return (
                <td key={ci} className="relative p-0">
                  {band ? <span aria-hidden className={band} /> : null}
                  <button
                    type="button"
                    disabled={future}
                    aria-selected={selected}
                    aria-current={cell.key === todayKey ? "date" : undefined}
                    onMouseEnter={() => onEnter(cell.key)}
                    onClick={() => onPick(cell.key)}
                    className={cn(
                      // `rounded-full` on a square box: a range picker's
                      // endpoint is a disc in every calendar a person has used,
                      // and the disc is what makes the band look threaded
                      // through the picked days rather than stopping beside
                      // them.
                      "relative flex size-9 items-center justify-center rounded-full text-sm tabular-nums transition-colors duration-(--duration-fast)",
                      // A day past today is not a result yet — see the header.
                      future && "cursor-default text-faint",
                      !future && !selected && "text-foreground hover:bg-control",
                      // THE EDGES CARRY THE FILL, the days between carry the
                      // wash: without the split a ten-day range is one solid
                      // blue bar and you cannot see which two days you picked.
                      selected && !edge && "text-foreground",
                      edge && "bg-primary text-primary-foreground",
                      // Today is named by a ring rather than a fill, so it
                      // survives being inside a selection.
                      cell.key === todayKey && !edge && "ring-1 ring-inset ring-marker",
                    )}
                  >
                    {cell.date}
                  </button>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
