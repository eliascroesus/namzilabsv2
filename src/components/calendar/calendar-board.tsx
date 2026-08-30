"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
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
 * THE HEAT RAMP, WRITTEN ONCE — because two things draw it.
 *
 * The squares are one; the legend under the sheet is the other, and a legend
 * mixed from its own numbers is a picture of a scale that nothing on screen
 * actually uses. Both call this.
 *
 * WHAT IT MIXES INTO. `white`, until now — which is right for exactly one of
 * the two themes. Under `.dark` a violet-over-white square is a lit box inside
 * a near-black card, and the ramp's own top step was the brightest thing on
 * the page. `var(--card)` is the surface the square is actually cut out of, so
 * the ramp is the same GESTURE at both exposures instead of one theme's colour
 * pasted into the other.
 *
 * THE FLOOR AND THE RISE. 12% at the bottom, 56% at the top. It ran 8–38 and
 * before that 4–22, each pass finding the same thing: a heat map whose loudest
 * day is a pale wash is a table with extra steps. 56% of the sheet's violet
 * still carries the numeral at 7.5:1 and the records line at better than 5:1,
 * which is the constraint that decides the ceiling — the number stays the loud
 * thing, the fill stays the shape you read from across the room.
 */
const HEAT_FLOOR = 12;
const HEAT_RISE = 44;
function heatFill(share: number, negative = false): string {
  // The sheet's VIBRANT VIOLET — the fill colour of the brand, and fills are
  // the one job it has. The 700 next to it is for text, and never appears here.
  const hue = negative ? "--color-accent-orange" : "--color-brand-500";
  return `color-mix(in srgb, var(${hue}) ${(HEAT_FLOOR + share * HEAT_RISE).toFixed(1)}%, var(--card))`;
}

/** Five stops across the ramp, for the legend. Not evenly spaced: the eye
 *  separates the pale end better than the deep end, so the low stops are
 *  spread and the top two sit close together. */
const HEAT_STOPS = [0.05, 0.3, 0.55, 0.8, 1] as const;

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
 *
 * WHERE THE COLOUR GOES, now that there is some. The sheet's ratio is black for
 * the work, violet for selection and identity, yellow once. Here that reads:
 * the ramp and today's date chip are violet, the month's best day carries the
 * single yellow mark, and the accent set appears exactly once more — orange, on
 * the chip beside the picker.
 *
 * THAT ORANGE USED TO BE AN ECHO OF THE RAIL, back when the calendar was its own
 * destination and the rail filled its row orange when you were on it. There is
 * no such row any more — the calendar is a VIEW now — so the chip keeps the
 * colour for a different and better reason: orange is this view KIND's identity
 * tint, the same one the template picker's Calendar card wears. A reader who
 * chose the orange card lands on a board with the orange chip.
 */
export function CalendarBoard({
  metrics,
  months,
  todayKey,
  selectedId,
  onPick,
}: {
  metrics: CalendarMetric[];
  /** Oldest first; the last is the current month. */
  months: MonthKey[];
  /** "2026-05-24" — the server's UTC today. */
  todayKey: string;
  /**
   * WHICH METRIC THIS VIEW IS FOR, as stored — `${flowId}:${outputNodeId}`.
   *
   * A calendar VIEW remembers its metric; the standalone page did not have one
   * to remember, so it opened on whichever metric sorted first. Undefined keeps
   * exactly that old behaviour, which is what `/design` renders.
   *
   * A stored id that is not in `metrics` is NOT an error to swallow: the metric
   * was deleted, unpublished, or is hidden from this viewer by rank. See the
   * `missing` branch below — it says so and offers the picker rather than
   * silently sliding to a different metric's numbers under the view's name.
   */
  selectedId?: string | null;
  /**
   * PERSIST THE CHOICE — a SERVER ACTION, not a callback.
   *
   * A server action reference survives the RSC boundary; an ordinary function
   * does not, and passing one from a server component fails the build. That is
   * the whole reason this is shaped as `(fd: FormData) => Promise<void>` rather
   * than `(id: string) => void`, and it is what lets `/design` render this
   * component directly by simply omitting the prop — the trap `EmptyCanvas` fell
   * into, which needed a whole `-preview` wrapper because it takes an `onStart`.
   *
   * Already bound to the view id on the server, so the form carries only the
   * metric.
   *
   * IT RETURNS ITS RESULT AND THIS COMPONENT READS IT. A fire-and-forget write
   * would make a refusal — a rank block, a lost connection — look exactly like
   * success: the dropdown moves, the sheet redraws from data already in the
   * payload, and the old metric comes back on the next load with nothing having
   * said so. That is the worst failure available here, because it only surfaces
   * later and on a different screen.
   */
  onPick?: (fd: FormData) => Promise<{ ok: boolean; error?: string }>;
}) {
  /**
   * The stored choice SEEDS the picker; it does not own it. The switch has to
   * feel instant — the day map for every metric is already in this payload, so
   * there is genuinely nothing to wait for — while the write goes out behind it.
   * Seeded once on purpose: re-syncing from the prop would make the poller's
   * refresh yank a metric out from under somebody mid-read.
   */
  const [metricId, setMetricId] = useState(selectedId ?? metrics[0]?.id ?? "");
  const [monthIdx, setMonthIdx] = useState(months.length - 1);
  const [, startTransition] = useTransition();

  /**
   * A VIEW POINTING AT A METRIC THAT IS NOT HERE — the case a placement is
   * explicitly allowed to reach. `store.ts` keeps placements when a tile goes
   * away, because that is what makes republishing a flow restore its board.
   * So "the id is set but nothing matches" is an ordinary state, and the honest
   * answer is to name it rather than fall through to `metrics[0]`.
   */
  const missing = metricId !== "" && !metrics.some((m) => m.id === metricId);
  const metric = metrics.find((m) => m.id === metricId);
  const month = months[monthIdx] ?? months[months.length - 1];
  const weeks = useMemo(() => monthGrid(month), [month]);

  /**
   * Instant locally, durable behind it — and NOISY IF THE DURABLE PART FAILS.
   * See `onPick`: a switch that only looks like it worked is worse than one
   * that refuses out loud.
   */
  const [saveError, setSaveError] = useState<string | null>(null);
  const pick = (id: string) => {
    setMetricId(id);
    if (!onPick) return;
    setSaveError(null);
    const fd = new FormData();
    fd.set("tileKey", `flow:${id}`);
    startTransition(async () => {
      try {
        const r = await onPick(fd);
        if (!r.ok) setSaveError(r.error ?? "That didn't save.");
      } catch {
        // A dropped connection is the common case and reads the same to the
        // reader: what they picked is not what will be here next time.
        setSaveError("That didn't save — check your connection and try again.");
      }
    });
  };

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
   *
   * `negative` rides along from the same pass: the legend only names the second
   * series when the month actually contains one, and a swatch explaining a
   * colour that appears nowhere on the sheet is noise.
   */
  const scale = useMemo(() => {
    let peak = 0;
    let negative = false;
    for (const [k, d] of Object.entries(metric?.days ?? {})) {
      if (!k.startsWith(month)) continue;
      peak = Math.max(peak, Math.abs(d.value));
      if (d.value < 0) negative = true;
    }
    return { peak, negative };
  }, [metric, month]);

  if (metrics.length === 0) {
    return (
      <EmptyState
        className="mt-8"
        icon={<CalendarDays />}
        title="No published metrics yet"
        description="The calendar breaks a published metric down day by day. Build a flow, publish it, and it appears in the picker here."
        action={
          // THE SHEET'S HERO, spent on the one act this screen exists for.
          // Yellow is scarce by rule — at most once per screen — and a screen
          // with nothing on it but a single instruction is exactly the case
          // the rule was written for. It also retires a link set in
          // `text-primary`: the violet 500 is a FILL colour at 4.42:1 on the
          // off-white page, under AA as text, and the kit's link step (the
          // 700) is what a violet word is supposed to be set in.
          <Button asChild variant="yellow">
            <Link href="/dashboard/flows">Go to flows</Link>
          </Button>
        }
      />
    );
  }

  const hasDays = metric != null && Object.keys(metric.days).length > 0;
  /** The six presentation keys, or none — so a day reads like its tile either way. */
  const fmt = metric?.format ?? {};

  /**
   * THE METRIC THIS VIEW NAMES IS NOT HERE — deleted, unpublished, or hidden
   * from this viewer by rank. The bar still renders below, so the picker is
   * right there to choose another; what must NOT happen is quietly drawing a
   * different metric's days under this view's name, which is the version of
   * this bug that ships numbers to the wrong label.
   *
   * Rank is deliberately not distinguished from deletion in the wording. A
   * member who cannot see a metric must not learn from an error message that it
   * exists — the same reason the board drops hidden tiles at the source rather
   * than rendering a placeholder where one used to be.
   */
  const gone = missing ? (
    <EmptyState
      className="mt-6"
      icon={<CalendarDays />}
      title="This metric is no longer available"
      description="It may have been deleted, unpublished, or it is not shared with you. Pick another metric above and this view will remember it."
    />
  ) : null;

  return (
    <>
      {/* The control bar, in the island every other board in the product puts
          its filters in: what you are looking at on the left, which month on
          the right. The SHELL is deliberately the same string the activity and
          flows bars use — one bar spelled three ways is the drift the kit page
          exists to stop — and the character is inside it. */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-surface border border-border bg-card p-2 shadow-card">
        <div className="flex min-w-0 items-center gap-2">
          {/* THE VIEW KIND'S CHIP. It began as an echo of the rail — that row
              filled orange when you were on the Calendar page — and the page is
              gone. The chip stays because the colour now carries the kind:
              orange is what the template picker's Calendar card wears, so the
              board you land on is the card you pressed. Decorative; the Select
              beside it is what actually says what you are looking at. */}
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-control bg-accent-orange text-white"
          >
            <CalendarDays className="size-4" />
          </span>
          {/* The builder's own combobox, not a native select: this is the same
              act as picking a field inside a step, and it searches once a
              workspace has twenty metrics. */}
          <Select
            /* `metricId`, NOT `metric?.id` — they differ in exactly the case
               that matters. When the stored metric is gone `metric` is
               undefined, and reading the id off it would blank the control, so
               the bar would say nothing is selected while the sheet below says
               something is missing. The raw id keeps the two telling the same
               story. */
            value={missing ? "" : metricId}
            width={320}
            searchable={metrics.length > 8}
            placeholder="Choose a metric…"
            options={metrics.map((m) => ({ value: m.id, label: m.name, hint: m.flowName }))}
            onChange={pick}
          />
          {metric?.status === "error" && <StatusPill tone="danger">Error</StatusPill>}
          {metric?.status === "stale" && <StatusPill tone="warn">Refreshing soon</StatusPill>}
        </div>

        <div className="flex items-center gap-1.5">
          {/* THE STEPPER IS ONE OBJECT, NOT THREE CONTROLS IN A ROW. Two arrows
              and a label sitting loose on the bar read as three unrelated
              things; sunk into their own track they read as a single control
              that moves the month, which is what they are.
              `bg-background` for the track and `bg-card` on hover, rather than
              muted: `--muted` and `--card` are the SAME value under `.dark`, so
              a muted well inside a card is invisible in one of the two themes.
              The page colour is a step below the card in both. */}
          <div className="flex items-center gap-0.5 rounded-full border border-border bg-background p-0.5">
            <Button
              variant="ghost"
              size="iconSm"
              className="hover:bg-card"
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
            <span className="w-40 whitespace-nowrap text-center text-md font-semibold text-foreground">{monthLabel(month)}</span>
            <Button
              variant="ghost"
              size="iconSm"
              className="hover:bg-card"
              onClick={() => setMonthIdx((i) => Math.min(months.length - 1, i + 1))}
              disabled={monthIdx === months.length - 1}
              title={monthIdx === months.length - 1 ? "This is the current month" : `Go to ${monthLabel(months[monthIdx + 1])}`}
              aria-label="Next month"
            >
              <ChevronRight />
            </Button>
          </div>
          {/* THE ONE FACT THE DELETED LEDE WAS CARRYING.
              Every value on this sheet is filed under a UTC day, so a viewer
              east of Greenwich reading these as local days is off by one for
              part of every evening — the difference between "Tuesday was our
              best day" and a number they cannot reproduce. Three letters on
              the control that changes days says it where it applies, instead
              of a sentence at the top of the page that says it once.
              A PILL, because the sheet's chips are pills — and it stays
              neutral: a footnote that takes a colour from the accent set would
              be the third hue in a bar that already has two. */}
          <span
            title="Days are UTC — the same days your metrics are counted in"
            className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            UTC
          </span>
          {/* The branded act in this bar — "put me back on the month that is
              still moving" — so it takes the sheet's violet wash rather than
              another bordered grey. Black is reserved here for the banner's
              Compute now, which is the only thing on the page that changes
              data. */}
          <Button
            variant="soft"
            size="sm"
            onClick={() => setMonthIdx(months.length - 1)}
            disabled={monthIdx === months.length - 1}
          >
            This month
          </Button>
        </div>
      </div>

      {/* The month, in one line — and the as-of, because a calendar of stored
          numbers has to say when they were last true, exactly as a tile does.
          Each fact is now a chip on the same material as the bar above it: as a
          run-on sentence with three bold numbers in it, the eye had to parse
          prose to find the figure, and the middot between the facts kept
          reading as part of the value. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {stats ? (
          <>
            <StatChip label="Best day">
              <span className="tnum font-semibold text-foreground">{formatMetricValue(stats.best.value, fmt)}</span>
              <span className="text-muted-foreground"> on {monthDayLabel(stats.best.key)}</span>
            </StatChip>
            <StatChip label="Average day">
              <span className="tnum font-semibold text-foreground">{formatMetricValue(stats.average, fmt)}</span>
            </StatChip>
            <StatChip label="Days with data">
              <span className="tnum font-semibold text-foreground">{stats.days}</span>
            </StatChip>
          </>
        ) : missing ? null : (
          // Not said when the metric itself is gone: "no days carry a value for
          // this metric" describes a metric that exists and is quiet, which is a
          // different fact from the one the banner below is reporting.
          <span className="text-xs text-muted-foreground">No days in {monthLabel(month)} carry a value for this metric.</span>
        )}
        {metric?.computedAt && (
          <span className="ms-auto text-xs text-muted-foreground">Numbers as of {relativeTime(new Date(metric.computedAt))}</span>
        )}
      </div>

      {metric?.status === "error" && metric.error && (
        <p className="mt-3 rounded-card border border-danger-soft bg-danger-soft/50 p-3 text-md text-danger-ink">
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
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-card border border-warn-soft bg-warn-soft/50 p-3 text-md text-warn-ink">
          <p>This metric hasn&rsquo;t been broken down by day yet — it recomputes on its own within the day.</p>
          <form action={refreshFlowAction}>
            <input type="hidden" name="flowId" value={metric.flowId} />
            {/* BLACK, WHICH IS WHAT THE SHEET SAYS DOES THE WORK. It was a
                bordered secondary — a grey outline on a pale wash, the least
                decisive control on the page attached to the only sentence
                asking to be acted on. Not the yellow: this banner and the
                month's yellow best-day mark cannot appear together (no days at
                all means no best day), but a hero fill inside a state banner
                reads as a second state rather than as an act. */}
            <SubmitButton size="sm" pendingLabel="Computing…">
              Compute now
            </SubmitButton>
          </form>
        </div>
      )}

      {/* THE CHOICE DID NOT STICK. Local state has already moved, so without
          this the reader has no way of knowing the view will open on the old
          metric next time. */}
      {saveError && (
        <p className="mt-3 rounded-card border border-danger-soft bg-danger-soft/50 p-3 text-md text-danger-ink">
          {saveError}
        </p>
      )}

      {/* THE VIEW'S METRIC IS GONE — said instead of the sheet, never under it.
          Thirty empty squares with a working month stepper above them is a
          calendar claiming this metric had a quiet month; the truth is that
          there is no metric to have had one. */}
      {gone}

      {/* THE GRID SCROLLS RATHER THAN CRUSHING ITS SQUARES. Seven columns of a
          readable width need ~640px; below that the sheet scrolls sideways
          inside its own card instead of squeezing a number into 40px. Above it
          the sheet simply stops growing with the page's own cap, so a month
          looks the same on every screen. */}
      {!missing && (
      <Card variant="surface" padding="none" className="mt-4 overflow-hidden">
        <div className="overflow-x-auto p-3 sm:p-4">
          <div className="min-w-[640px]">
            <div className="grid grid-cols-7 gap-2 pb-2">
              {WEEKDAYS.map((d) => (
                <div key={d} className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
                    peak={scale.peak}
                    today={day.key === todayKey}
                    future={day.key > todayKey}
                    // Exactly one square can carry it, because it is asserted
                    // from the summary's own answer rather than recomputed per
                    // cell — a `value === peak` test would flag every day of a
                    // tie, and the yellow's whole meaning is that there is one.
                    // A month of zeros has a "best" day and no scale at all, so
                    // the peak gate keeps the mark off it.
                    best={scale.peak > 0 && day.key === stats?.best.key}
                    format={metric?.format ?? {}}
                  />
                ),
              )}
            </div>
          </div>
        </div>

        {/* THE SHEET'S FOOTER — what the colour means, at the bottom of the
            thing it is colouring. A heat grid with no key asks the reader to
            infer a scale from the picture, and everyone infers a different one.
            Outside the horizontal scroller on purpose: on a narrow screen the
            grid slides under the finger and the key must not slide away with
            it. */}
        {scale.peak > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-4">
            <span>Shaded by share of the month&rsquo;s best day</span>
            <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {scale.negative && (
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="size-3 rounded-xs" style={{ background: heatFill(0.8, true) }} />
                  Below zero
                </span>
              )}
              <span className="flex items-center gap-1.5">
                Less
                <span aria-hidden className="flex gap-1">
                  {HEAT_STOPS.map((s) => (
                    <span key={s} className="size-3 rounded-xs border border-border" style={{ background: heatFill(s) }} />
                  ))}
                </span>
                More
              </span>
            </span>
          </div>
        )}
      </Card>
      )}
    </>
  );
}

/** "May 18" — the best day's date, said short beside its number. */
function monthDayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * ONE FACT FROM THE MONTH, WORN AS A CHIP.
 *
 * The kit's micro-label voice — ALL CAPS, tracking-wide — for what it is, then
 * the figure in the app's own ink. Deliberately NOT a `StatusPill`: every tone
 * it has either means a state (which would judge a month's average, the one
 * thing this whole view refuses to do) or names a kind, and these three chips
 * are all the same kind. So it is the bar's own material instead — a white
 * chip with a hairline, matching the island above it.
 */
function StatChip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs shadow-xs">
      <span className="font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span>{children}</span>
    </span>
  );
}

/**
 * ONE DAY.
 *
 * THE FILL IS MAGNITUDE, NOT JUDGEMENT. The reference this view is modelled on
 * paints a day green or red by whether the trader made money, and that reading
 * cannot be borrowed: up is good for Booked Leads and bad for Speed to Lead,
 * and nothing stored on a tile says which — the same reason `Delta` refuses to
 * colour itself on the dashboard. So the fill is a heat ramp in the sheet's
 * violet, keyed to the day's share of the month's largest day: it says "this is
 * a big day for this metric" and stops there.
 *
 * A NEGATIVE DAY IS THE SECOND SERIES, AND IT IS NOW ORANGE RATHER THAN RED.
 * Below zero is a different KIND of day whatever the metric means — a fact, and
 * facts about kind are what the accent set is for. Painting it in `danger` gave
 * it the one vocabulary this component spends four paragraphs refusing: red is
 * how the sheet says a metric FAILED, and it is already spoken for on this page
 * by the error pill and the error banner. A month with one red square meant two
 * different things depending on which red you were looking at.
 *
 * FIGURE AND GROUND, drawn as two materials rather than two greys. A day with
 * something in it is a card — its own hairline and the lightest rung of the
 * shadow ladder — and an empty day is a WELL sunk into the sheet with no border
 * at all. Empty squares used to be boxes too, half a step darker, so a month
 * read as thirty-five boxes with numbers scattered over some of them.
 */
function DayCell({
  date,
  entry,
  peak,
  today,
  future,
  best,
  format,
}: {
  date: number;
  entry?: { value: number; records?: number };
  peak: number;
  today: boolean;
  future: boolean;
  /** The month's best day — the one square allowed to carry the yellow. */
  best: boolean;
  format: CalendarMetric["format"];
}) {
  const value = entry?.value;
  const has = value != null;
  // A zero is a real answer and gets no fill: "none happened" should not look
  // like a faint version of "some happened".
  const share = has && peak > 0 ? Math.min(1, Math.abs(value) / peak) : 0;
  const negative = has && value < 0;
  const tint = share > 0 ? heatFill(share, negative) : undefined;

  return (
    <div
      className={cn(
        DAY_CELL_H,
        "flex flex-col rounded-card border p-2 transition-colors duration-(--duration-fast)",
        has ? "border-border shadow-xs" : "border-transparent",
        // A day still to come is drawn quieter — it can carry a real number
        // (a meeting already booked for Friday), but it is not a result yet.
        future && !has && "border-dashed border-border",
        // Today is violet because violet marks SELECTION and identity, and
        // "the day you are in" is the only selection a calendar has.
        today && "border-primary",
        // The empty day's well takes the PAGE colour rather than `muted`: the
        // two are identical in the light theme and `muted` collapses into the
        // card in the dark one, so the recession only survived one theme.
        !tint && (has ? "bg-card" : "bg-background"),
      )}
      style={tint ? { backgroundColor: tint } : undefined}
    >
      <div className="flex items-center gap-1">
        {/* THE SHEET'S ONE YELLOW, ON THE SQUARE IT IS ABOUT. The summary strip
            already names the best day and its number; this is where that
            sentence points. Full-strength neon is the only one to the right of
            the rail, and there can be at most one per month by construction —
            which is the whole argument for the colour: scarcity is its meaning.
            Black ink, because the sheet sets this yellow in black every time it
            appears and nothing else is readable on it. */}
        {best && (
          // NOT THE NEON. `yellow` is one of the kit's decorative tones and it
          // cannot be misread as a state — but it is also the HERO colour, and
          // the hero is at most one per screen, spent on the act the screen
          // exists for. A month grid put it on a calendar square: the loudest
          // colour in the product, on a day that is merely the highest of
          // eleven. Ink on the page's own surface says the same thing without
          // shouting it. Only the padding is overridden: a 92px square has no
          // room for the standard px-3.
          <StatusPill className="bg-foreground px-1.5 py-px text-background">
            Best
          </StatusPill>
        )}
        {/* TODAY'S DATE IS A FILLED CHIP, not violet text. The 500 is a fill
            colour — as 12px text on white it measures 4.42:1, under AA — and
            the same value carrying white the other way round measures 4.81:1.
            The stronger mark is also the more accessible one, which is usually
            how it goes when a colour is used for the job it was picked for. */}
        <span
          className={cn(
            "tnum ms-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-semibold",
            today ? "bg-primary text-primary-foreground" : has ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {date}
        </span>
      </div>
      {has ? (
        <span className="mt-auto">
          {/* The metric's own formatter, so a day reads exactly like the tile
              it came from — "4h 44m", "57.1%", "$1,240", never a raw float.
              One ink for every value: the minus sign says a number is negative
              and the orange wash says it in colour, so a third statement in red
              text would only be the judgement this cell does not make. */}
          <span className="stat-numeral block truncate text-lg leading-tight text-foreground" title={formatMetricValue(value, format)}>
            {formatMetricValue(value, format)}
          </span>
          {entry?.records != null && (
            // The kit's micro voice, and set in the page ink at 80% rather than
            // in `muted-foreground`: the muted grey is solved against white and
            // falls to about 2.4:1 at the top of the ramp, where this line
            // spends most of its life.
            <span className="block truncate text-xs font-semibold uppercase tracking-wide text-foreground/80">
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
