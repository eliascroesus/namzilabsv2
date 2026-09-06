import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMetricValue } from "@/lib/format";
import type { ImportCoverage } from "@/connectors/types";

/**
 * THE CHARTS. The dashboard's one vocabulary of marks — and the one place the
 * brand sheet's ratio is spent on DATA rather than on chrome. These were the
 * last neutral surface in the product: a grey pill, a grey gutter and a single
 * flat violet, sitting under a number set in the display face beside a rail
 * carrying four accents. The marks are what people actually look at, and they
 * were the least-decided thing on the page.
 *
 *   THE BRAND DRAWS THE SERIES. A mark here is one measure, and
 *     `--color-brand-500` (`#007BFF`) is the colour the product measures in:
 *     the sparkbars and a breakdown's first row — the goal bar stays
 *     neutral-until-met (see `TargetBar` below), which is a state, not a
 *     series.
 *   BLACK EMPHASISES. A delta that moved.
 *   THE ACCENT THREE DECORATE, and only where decoration is safe — a
 *     breakdown's rows, each of which already carries its own name in the
 *     label beside it, so no hue is ever the thing telling you whose bar it is.
 *   SUCCESS AND WARN STAY STATE. A met goal and an unfinished import MEAN
 *     something. Nothing else in this file is allowed to borrow their colour.
 *
 * BLUE IS NOT ABSENT FROM THE MARKS ANY MORE, which the rule above used to
 * defend. That defence was built for a YELLOW brand: dark ink sits on a
 * yellow FILL at 11.24:1, but a bar carries no ink of its own — only its own
 * edge against the card, at 1.55:1 on white, under the 3:1 a graphic that
 * carries meaning owes — so a yellow sparkbar was not a loud mark, it was a
 * mark nobody could see, and the brand only ever reached the marks as a low
 * wash behind them. `--color-brand-500` (`#007BFF`) does not have that
 * problem: blue clears enough contrast to BE the bar, not just its edge, so
 * as of the 4 Sep 2026 blue retheme the sparkbars and the breakdown's first
 * row are painted in it directly (see `Sparkbars` and `BREAKDOWN_ACCENTS`
 * below) — the wash behind the sparkbars, now 12% rather than 5%, is no
 * longer the only place in the dashboard's marks the brand appears.
 *
 * THE HONESTY RULES DID NOT MOVE, and the colour pass was not allowed to bend
 * them: every bar is still zero-anchored, every value a chart prints still goes
 * through `formatMetricValue` — the tooltip and the headline must say the same
 * quantity the same way — and the delta still refuses to pick a direction.
 *
 * Server-safe on purpose: no state, no hooks, so these render inside the
 * server-rendered dashboard exactly like the tiles that host them.
 */

/** The options bag `formatMetricValue` reads — a stored tile satisfies it structurally. */
export type ChartFormat = Parameters<typeof formatMetricValue>[1];

export type SeriesPoint = { bucket: string; value: number };
export type GroupRow = { label: string; value: number };

/**
 * ONE METER, THREE JOBS. The goal bar, a breakdown row and the import bar were
 * 6px, 6px and 4px — three heights for one object, which is exactly the drift a
 * kit exists to stop, and at 4px the import bar read as a hairline rather than
 * as a measure. 8px, pill-capped, clipping its own fill.
 *
 * No width: the goal bar spans its tile, a breakdown row is a flex item. Height
 * and shape are the shared part; how far it reaches is the caller's business.
 */
const TRACK = "h-2 overflow-hidden rounded-full";

/**
 * THE BREAKDOWN'S ROTATION — the sheet's own set, in one fixed order.
 *
 * THE MARKER FIRST, because it is the colour the rest of this file measures in
 * and the first row is the one most likely to be read; then the accents
 * strongest to palest, so the pink — which is the faintest of them on a white
 * card — lands on the fourth bar rather than the first.
 *
 * DECORATION, NOT ENCODING, and that distinction is the whole licence for it.
 * Every row prints its group's name in the label beside its bar, so hue is
 * never what tells you which group you are looking at. That is what makes a
 * rotation by POSITION safe here: re-sort the groups and the colours move, and
 * a colour that means nothing cannot lie when it moves. The moment anything in
 * this file encodes identity by hue, this has to become a lookup keyed by the
 * group — which is what `GROUP_ACCENT` already is, one import away.
 *
 * Four entries, cycled past the fourth. `show` defaults to 4, so the cycle is
 * a custom view's problem only, and a repeat is better there than a fifth
 * colour invented off the sheet.
 */
const BREAKDOWN_ACCENTS = ["bg-brand-500", "bg-accent-peri", "bg-accent-orange", "bg-accent-pink"];

/**
 * A bucketed series as a bare strip of bars.
 *
 * It prints NO headline: the tile above it already states the number, and the
 * two used to be different sizes for the same quantity — a chart tile's value
 * rendered a step smaller than a scalar tile's, so switching a metric to a
 * time bucket silently shrank its own number. The chart is a mark now; the
 * tile owns the reading.
 */
export function Sparkbars({
  series,
  format,
  className = "h-10",
}: {
  series: SeriesPoint[];
  format: ChartFormat;
  /**
   * OPTIONAL, AND THE DEFAULT IS THE ONLY HEIGHT THIS EVER HAD. On the groups
   * board a tile is content-height and 40px of bars is right. On a custom view
   * the CELL owns the height — someone dragged this chart to six rows — and a
   * fixed 40px mark leaves the rest of the box empty, which reads as a broken
   * tile rather than a small chart.
   */
  className?: string;
}) {
  const max = Math.max(1, ...series.map((s) => s.value));
  return (
    // A PLOT AREA WITH A FLOOR, rather than bars growing out of nothing.
    // "Zero-anchored" is a claim this mark makes on every render and had no way
    // of showing: the hairline under the strip is the axis, and the wash behind
    // it is the field the bars are measured in — which is also what stops the
    // 6%-minimum stub below reading as a rendering fault instead of as a quiet
    // bucket. The wash is 12%, so it is a tint in both themes rather than a
    // panel in one of them.
    //
    // THE TWO USED TO BE ONE COLOUR AND CANNOT BE, which is the fill/stroke
    // split drawn inside a single element. The axis is a RULE, so it takes the
    // brand at 25% — a strength that dates back to a YELLOW brand, where a 25%
    // yellow line measured about 1.1:1 on a white card: not a faint axis, no
    // axis at all. `--color-brand-500` (`#007BFF`) does not have that problem;
    // blue carries enough weight at 25% to read as a line on its own, so the
    // rule keeps its old opacity under the new colour rather than needing a
    // second one. The field is a SURFACE the marks sit on, so it takes the
    // brand too — at 12% (up from 5%, per the spec's `rgb(0 123 255 / .12)`)
    // it is a tint rather than a graphic, so it owes no ratio of its own. The
    // bars themselves are the brand at FULL strength now (see the bar's own
    // class below), so this wash is no longer the only place in the
    // dashboard's marks the brand appears.
    //
    // Square bars, still. A rounded cap is a radius measured against the bar's
    // WIDTH, and a twelve-bucket series stretched across a tile is 50px wide
    // per bar — the "subtle" cap renders as a row of domes. Flat tops read as
    // data at every bucket count, and the colour pass was not a reason to
    // relitigate a decision that was made against the geometry.
    <div
      className={cn("mt-3 flex items-end gap-1 rounded-t-sm border-b border-brand-500/25 bg-brand-500/12", className)}
      aria-hidden
    >
      {series.map((s) => (
        <div
          key={s.bucket}
          // The bar's own value, in the metric's own format. A raw number here
          // contradicts the headline above it — "4h 44m" over bars whose
          // tooltips read "284.6", the same quantity said two ways.
          title={`${s.bucket}: ${formatMetricValue(s.value, format)}`}
          className={cn(
            "min-w-0 flex-1",
            // EVERY BAR TAKES THE SERIES COLOUR, WITH NO LATEST-BUCKET
            // EMPHASIS. A comment here once described marking the bucket the
            // series ends on in black, on the argument that a strip where every
            // bar carries the same weight has no right edge, so the eye lands
            // in the middle and reads the tallest bar as the news — which on a
            // time series it almost never is. The idea never reached the class
            // list: every bar has always taken this one class, position or not.
            // The blue retheme did not revive it; the drift is recorded in the
            // spec's own Deferred list rather than fixed here, so a future pass
            // can pick it up on purpose instead of re-discovering it by reading
            // old prose that never matched the markup.
            "bg-brand-500",
          )}
          style={{ height: `${Math.max((s.value / max) * 100, 6)}%` }}
        />
      ))}
    </div>
  );
}

/**
 * "COMPARED TO WHAT" — the question every bare number on a dashboard leaves
 * open. A tile reading 44 says nothing about whether the week went well.
 *
 * DELIBERATELY NOT COLOURED GREEN OR RED. Up is good for Booked Leads and bad
 * for Speed to Lead, and nothing stored on a tile says which — so a green "up"
 * on a response-time metric would be the dashboard confidently reporting a
 * regression as a win. It states the direction and the size, and leaves the
 * judgement to the person who knows what the metric means. When tiles later
 * carry a polarity, this is the one place that has to change.
 *
 * Percentages move in POINTS, not percent-of-percent: 20% → 22% is "+2 pts",
 * because "+10%" is a different and much larger-sounding claim.
 */
export function Delta({
  current,
  previous,
  format,
  since,
}: {
  current: number;
  previous: number;
  format: ChartFormat;
  since: string;
}) {
  const isPct = format?.format === "percent";
  const diff = current - previous;
  // A ratio against zero is undefined, not infinite — say the movement in the
  // metric's own units instead of printing "+Infinity%".
  const ratio = previous === 0 ? null : (diff / Math.abs(previous)) * 100;
  const flat = isPct ? Math.abs(diff) < 0.05 : diff === 0;

  const magnitude = flat
    ? "No change"
    : isPct
      ? `${diff > 0 ? "+" : "−"}${Math.abs(diff).toFixed(1)} pts`
      : ratio == null
        ? `${diff > 0 ? "+" : "−"}${formatMetricValue(Math.abs(diff), format)}`
        : `${diff > 0 ? "+" : "−"}${Math.abs(ratio) >= 10 ? Math.round(Math.abs(ratio)) : Math.abs(ratio).toFixed(1)}%`;

  const Icon = flat ? Minus : diff > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        /**
         * A PILL, AND THE ONE THING ON A TILE THAT IS ALLOWED TO BE.
         *
         * "8px, no pills" is the shape rule for the CONTROL ladder — buttons,
         * inputs, selects, tabs, nav rows, the period groove. This is not on
         * that ladder: it is a status caption that is never pressed, and the
         * 6 Sep 2026 metric-card export draws it at a full radius. It flipped
         * to `rounded-control` in an earlier round on the reading that the
         * rule covered everything; the export settles that it does not.
         *
         * The five-file pill sweep in `console-theme.test.ts` deliberately
         * does not scan this file, so this is a decision rather than a
         * survivor it missed.
         */
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        // COLOURED BY WHETHER IT MOVED, NEVER BY WHICH WAY.
        //
        // The rule above bans a green/red pill and that was read as banning
        // colour, which left this the only grey object beside a 36px number.
        // It is not the same ban. Up and down take the IDENTICAL chip — ink,
        // the sheet's working colour, the same weight the toast and the default
        // button carry — so the pill's presence says "something happened here"
        // and the ARROW alone says which way. No polarity is invented, because
        // both directions are painted the same.
        //
        // IT IS A CAPTION, NOT A BADGE. A solid ink chip on every tile put a
        // heavy black lozenge beside every number on the board — twelve of them
        // on a full dashboard, each shouting about a secondary fact. The delta
        // qualifies the figure above it; it does not compete with it.
        //
        // So both states take the same quiet wash and the difference is the
        // INK: full-strength foreground when something moved, muted when it
        // did not. Grey still means "nothing moved" — it just no longer costs
        // the tile its composure to say so.
        flat ? "bg-muted text-muted-foreground" : "bg-muted text-foreground",
      )}
      title={`${formatMetricValue(previous, format)} ${since}`}
    >
      <Icon size={12} aria-hidden />
      {/* THE TWO-TONE IS BUILT BY RAISING THE NUMBER, never by sinking the
          label. `since` carries "vs yesterday" — the half that says what the
          comparison is against — and it has twice been dimmed into
          unreadability (2.84:1 at one point) by someone reaching for hierarchy
          with opacity. It inherits the chip's own ink; only the magnitude is
          lifted, by WEIGHT. */}
      <span className="tnum font-semibold text-foreground">{magnitude}</span>
      <span>{since}</span>
    </span>
  );
}

/** Progress toward a goal. The fill turns `success` only when the goal is met. */
export function TargetBar({ value, target, format }: { value: number; target: number; format: ChartFormat }) {
  const pct = target > 0 ? Math.min(Math.round((value / target) * 100), 100) : 0;
  const met = pct >= 100;
  return (
    <div className="mt-2.5">
      {/* THE UNMET BAR IS NEUTRAL NOW, AND THAT IS THE SUCCESS/BRAND COLLISION
          landing on the one component it actually breaks.
          This drew the in-progress meter in `--marker` and the met one in
          `--success`, which was a real distinction while the marker was violet
          and success was green. They are the same green today — `--success` IS
          `brand-500` — so both states rendered identically and the meter stopped
          reporting the only thing it exists to report.
          So the change of state is carried by COLOUR ARRIVING rather than by one
          colour becoming another: an unmet meter is greyscale and a met one goes
          green. That is also the honest reading of the kit's own rule that green
          means good — a bar at 40% is not good, it is 40%.
          The track stays the fill's own colour at a sixth, which was right and
          is unaffected: the track is the same measure UNFILLED, so it should be
          the same colour with the light out of it, and it follows the fill to
          green so the whole meter changes state rather than just the liquid. */}
      <div className={cn(TRACK, "w-full", met ? "bg-success/15" : "bg-rule/30")}>
        <div
          className={cn("h-full rounded-full", met ? "bg-success" : "bg-muted-foreground")}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
      {/* The goal in the metric's own format ("Goal: 90%", "Goal: $1,500") —
          under the bar, so the tile's number stays the first thing read. */}
      <p className="mt-1.5 flex items-baseline justify-between gap-2 text-xs">
        <span className="flex items-baseline gap-1 text-muted-foreground">
          {/* The sheet's micro-label voice: caps and tracking on the WORD only.
              The value keeps its own case, because `formatMetricValue` returns
              "4h 44m" for a duration goal and "4H 44M" is a different string
              from the one the headline above is printing. */}
          <span className="uppercase tracking-wide">Goal</span>
          <span className="tnum">{formatMetricValue(target, format)}</span>
        </span>
        {/* The percentage is the reading this mark exists to give, so it wears
            ink rather than the same muted grey as its own label — and takes the
            success ink at 100%, which is the one judgement a target bar IS
            entitled to make: the goal was stated, and it was met. */}
        <span className={cn("tnum font-semibold", met ? "text-success-ink" : "text-foreground")}>{pct}%</span>
      </p>
    </div>
  );
}

/** The top groups as horizontal bars, with the total over every record above them. */
export function GroupBars({
  groups,
  total,
  format,
  show = 4,
}: {
  groups: GroupRow[];
  total?: number | null;
  format: ChartFormat;
  /**
   * OPTIONAL, DEFAULTING TO THE FOUR THIS ALWAYS SHOWED. Four because a tile on
   * the groups board is a glance and six rows made the grid's tallest tile set
   * the height for every tile beside it — a constraint a custom view does not
   * have, because there the height was chosen deliberately.
   */
  show?: number;
}) {
  const SHOW = Math.max(1, show);
  const shown = groups.slice(0, SHOW);
  const max = Math.max(1, ...shown.map((g) => g.value));
  return (
    <div className="mt-3 space-y-1.5">
      {shown.map((g, i) => (
        <div key={g.label} className="flex items-center gap-2">
          <span className="w-24 shrink-0 truncate text-xs text-muted-foreground" title={g.label}>
            {g.label}
          </span>
          {/* The track stays NEUTRAL here — an ink wash rather than the fill's
              own colour, which is what the goal bar uses. Four rows in four
              hues over four matching gutters is a plaid; one channel under all
              of them is what lets the bars themselves be the colourful thing.
              Ink at 8% rather than `bg-muted`, so it is the card's own shadow
              in both themes instead of a grey that only works in one. */}
          <span className={cn(TRACK, "flex-1 bg-foreground/8")}>
            <span
              className={cn("block h-full rounded-full", BREAKDOWN_ACCENTS[i % BREAKDOWN_ACCENTS.length])}
              style={{ width: `${Math.max((g.value / max) * 100, 2)}%` }}
            />
          </span>
          {/* Text wears text colours, never the series'. The bar beside it
              already carries the hue; a label in the same colour makes the
              value look like a status. */}
          <span className="tnum w-12 shrink-0 text-right text-xs font-medium text-foreground">
            {formatMetricValue(g.value, format)}
          </span>
        </div>
      ))}
      {/* A cut the tile makes is a cut the tile has to admit — four bars read
          as "all of them" when there were eleven. */}
      {groups.length > shown.length && (
        <p className="text-xs text-muted-foreground">
          Top {shown.length} of {groups.length}
          {total != null ? " — the number above counts them all" : ""}.
        </p>
      )}
    </div>
  );
}

/**
 * "Still importing — covering 12 of 90 days."
 *
 * Days rather than a percentage of records: the denominator of a record count
 * is how many exist in the window, which is unknowable until the import
 * finishes. Days covered is a number we actually have.
 *
 * The bar is clamped to the target so a stream that reached further than asked
 * cannot render past its own end, and capped below full — an import that is
 * still running has not finished, whatever the rounding says.
 */
export function ImportProgress({ importing }: { importing: ImportCoverage }) {
  const day = 86_400_000;
  const target = Math.max(1, Math.round(importing.targetMs / day));
  // Floored: rounding the numerator renders a 100%-full bar captioned "still
  // importing", which is a contradiction the user resolves by believing the bar.
  const covered = Math.min(target, Math.max(0, Math.floor(importing.coveredMs / day)));
  const pct = Math.min(99, Math.max(0, Math.round((covered / target) * 100)));
  return (
    // ONE TINTED OBJECT, not a stripe with an orphaned sentence under it. The
    // bar and the caption are a single caveat about a single number, and drawn
    // loose on the card they read as two unrelated things at the bottom of the
    // tile — the bar as decoration, the line as fine print. On its own warn
    // wash it is the thing it always was: a notice, with its measure in it.
    // `rounded-card`, because the sheet pills buttons and chips and nothing
    // else.
    <div className="mt-3 rounded-card bg-warn-soft p-2.5">
      <div className={cn(TRACK, "w-full bg-warn/20")}>
        <div className="h-full rounded-full bg-warn transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      {/* warn-ink on warn-soft is the trio's own solved pair at 5.18:1 — which
          is what it was always styled for, and never actually sat on until the
          wash arrived. */}
      <p className="mt-1.5 text-xs text-warn-ink">
        Still importing — covering {covered} of {target} days. This number can still grow.
      </p>
    </div>
  );
}
