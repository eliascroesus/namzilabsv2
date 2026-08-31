"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
import { PERIOD_PILL, PERIOD_TRACK } from "@/components/ui/page";
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
 * day is a pale wash is a table with extra steps. The ceiling was decided by
 * ink: 56% of the violet still carried the numeral at 7.5:1, and going deeper
 * would have cost the figure that the square exists to show.
 *
 * THE NUMBERS MOVED WITH THE HUE AND THE RANGE DID NOT, deliberately. On the
 * brand's yellow the same 56% carries that numeral at 13.47:1, so the old
 * constraint is no longer the binding one and the ramp could run deeper than
 * it does. It is left where it is because the range was tuned against the EYE
 * as well as the ratio — 12–56 is where the five legend stops separate — and
 * re-cutting a working ramp on the grounds that a new hue would permit it is
 * how a settled thing gets unsettled for nothing. The headroom is recorded
 * here rather than spent.
 */
const HEAT_FLOOR = 12;
const HEAT_RISE = 44;
function heatFill(share: number, negative = false): string {
  // THE BRAND, BECAUSE THIS SQUARE CARRIES INK.
  //
  // The split's full form is that yellow fills WHERE SOMETHING SITS ON IT — the
  // 11.24:1 it holds against near-black is the entire licence for it to be a
  // surface, and a fill with nothing written on it never collects that number.
  // A heat cell is the clearest case of the other kind: it is a tint with a
  // date chip, a figure and a records line printed on top, so it collects the
  // ratio in full. That is why this ramp is the brand while the chart bars two
  // files away are not — those carry nothing and have only their edge against
  // the card, where the yellow is 1.42:1.
  //
  // IT READS BETTER THAN THE VIOLET IT REPLACES, which is not the usual
  // direction for this kind of change. At the top of the ramp the figure sits
  // at 13.47:1 against the old violet's 7.5:1, and the records line — already
  // spelled `foreground/80` precisely because `muted-foreground` collapsed on
  // the deep end — comes up to 7.8:1. The ceiling was set by ink contrast, and
  // a paler hue simply has more room under it.
  //
  // NEGATIVE STAYS ORANGE. Two warm hues are closer than violet-and-orange
  // were, but they part company exactly where it matters: at the deep end,
  // where a day that lost ground actually needs to be told from one that
  // gained it, 56% orange is a flushed pink and 56% yellow is a flat gold.
  const hue = negative ? "--color-accent-orange" : "--color-brand-600";
  return `color-mix(in srgb, var(${hue}) ${(HEAT_FLOOR + share * HEAT_RISE).toFixed(1)}%, var(--card))`;
}

/** Five stops across the ramp, for the legend. Not evenly spaced: the eye
 *  separates the pale end better than the deep end, so the low stops are
 *  spread and the top two sit close together. */
const HEAT_STOPS = [0.05, 0.3, 0.55, 0.8, 1] as const;

/**
 * RENDER INTO A SLOT THE PAGE PUT IN ITS CHROME.
 *
 * The same portal `FlowToolbar`'s `TopBarStatusPortal` uses, and for the same
 * reason: the state belongs to this client component, the position belongs to
 * the server-rendered page, and neither can hand the other what it has.
 *
 * `null` until the effect runs — the slot cannot be read during render, and
 * `useEffect` is the only hook that is allowed to touch the document. One frame
 * of an empty header slot, exactly as the builder's save chip has always had.
 */
function Slot({ id, children }: { id: string; children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => setNode(document.getElementById(id)), [id]);
  return node ? createPortal(children, node) : null;
}

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
 * WHERE THE COLOUR GOES, now that there is some. The sheet's rule is that
 * YELLOW FILLS AND VIOLET DRAWS, and this view spends both. Today's date is a
 * filled yellow chip — the same object as the rail's active row and the period
 * control's lit pill, so all three "you are here" marks in the product are
 * spelled one way. Today's square is edged in violet, because an edge is a
 * line. The heat ramp is violet too, as a wash rather than a fill: it has to be
 * something the yellow chip can sit ON without disappearing into. The best day
 * takes ink, not the brand — see `DayCell`. And the accent set appears exactly
 * once more: orange, on the chip beside the picker.
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
  hosted = false,
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
   * WHETHER THE PAGE HAS PUT SLOTS IN ITS CHROME for this board's two control
   * groups. The dashboard does; `/design` renders this component bare, so it
   * keeps the self-contained island. A PROP rather than a probe of the DOM,
   * because probing means one frame rendered in the wrong shape.
   */
  hosted?: boolean;
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
          // THE BRAND, spent on the one act this screen exists for — and it is
          // a BUTTON, which is the only shape the yellow is legible in: a
          // filled pill carrying near-black at 11.24:1. This used to be a word
          // set in `text-primary`, which is the same colour doing the one thing
          // it cannot do — 1.55:1 as text on the page, an instruction nobody
          // could read.
          //
          // `variant="accent"`, not `variant="yellow"`: that variant existed
          // because the primary was violet and the hero act needed a colour the
          // primary could not give it. Yellow IS the primary now, so the two
          // resolved to one object under two names and one of them had to go.
          <Button asChild variant="accent">
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

  /**
   * WHAT YOU ARE LOOKING AT — the metric picker, which is this view's analogue
   * of "New group" and "+ Add": the one control that changes what the board is
   * showing.
   */
  const tools = (
    <div className="flex min-w-0 items-center gap-2">
          {/* The builder's own combobox, not a native select: this is the same
              act as picking a field inside a step, and it searches once a
              workspace has twenty metrics.
              WEARING THE DASHBOARD'S CONTROL SHAPE, not the config panel's. Its
              default shell is a rounded RECTANGLE, which is right in a column of
              fields and wrong in this row: "+ Add", "All sources" and "Refresh
              all" are all 36px pills, and a rounded rectangle among them reads
              as a control from a different set. `triggerClassName` replaces the
              shape and nothing else — every caller in the builder is untouched.
              THE CHIP MOVED INSIDE IT, as `leading`, which is exactly what the
              source picker does with its `SourceMark`. Beside the control it was
              a second object on the row; inside it, it is this control's mark.
              Orange still carries the view kind — it is what the template
              picker's Calendar card wears, so the board you land on is the card
              you pressed. */}
          <Select
            triggerClassName="h-8 rounded-control border-border bg-card px-1.5 py-0 pr-3 text-xs font-medium shadow-xs"
            leading={
              <span
                aria-hidden
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-orange text-white"
              >
                <CalendarDays className="size-3.5" />
              </span>
            }
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
  );

  /**
   * WHICH MONTH — this view's analogue of the period track, and the reason it
   * goes where the period track goes. Both answer "what span am I reading"; a
   * calendar simply answers it in months because that is what the materializer
   * stores.
   */
  const period = (
    <div className="flex items-center gap-1.5">
          {/* THE SAME GROOVE THE PERIOD PILLS SIT IN — `PERIOD_TRACK`, imported
              rather than approximated. This control answers the same question
              in the same slot as the dashboard's range track, so it has to be
              the same object: it drew its own 36px well on `bg-background`
              beside a 40px one on `--period-bg`, which meant switching from a
              Columns tab to a Calendar tab moved the header row and changed the
              surface under it.
              THE STEPPER IS STILL ONE OBJECT, NOT THREE CONTROLS IN A ROW: two
              arrows and a label loose on the bar read as three unrelated things;
              sunk into the track they read as a single control that moves the
              month, which is what they are. */}
          <div className={PERIOD_TRACK}>
            <Button
              variant="ghost"
              size="iconSm"
              className="rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => setMonthIdx((i) => Math.max(0, i - 1))}
              disabled={monthIdx === 0}
              title={monthIdx === 0 ? "The calendar keeps two months" : `Go to ${monthLabel(months[monthIdx - 1])}`}
              aria-label="Previous month"
            >
              <ChevronLeft />
            </Button>
            {/* Fixed width so stepping between months does not shuffle the
                buttons either side of the label — sized for the longest month
                name there is ("September 2026"), not for the one on screen.
                `text-foreground` because this track sits on the GROUND: the
                page's own ink is white on the dark group and near-black on the
                light one, where `--foreground` would be wrong in exactly one
                theme. Same reasoning the range pills' hover already carries. */}
            <span className="w-40 whitespace-nowrap text-center text-sm font-semibold text-foreground">
              {monthLabel(month)}
            </span>
            <Button
              variant="ghost"
              size="iconSm"
              className="rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => setMonthIdx((i) => Math.min(months.length - 1, i + 1))}
              disabled={monthIdx === months.length - 1}
              title={monthIdx === months.length - 1 ? "This is the current month" : `Go to ${monthLabel(months[monthIdx + 1])}`}
              aria-label="Next month"
            >
              <ChevronRight />
            </Button>
            {/* "This month" LIVES IN THE GROOVE TOO, as a pill — it is one of
                the spans this control can select, exactly as "Today" is on the
                range track. Outside it, it was a fourth loose object on a row
                that already had three. */}
            <Button
              variant="ghost"
              onClick={() => setMonthIdx(months.length - 1)}
              disabled={monthIdx === months.length - 1}
              className={cn(PERIOD_PILL, "text-muted-foreground hover:bg-accent hover:text-foreground")}
            >
              This month
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
            className="rounded-full border border-border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            UTC
          </span>
    </div>
  );

  return (
    <>
      {/* THE CONTROLS GO INTO THE PAGE'S OWN CHROME, so a calendar tab looks
          like every other tab rather than like a page that wandered in.
          Every other view puts "what span am I reading" in the header beside the
          title (the period track) and "what changes the board" on the tab row
          (New group, + Add). This used to put both in an island of its own
          BELOW that row — a third bar the other views do not have, which is
          precisely the mismatch. Same two groups, moved to the two slots the
          rest of the product already uses for them.
          A PORTAL because the state lives here and the chrome is rendered by the
          server page — the shape `SaveChip` already uses for the builder's top
          bar. `hosted` is a prop rather than a probe so there is no frame in
          which the wrong layout renders. */}
      {hosted ? (
        <>
          <Slot id="calendar-tools">{tools}</Slot>
          <Slot id="calendar-period">{period}</Slot>
        </>
      ) : (
        /* NO CHROME TO PORTAL INTO — `/design` renders this component on its
           own, and a kit page showing a calendar with no controls would be
           documenting something that does not exist. It keeps the island. */
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-surface border border-border bg-card p-2 shadow-card">
          {tools}
          {period}
        </div>
      )}

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
                asking to be acted on. Not the yellow, and the reason survived
                the rebrand intact: a brand fill inside a warn banner is a
                second coloured object inside a coloured surface, and it reads
                as another piece of the state rather than as the way out of it.
                The empty state above spends the yellow, because there is no
                wash there for it to argue with. */}
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
                    // tie, and a mark reading "Best" on four squares is not a
                    // superlative. A month of zeros has a "best" day and no
                    // scale at all, so the peak gate keeps the mark off it.
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

      {/* THE SUMMARY READS AFTER THE SHEET, NOT BEFORE IT.
          Best day, average day, days with data and the as-of are all CONCLUSIONS
          drawn from the squares — "24 on Aug 10" means nothing until you have
          seen the month it is describing, and the as-of is a footnote about the
          numbers above it. Sitting between the controls and the grid, they were
          three figures asking to be read before the thing they summarise, and
          they pushed the calendar itself further down the page.
          The same order a table puts its total in, and the same order the tile
          cards use: the picture, then what it adds up to. */}
      {!missing && (
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
          ) : (
            <span className="text-xs text-muted-foreground">
              No days in {monthLabel(month)} carry a value for this metric.
            </span>
          )}
          {metric?.computedAt && (
            <span className="ms-auto text-xs text-muted-foreground">
              Numbers as of {relativeTime(new Date(metric.computedAt))}
            </span>
          )}
        </div>
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
  /** The month's best day — the one square allowed to carry the "Best" pill. */
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
        // Today's edge is violet because an EDGE IS A LINE, and the split hands
        // every line to the marker: the brand measures 1.55:1 as a stroke and a
        // yellow rim round one square in thirty-five is a rim nobody finds. The
        // date chip inside it is the yellow — same square, two colours, each
        // doing the job it can actually do.
        today && "border-marker",
        // The empty day's well takes the PAGE colour rather than `muted`: the
        // two are identical in the light theme and `muted` collapses into the
        // card in the dark one, so the recession only survived one theme.
        !tint && (has ? "bg-card" : "bg-background"),
      )}
      style={tint ? { backgroundColor: tint } : undefined}
    >
      <div className="flex items-center gap-1">
        {/* THE BEST DAY IS MARKED IN INK, NOT IN THE BRAND. The summary strip
            already names it and its number; this is where that sentence points.
            It carried the kit's decorative `yellow` once, and that tone has been
            deleted — a second yellow beside the primary was two colours four
            counts apart that could never be kept in step.
            The brand does not inherit the job either, and the square itself is
            the argument: the best day CAN BE TODAY, and today's date already
            wears a filled yellow chip 20px away. Two yellow chips on one square
            say nothing. Beyond that, the brand marks an ACT — the thing on the
            screen to press — and "Best" is a reading of the data, which is what
            ink is for. Ink also survives the heat wash under it at every step of
            the ramp, where a coloured chip would not. Only the padding is
            overridden: a 92px square has no room for the standard px-3. */}
        {best && (
          <StatusPill className="bg-foreground px-1.5 py-px text-background">
            Best
          </StatusPill>
        )}
        {/* TODAY'S DATE IS A FILLED CHIP, and the reason is the same one it has
            always been — a coloured word is the weaker and less legible mark —
            but the colour changed hands. It is the BRAND now: a 20px disc
            carrying near-black at 11.24:1, which is the shape and the ratio the
            yellow exists for, and the same object the rail's active row and the
            period control's lit pill are. All three say "you are here", so all
            three are spelled one way. Coloured text at this size would be the
            one thing neither hue can do: the brand is 1.55:1 on the card and
            the marker's 500 is 4.41:1, under the 4.5:1 a 12px numeral owes. */}
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
