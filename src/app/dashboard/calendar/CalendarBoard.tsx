"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Select } from "@/components/flow/controls";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { refreshFlowAction } from "@/app/dashboard/flows/actions";
import { formatMetricValue, relativeTime } from "@/lib/format";
import { monthGrid, monthLabel, WEEKDAYS, type MonthKey } from "@/lib/metrics/calendar";
// Its own directive-free module, so the server-rendered skeleton can read it
// as a string rather than as a client reference. See day-cell.ts.
import { DAY_CELL_H } from "./day-cell";
import { cn } from "@/lib/utils";

/** One published metric, with the day values the materializer stored for it. */
export type CalendarMetric = {
  /** `${flowId}:${outputNodeId}` — unique across the board, and the picker's value. */
  id: string;
  flowId: string;
  flowName: string;
  name: string;
  /** Exactly the keys `formatMetricValue` reads, so a day reads like its tile. */
  format: { format?: string; precision?: number; unit?: string; currency?: string; durationDisplay?: string };
  days: Record<string, { value: number; records?: number }>;
  status: string;
  error: string | null;
  /** ISO — the client only ever formats it, never re-clocks the day boundaries. */
  computedAt: string | null;
};

/**
 * THE CALENDAR: one metric, one month, one square per day.
 *
 * WHY IT IS ENTIRELY CLIENT-SIDE. Every day of every month this view can show
 * is already stored on the tile (`byDay`), and the page hands over every metric
 * the viewer may see in its first payload — so changing the metric or stepping
 * back a month is a re-render, not a request. There is no spinner because there
 * is nothing to wait for, which is the only version of "fast" that survives a
 * bad connection.
 *
 * That is also why the month can only step between the two months the
 * materializer stores. A third month would not be slow, it would be EMPTY, and
 * a control that reveals nothing is worse than one that stops.
 *
 * `todayKey` and `months` come from the server rather than from `new Date()`
 * here: the boundaries a value was filed under are UTC, and a browser in
 * Auckland deciding locally which square is "today" would ring the wrong one.
 */
export function CalendarBoard({
  metrics,
  months,
  todayKey,
}: {
  metrics: CalendarMetric[];
  /** Oldest first; the last is the current month. */
  months: MonthKey[];
  /** "2026-05-24" — the server's UTC today. */
  todayKey: string;
}) {
  const [metricId, setMetricId] = useState(metrics[0]?.id ?? "");
  const [monthIdx, setMonthIdx] = useState(months.length - 1);

  const metric = metrics.find((m) => m.id === metricId) ?? metrics[0];
  const month = months[monthIdx] ?? months[months.length - 1];
  const weeks = useMemo(() => monthGrid(month), [month]);

  /**
   * The month's own numbers, derived from the squares on screen — never from
   * the tile's headline, which answers a different question (its own range).
   *
   * NO TOTAL, DELIBERATELY. Nothing stored says whether a metric is additive:
   * "leads booked" sums across days and "show rate" and "average deal size" do
   * not, and a tile carries no flag that tells them apart. A month total would
   * therefore be right for some metrics and quietly nonsense for others — the
   * worst kind of dashboard number. Best day, days with data and the mean of
   * the days shown are true for every metric by construction.
   */
  const stats = useMemo(() => {
    const inMonth = Object.entries(metric?.days ?? {}).filter(([k]) => k.startsWith(month));
    if (inMonth.length === 0) return null;
    const best = inMonth.reduce((a, b) => (b[1].value > a[1].value ? b : a));
    const sum = inMonth.reduce((n, [, d]) => n + d.value, 0);
    return { days: inMonth.length, best: { key: best[0], value: best[1].value }, average: sum / inMonth.length };
  }, [metric, month]);

  /**
   * The heat scale's ceiling: the largest MAGNITUDE in this month, so a square's
   * fill is its share of the month's biggest day. Recomputed per month rather
   * than across both, because a calendar is read one month at a time and a
   * quiet month beside a loud one would render as a blank sheet.
   */
  const peak = useMemo(() => {
    let max = 0;
    for (const [k, d] of Object.entries(metric?.days ?? {})) if (k.startsWith(month)) max = Math.max(max, Math.abs(d.value));
    return max;
  }, [metric, month]);

  if (metrics.length === 0) {
    return (
      <EmptyState
        className="mt-8"
        icon={<CalendarDays />}
        title="No published metrics yet"
        description="The calendar breaks a published metric down day by day. Build a flow, publish it, and it appears in the picker here."
        action={
          <Link href="/dashboard/flows" className="text-base font-medium text-primary hover:underline">
            Go to flows
          </Link>
        }
      />
    );
  }

  const hasDays = metric != null && Object.keys(metric.days).length > 0;

  return (
    <>
      {/* The control bar, in the island every other board in the product puts
          its filters in: what you are looking at on the left, which month on
          the right. */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-surface border border-border bg-card p-2 shadow-card">
        <div className="flex min-w-0 items-center gap-2">
          {/* The builder's own combobox, not a native select: this is the same
              act as picking a field inside a step, and it searches once a
              workspace has twenty metrics. */}
          <Select
            value={metric?.id ?? ""}
            width={320}
            searchable={metrics.length > 8}
            placeholder="Choose a metric…"
            options={metrics.map((m) => ({ value: m.id, label: m.name, hint: m.flowName }))}
            onChange={setMetricId}
          />
          {metric?.status === "error" && <StatusPill tone="danger">Error</StatusPill>}
          {metric?.status === "stale" && <StatusPill tone="warn">Refreshing soon</StatusPill>}
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMonthIdx((i) => Math.max(0, i - 1))}
            disabled={monthIdx === 0}
            title={monthIdx === 0 ? "The calendar keeps two months" : `Go to ${monthLabel(months[monthIdx - 1])}`}
            aria-label="Previous month"
          >
            <ChevronLeft />
          </Button>
          {/* Fixed width so stepping between months does not shuffle the
              buttons either side of the label — sized for the longest month
              name there is ("September 2026"), not for the one on screen. */}
          <span className="w-40 whitespace-nowrap text-center text-lead font-semibold text-foreground">{monthLabel(month)}</span>
          {/* THE ONE FACT THE DELETED LEDE WAS CARRYING.
              Every value on this sheet is filed under a UTC day, so a viewer
              east of Greenwich reading these as local days is off by one for
              part of every evening — the difference between "Tuesday was our
              best day" and a number they cannot reproduce. Three letters on
              the control that changes days says it where it applies, instead
              of a sentence at the top of the page that says it once. */}
          <span
            title="Days are UTC — the same days your metrics are counted in"
            className="rounded-control bg-muted px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-muted-foreground"
          >
            UTC
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMonthIdx((i) => Math.min(months.length - 1, i + 1))}
            disabled={monthIdx === months.length - 1}
            title={monthIdx === months.length - 1 ? "This is the current month" : `Go to ${monthLabel(months[monthIdx + 1])}`}
            aria-label="Next month"
          >
            <ChevronRight />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="ml-1"
            onClick={() => setMonthIdx(months.length - 1)}
            disabled={monthIdx === months.length - 1}
          >
            This month
          </Button>
        </div>
      </div>

      {/* The month, in one line — and the as-of, because a calendar of stored
          numbers has to say when they were last true, exactly as a tile does. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-tiny text-muted-foreground">
        {stats ? (
          <>
            {/* Label first, then the number. Reversed ("24 best day · Aug 10")
                the two facts on either side of the figure ran together and the
                middot read as part of the value. */}
            <span>
              Best day{" "}
              <span className="tnum font-semibold text-foreground">{formatMetricValue(stats.best.value, metric.format)}</span>{" "}
              on {monthDayLabel(stats.best.key)}
            </span>
            <span>
              Average day <span className="tnum font-semibold text-foreground">{formatMetricValue(stats.average, metric.format)}</span>
            </span>
            <span>
              <span className="tnum font-semibold text-foreground">{stats.days}</span> day{stats.days === 1 ? "" : "s"} with data
            </span>
          </>
        ) : (
          <span>No days in {monthLabel(month)} carry a value for this metric.</span>
        )}
        {metric?.computedAt && <span className="ms-auto">Numbers as of {relativeTime(new Date(metric.computedAt))}</span>}
      </div>

      {metric?.status === "error" && metric.error && (
        <p className="mt-3 rounded-card border border-danger-soft bg-danger-soft/50 p-3 text-base text-danger-ink">
          {metric.error}{" "}
          <Link href={`/dashboard/flows/${metric.flowId}`} className="underline">
            Fix in the editor
          </Link>
        </p>
      )}

      {/* A METRIC PUBLISHED BEFORE THIS VIEW EXISTED HAS NO DAYS YET, and the
          honest answer is the reason plus the button that fixes it — not an
          empty grid implying the workspace has no data. Its next scheduled
          recompute fills it in by itself; this is for the person who wants it
          now. */}
      {!hasDays && metric && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-card border border-warn-soft bg-warn-soft/50 p-3 text-base text-warn-ink">
          <p>This metric hasn&rsquo;t been broken down by day yet — it recomputes on its own within the day.</p>
          <form action={refreshFlowAction}>
            <input type="hidden" name="flowId" value={metric.flowId} />
            <SubmitButton variant="secondary" size="sm" pendingLabel="Computing…">
              Compute now
            </SubmitButton>
          </form>
        </div>
      )}

      {/* THE GRID SCROLLS RATHER THAN CRUSHING ITS SQUARES. Seven columns of a
          readable width need ~640px; below that the sheet scrolls sideways
          inside its own card instead of squeezing a number into 40px. Above it
          the sheet simply stops growing with the page's own cap, so a month
          looks the same on every screen. */}
      <Card variant="surface" padding="none" className="mt-4 overflow-hidden">
        <div className="overflow-x-auto p-3 sm:p-4">
          <div className="min-w-[640px]">
            <div className="grid grid-cols-7 gap-2 pb-2">
              {WEEKDAYS.map((d) => (
                <div key={d} className="text-center text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {weeks.flat().map((day, i) =>
                day == null ? (
                  // Not a square at all — the blanks that put the 1st under the
                  // weekday it actually fell on.
                  <div key={`blank-${i}`} className={cn(DAY_CELL_H, "rounded-card")} aria-hidden />
                ) : (
                  <DayCell
                    key={day.key}
                    date={day.date}
                    entry={metric?.days[day.key]}
                    peak={peak}
                    today={day.key === todayKey}
                    future={day.key > todayKey}
                    format={metric?.format ?? {}}
                  />
                ),
              )}
            </div>
          </div>
        </div>
      </Card>
    </>
  );
}

/** "May 18" — the best day's date, said short beside its number. */
function monthDayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * ONE DAY.
 *
 * THE FILL IS MAGNITUDE, NOT JUDGEMENT. The reference this view is modelled on
 * paints a day green or red by whether the trader made money, and that reading
 * cannot be borrowed: up is good for Booked Leads and bad for Speed to Lead,
 * and nothing stored on a tile says which — the same reason `Delta` refuses to
 * colour itself on the dashboard. So the fill is a heat ramp in the product's
 * one accent, keyed to the day's share of the month's largest day: it says
 * "this is a big day for this metric" and stops there. A NEGATIVE value is the
 * one exception, and it is a fact rather than an opinion — it takes the danger
 * tint, because a number below zero is a different kind of day whatever the
 * metric means.
 *
 * The ramp tops out at 22% of the accent so the numeral above it stays the
 * loud thing (16.4:1 at every step of the ramp, against 4.5 required). A
 * saturated tile with white figures would look closer to the reference and
 * would put the presence in the furniture instead of in the number.
 */
function DayCell({
  date,
  entry,
  peak,
  today,
  future,
  format,
}: {
  date: number;
  entry?: { value: number; records?: number };
  peak: number;
  today: boolean;
  future: boolean;
  format: CalendarMetric["format"];
}) {
  const value = entry?.value;
  const has = value != null;
  // A zero is a real answer and gets no fill: "none happened" should not look
  // like a faint version of "some happened".
  const share = has && peak > 0 ? Math.min(1, Math.abs(value) / peak) : 0;
  const negative = has && value < 0;
  /**
   * 8% at the bottom of the ramp and 38% at the top. The first pass ran 4–22
   * and rendered as a sheet of near-white squares: a heat map whose weakest
   * days are indistinguishable from its empty ones is a table with extra
   * steps. 38% of ultramarine over white still leaves the numeral at better
   * than 9:1, so the ramp can be read as a shape from across the room without
   * the figures paying for it.
   */
  const tint = share > 0 ? `color-mix(in srgb, var(${negative ? "--color-danger" : "--color-brand-600"}) ${(8 + share * 30).toFixed(1)}%, white)` : undefined;

  return (
    <div
      className={cn(
        DAY_CELL_H,
        "flex flex-col rounded-card border p-2 transition-colors duration-(--duration-fast)",
        today ? "border-primary" : "border-border",
        // A day still to come is drawn quieter — it can carry a real number
        // (a meeting already booked for Friday), but it is not a result yet.
        future && !has && "border-dashed",
        // A DAY WITH NOTHING IN IT IS RECESSED, NOT WHITE. Inside a white card
        // an empty white square is the same material as the sheet it sits on,
        // so a month with a few good days read as a wall of boxes with numbers
        // scattered over it. Sinking the empties half a step makes the days
        // that HAVE something the figure and the rest the ground.
        !tint && (has ? "bg-card" : "bg-muted/50"),
      )}
      style={tint ? { backgroundColor: tint } : undefined}
    >
      <span className={cn("text-right text-micro font-semibold tnum", today ? "text-primary" : "text-muted-foreground")}>{date}</span>
      {has ? (
        <span className="mt-auto">
          {/* The metric's own formatter, so a day reads exactly like the tile
              it came from — "4h 44m", "57.1%", "$1,240", never a raw float. */}
          <span className={cn("stat-numeral block truncate text-title leading-tight", negative ? "text-danger-ink" : "text-foreground")} title={formatMetricValue(value, format)}>
            {formatMetricValue(value, format)}
          </span>
          {entry?.records != null && (
            <span className="block text-micro text-muted-foreground">
              {entry.records.toLocaleString("en-US")} record{entry.records === 1 ? "" : "s"}
            </span>
          )}
        </span>
      ) : (
        // Deliberately blank rather than "0": a day the metric could not be
        // computed for and a day that genuinely counted zero are different
        // facts, and the zero is the one that gets a numeral.
        <span className="sr-only">No value</span>
      )}
    </div>
  );
}
