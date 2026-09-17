"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
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
 * ═══ WHY IT WAS REBUILT, AND WHAT WAS ACTUALLY WRONG ═══
 *
 * The first version showed ONE month. That is the whole bug, and it is worse
 * than it sounds: the window a customer most often wants is "the last few
 * weeks", which crosses a month boundary about as often as not. Drawing it
 * meant clicking the start date, clicking `›` — which paints a completely
 * different month, so the day just anchored is now off-screen — and then
 * clicking the end date on faith. You could not see your own range while you
 * were making it. Two months side by side is not decoration; it is the
 * difference between picking a range and guessing at one.
 *
 * It also had NO presets, because they were removed when it was written: the
 * six were a segmented pill track and the owner's word was "not preset ranges
 * but … a calendar dropdown thing". That correctly killed the TRACK, and took
 * the shortcuts with it. "Last 30 days" went from one click to two clicks and
 * two pieces of date arithmetic done by the customer. They are back as a rail
 * down the side, which is where every picker of this shape puts them.
 *
 * ═══ A PRESET APPLIES; A DRAWN RANGE WAITS FOR APPLY ═══
 *
 * These look inconsistent and are not. A preset is a COMPLETE answer the
 * instant it is clicked, so making it wait behind an Apply would add a click to
 * the one case that should be fastest. A hand-drawn pair is not complete until
 * the second click, and even then it is worth a look before it costs a round
 * trip — every commit re-renders the board and drops every tile to a skeleton.
 * So the rail commits on click, the grid collects a draft, and Apply spends it.
 *
 * `onCancel` exists so the footer's other button can close the popover without
 * touching the window. Discarding the draft is automatic: it lives in this
 * component's state, and the popover unmounts it.
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

/** How many days a pair covers, counting BOTH ends — one day is "1 day". */
const spanOf = (from: string, to: string) => Math.round((dayMs(to) - dayMs(from)) / 86_400_000) + 1;

export function DateRangePicker({
  /** Today, in the caller's own clock — see the header on why this is a prop. */
  now,
  /** The window currently in force, so the grid opens on it. */
  value,
  /**
   * The range key in force, so the rail can mark its own row. A drawn window
   * (`2026-08-03..2026-08-14`) matches nothing here, which is correct: the rail
   * shows no selection and the footer shows the dates.
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

  const pending = anchor ? { from: anchor, to: hover ?? anchor } : draft ?? value ?? null;
  const lo = pending ? (pending.from <= pending.to ? pending.from : pending.to) : null;
  const hi = pending ? (pending.from <= pending.to ? pending.to : pending.from) : null;

  const commit = (day: string) => {
    if (!anchor) {
      setAnchor(day);
      return;
    }
    setAnchor(null);
    setHover(null);
    setDraft({ from: anchor <= day ? anchor : day, to: anchor <= day ? day : anchor });
  };

  const months: MonthKey[] = [monthBefore(month), month];
  /**
   * The pair the footer names: the draft if one has been drawn, else the window
   * in force — the same order `pending` resolves the band in, so the words and
   * the band can never describe different days.
   */
  const shown = draft ?? value ?? null;

  return (
    /**
     * IT OWNS ITS OWN PADDING, and the popover is handed `p-0`. The footer's
     * rule has to run the full width of the panel — a divider that stops 16px
     * short of both walls reads as an underline on the text above it rather
     * than as the edge of a region — and it cannot do that from inside a
     * parent's padding box.
     */
    <div className="flex flex-col" onMouseLeave={() => setHover(null)}>
      <div className="flex flex-col p-3 md:flex-row">
        {/* THE SHORTCUTS, DOWN THE SIDE.
            A wrapping row of chips below `md` and a list at `md` and up: the
            rail is 160px of a ~660px panel on a desktop, and on a phone that
            panel is already as wide as the screen, so the same six answers have
            to lie down rather than stand up. */}
        <div className="flex flex-row flex-wrap gap-1 border-b border-border pb-3 md:w-40 md:shrink-0 md:flex-col md:border-b-0 md:border-r md:pb-0 md:pr-3">
          <p className="w-full px-1 pb-1 text-2xs font-medium uppercase tracking-wide text-faint">Quick ranges</p>
          {RANGE_OPTIONS.map((r) => {
            const on = r.key === activeKey;
            return (
              <button
                key={r.key}
                type="button"
                aria-current={on ? "true" : undefined}
                /**
                 * A preset is the whole answer, so it commits on this click —
                 * see the header. Disabled rather than dropped when there is
                 * nowhere to send it (the design gallery), because a rail that
                 * changes length between surfaces is a layout nobody can review.
                 */
                disabled={!onPickPreset}
                onClick={() => onPickPreset?.(r.key)}
                className={cn(
                  "rounded-control px-2 py-1.5 text-left text-xs transition-colors duration-(--duration-fast) md:w-full",
                  on ? "bg-brand-soft text-marker" : "text-muted-foreground hover:bg-control hover:text-foreground",
                  !onPickPreset && "cursor-default",
                )}
              >
                {r.label}
              </button>
            );
          })}
        </div>

        <div className="pt-3 md:pl-3 md:pt-0">
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
              // disabled, so an empty grid would be a control that goes
              // somewhere and shows nothing.
              disabled={month >= monthKeyOf(now)}
              onClick={() => setMonth(monthKeyOf(dayMs(`${month}-01`) + daysInMonth(month) * 86_400_000))}
            >
              <ChevronRight />
            </Button>
          </div>

          <div className="flex gap-5">
            {months.map((m, i) => (
              // The earlier month is the one that goes when there is no room
              // for two: the later one holds today, and a picker that hid today
              // would be hiding the day every backward range ends on.
              <div key={m} className={i === 0 ? "hidden md:block" : undefined}>
                <MonthTable month={m} todayKey={todayKey} lo={lo} hi={hi} onEnter={setHover} onPick={commit} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* WHAT THE NEXT CLICK WILL DO, said in words, and then WHAT IS ON SCREEN.
          A half-made range is the one state a calendar cannot show
          unambiguously — the grid looks the same whether you are about to start
          a range or finish one — so the sentence carries that.

          THE DATES DESCRIBE THE BAND, NOT THE DRAFT, and that distinction was a
          bug worth the extra line. Reading only `draft` made the footer say
          "Pick a start date." under a grid that was visibly showing the window
          in force, because opening the popover draws `value` and creates no
          draft. The footer has to name whatever the band is drawn from or it
          contradicts it. Which of the two it is, Apply already says by being
          live or dead. */}
      <div className="flex items-center gap-3 border-t border-border px-3 py-2.5">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {anchor ? (
            "Pick the second date, or the same one again for a single day."
          ) : shown ? (
            <>
              <span className="font-medium text-foreground">{prettyDay(shown.from)}</span>
              {shown.from === shown.to ? null : (
                <>
                  {" – "}
                  <span className="font-medium text-foreground">{prettyDay(shown.to)}</span>
                </>
              )}
              {` · ${spanOf(shown.from, shown.to)} ${spanOf(shown.from, shown.to) === 1 ? "day" : "days"}`}
            </>
          ) : (
            // All time is the one window with no pair of days, so it reaches
            // here — and "Pick a start date." is exactly right for it.
            "Pick a start date."
          )}
        </p>
        <Button variant="default" size="sm" onClick={() => onCancel?.()}>
          Cancel
        </Button>
        <Button
          variant="accent"
          size="sm"
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
  );
}

/**
 * ONE MONTH'S GRID.
 *
 * Split out because it is drawn twice and the band arithmetic below is the
 * fiddly part of the component — two copies of it is how one month ends up
 * rounding the range's end and the other does not.
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
     * the selection is a row of separate rounded blocks — seven islands rather
     * than one span — and the eye reads islands as seven days picked, not one
     * range. The vertical gap stays, because week rows ARE separate things.
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
               * THE BAND IS ITS OWN LAYER, BEHIND THE NUMBER, and it stops at
               * the middle of each endpoint rather than at the cell wall. That
               * half-cell is the entire reason the shape reads correctly: the
               * filled disc marks the day picked, and the wash leaves it
               * travelling in one direction only — out of the start, into the
               * end. Run the band to the cell edges instead and both endpoints
               * grow a tail pointing out of the range, which reads as two more
               * days selected than there are.
               *
               * A single-day range (`lo === hi`) gets no band at all: there is
               * nothing between one day and itself, and a half-band on each
               * side of one disc is a shape that means nothing.
               */
              const band =
                selected && lo !== hi ?
                  cn(
                    "pointer-events-none absolute inset-y-0 bg-brand-soft",
                    start ? "left-1/2" : ci === 0 ? "left-0 rounded-l-full" : "left-0",
                    end ? "right-1/2" : ci === 6 ? "right-0 rounded-r-full" : "right-0",
                  )
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
                      "relative flex size-9 items-center justify-center rounded-full text-xs tabular-nums transition-colors duration-(--duration-fast)",
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
