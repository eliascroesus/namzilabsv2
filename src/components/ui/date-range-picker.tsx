"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { RANGE_OPTIONS, type RangeKey } from "@/lib/metrics/range";
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
 * THE TWO DATE BOXES ARE NOT DECORATION. Clicking one arms that end, so the
 * next day you click moves only it — changing a window's end is one click
 * rather than redrawing the whole thing. They are also what makes the half-made
 * state legible: mid-pair the start box holds your anchor and the end box goes
 * back to saying "End date", which is the one thing a calendar grid cannot say
 * about itself. They do not accept typing; that needs a date parser, and a
 * parser on the control that drives the whole dashboard is its own change.
 *
 * ═══ A PRESET APPLIES; A DRAWN RANGE WAITS FOR APPLY ═══
 *
 * These look inconsistent and are not. A preset is a COMPLETE answer the
 * instant it is picked, so making it wait behind an Apply would add a click to
 * the one case that should be fastest. A hand-drawn pair is not complete until
 * the second click, and even then it is worth a look before it costs a round
 * trip — every commit re-renders the board and drops every tile to a skeleton.
 * So the dropdown commits on change, the grid collects a draft, and Apply
 * spends it.
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

  const commit = (day: string) => {
    // An armed box moves ONE end and leaves the other where it was.
    if (editing && shown) {
      const other = editing === "from" ? shown.to : shown.from;
      setEditing(null);
      setAnchor(null);
      setHover(null);
      setDraft(order(day, other));
      return;
    }
    if (!anchor) {
      setAnchor(day);
      return;
    }
    setAnchor(null);
    setHover(null);
    setDraft(order(anchor, day));
  };

  /** Arming a box cancels a half-made pair — two ways to set one end at once. */
  const arm = (end: "from" | "to") => {
    setAnchor(null);
    setHover(null);
    setEditing((e) => (e === end ? null : end));
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

        {/* THE TWO ENDS, each one a target. See the header: clicking a box arms
            that end so the next day you click moves only it. */}
        <div className="flex items-center gap-2">
          <DateBox label="Start date" day={boxFrom} armed={editing === "from"} onClick={() => arm("from")} />
          <span className="shrink-0 text-xs text-muted-foreground">to</span>
          <DateBox label="End date" day={boxTo} armed={editing === "to"} onClick={() => arm("to")} />
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
            onClick={() => draft && onPick(draft.from, draft.to)}
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
 * ONE END OF THE RANGE, as a box you can aim at.
 *
 * Styled off the `Select` trigger beside it rather than off `Input`, because
 * that is what it is: a control that opens onto another way of choosing, not a
 * field you type into. Armed, it takes the brand ring — which is what a focused
 * field in this kit does, and that is the point, since armed IS "the next thing
 * you do lands here".
 */
function DateBox({
  label,
  day,
  armed,
  onClick,
}: {
  label: string;
  day: string | null;
  armed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={armed}
      onClick={onClick}
      className={cn(
        "flex h-8 min-w-0 flex-1 items-center rounded-control border border-input bg-control px-2 text-xs tabular-nums transition-colors duration-(--duration-fast) hover:border-rule",
        armed && "border-primary ring-1 ring-primary",
        day ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <span className="truncate">{day ? prettyDay(day) : label}</span>
    </button>
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
