"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { dayKey, daysInMonth, monthBefore, monthGrid, monthKeyOf, monthLabel, WEEKDAYS, type MonthKey } from "@/lib/metrics/calendar";

/**
 * A MONTH YOU PICK TWO DAYS ON — the period control's calendar.
 *
 * The owner asked for it in one sentence: "a calendar dropdown thing and the
 * user can pick the ranges so it can click on one date and then to another date
 * or same day or depending on what range it wants to see." So: first click sets
 * an anchor, the grid previews as the pointer moves, the second click commits.
 * The same day twice is one day, which is what the sentence's "or same day"
 * asks for and what a range picker usually gets wrong.
 *
 * EVERY DATE IN THIS FILE IS UTC, and that is not pedantry. The whole product
 * dates records in UTC (`resolveRange`, `calendarDayRanges`), and this suite
 * runs with `TZ=UTC` and no DOM — so a picker doing its day maths in LOCAL time
 * would agree with every test and disagree with the server for anyone west of
 * Greenwich, on the last hours of every day. `Date.UTC` and `getUTC*` only, and
 * `now` arrives as a prop rather than being read here, because this renders on
 * the server first and a bare `new Date()` would compute today twice — once per
 * side of the hydration boundary — and disagree across a midnight.
 *
 * IT BORROWS THE CALENDAR VIEW'S OWN GRID. `monthGrid` emits Sunday-first weeks
 * padded with nulls, `WEEKDAYS` names the columns, `monthLabel` prints the month
 * in UTC. That module is pure on purpose; the two surfaces that draw days in
 * this product now draw them from one place, so a month can never start on a
 * different weekday in the header than it does on the Calendar.
 *
 * DAYS AFTER TODAY ARE DISABLED. A tile is a RESULT — the forward view is the
 * Calendar, which draws days still to come quieter than days that happened.
 * `parseCustomRange` clamps a hand-edited future end for the same reason; this
 * is the half that stops one being produced in the first place.
 *
 * IT LIVES IN `ui/` BECAUSE THE DAY CELLS ARE `<button>`s. `check-ui`'s
 * hand-rolled-button rule allows a raw button only under `src/components/ui`
 * and `src/components/flow`, and 42 of them wrapped in the kit's `Button`
 * (which brings a height, a padding and a variant a grid square wants none of)
 * would be worse. It is in vendored-primitives' OURS set: ours, not vendored.
 */
export function DateRangePicker({
  /** Today, in the caller's own clock — see the header on why this is a prop. */
  now,
  /** The window currently in force, so the grid opens on it. */
  value,
  onPick,
}: {
  now: Date;
  value?: { from: string; to: string } | null;
  onPick: (from: string, to: string) => void;
}) {
  const todayKey = dayKey(now);
  const [month, setMonth] = useState<MonthKey>(() => monthKeyOf(value?.to ? Date.parse(`${value.to}T00:00:00Z`) : now));
  /** The first click of a pair. `null` means the next click starts one. */
  const [anchor, setAnchor] = useState<string | null>(null);
  /** What the pointer is over, so a half-made range previews. */
  const [hover, setHover] = useState<string | null>(null);

  const pending = anchor ? { from: anchor, to: hover ?? anchor } : value ?? null;
  const lo = pending ? (pending.from <= pending.to ? pending.from : pending.to) : null;
  const hi = pending ? (pending.from <= pending.to ? pending.to : pending.from) : null;

  const commit = (day: string) => {
    if (!anchor) {
      setAnchor(day);
      return;
    }
    setAnchor(null);
    setHover(null);
    onPick(anchor <= day ? anchor : day, anchor <= day ? day : anchor);
  };

  return (
    <div className="w-64" onMouseLeave={() => setHover(null)}>
      {/* THE MONTH, AND THE TWO WAYS THROUGH IT. No "today" shortcut here: the
          grid already opens on the current month, and a third control in a
          three-element row is one more thing to read than the row is worth. */}
      <div className="mb-2 flex items-center justify-between">
        <Button
          variant="ghost"
          size="iconSm"
          aria-label="Previous month"
          onClick={() => setMonth(monthBefore(month))}
        >
          <ChevronLeft />
        </Button>
        {/* `aria-live` so a screen reader hears the month change under the
            arrows — the grid below it re-renders silently otherwise. */}
        <span aria-live="polite" className="text-sm font-medium text-foreground">
          {monthLabel(month)}
        </span>
        <Button
          variant="ghost"
          size="iconSm"
          aria-label="Next month"
          // Never past the month holding today: every day beyond it is disabled,
          // so an empty grid would be a control that goes somewhere and shows
          // nothing.
          disabled={month >= monthKeyOf(now)}
          onClick={() => setMonth(monthKeyOf(Date.parse(`${month}-01T00:00:00Z`) + daysInMonth(month) * 86_400_000))}
        >
          <ChevronRight />
        </Button>
      </div>

      <table className="w-full border-separate border-spacing-y-0.5" role="grid">
        <thead>
          <tr>
            {WEEKDAYS.map((d) => (
              // The first letter only: seven three-letter names do not fit a
              // 256px popover without shrinking the cells below reading size.
              <th key={d} scope="col" className="pb-1 text-2xs font-medium text-faint" abbr={d}>
                {d[0]}
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
                const edge = cell.key === lo || cell.key === hi;
                return (
                  <td key={ci} className="p-0">
                    <button
                      type="button"
                      disabled={future}
                      aria-selected={selected}
                      aria-current={cell.key === todayKey ? "date" : undefined}
                      onMouseEnter={() => setHover(cell.key)}
                      onClick={() => commit(cell.key)}
                      className={cn(
                        "flex h-8 w-full items-center justify-center rounded-control text-xs tabular-nums transition-colors duration-(--duration-fast)",
                        // A day past today is not a result yet — see the header.
                        future && "cursor-default text-faint",
                        !future && !selected && "text-foreground hover:bg-control",
                        // THE EDGES CARRY THE FILL, the days between carry the
                        // wash: without the split a ten-day range is one solid
                        // blue bar and you cannot see which two days you picked.
                        selected && !edge && "bg-brand-soft text-foreground",
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

      {/* WHAT THE NEXT CLICK WILL DO, said in words. A half-made range is the
          one state a calendar cannot show unambiguously — the grid looks the
          same whether you are about to start a range or finish one. */}
      <p className="mt-2 text-2xs text-muted-foreground">
        {anchor ? "Pick the second date, or the same one again for a single day." : "Pick a start date."}
      </p>
    </div>
  );
}
