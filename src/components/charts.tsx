import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMetricValue } from "@/lib/format";
import type { ImportCoverage } from "@/connectors/types";

/**
 * THE CHARTS. The dashboard's one vocabulary of marks: bars are `brand-600`,
 * a met target is `success`, tracks are `bg-muted`, and every value a chart
 * prints goes through `formatMetricValue` — the tooltip and the headline must
 * say the same quantity the same way.
 *
 * Server-safe on purpose: no state, no hooks, so these render inside the
 * server-rendered dashboard exactly like the tiles that host them.
 */

/** The options bag `formatMetricValue` reads — a stored tile satisfies it structurally. */
export type ChartFormat = Parameters<typeof formatMetricValue>[1];

export type SeriesPoint = { bucket: string; value: number };
export type GroupRow = { label: string; value: number };

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
   * tile rather than a small chart. The dashboard and the /design gallery pass
   * nothing and are untouched byte for byte.
   */
  className?: string;
}) {
  const max = Math.max(1, ...series.map((s) => s.value));
  return (
    // Square bars, deliberately. A rounded cap is a radius measured against
    // the bar's WIDTH, and a twelve-bucket series stretched across a tile is
    // 50px wide per bar — the "subtle" cap renders as a row of domes. Flat
    // tops read as data at every bucket count.
    <div className={cn("mt-3 flex items-end gap-1", className)} aria-hidden>
      {series.map((s) => (
        <div
          key={s.bucket}
          // The bar's own value, in the metric's own format. A raw number here
          // contradicts the headline above it — "4h 44m" over bars whose
          // tooltips read "284.6", the same quantity said two ways.
          title={`${s.bucket}: ${formatMetricValue(s.value, format)}`}
          className="min-w-0 flex-1 bg-brand-600/85"
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
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-micro font-medium text-muted-foreground"
      title={`${formatMetricValue(previous, format)} ${since}`}
    >
      <Icon size={12} aria-hidden />
      {/* The two-tone is built by raising the NUMBER, not by sinking the
          label. `since` carries "vs yesterday" — the half that says what the
          comparison is against — and at /70 it measured 2.84:1, so the pill
          read as a naked "+12%" with an unreadable qualifier. */}
      <span className="tnum font-semibold text-foreground">{magnitude}</span>
      <span>{since}</span>
    </span>
  );
}

/** Progress toward a goal. The fill turns `success` only when the goal is met. */
export function TargetBar({ value, target, format }: { value: number; target: number; format: ChartFormat }) {
  const pct = target > 0 ? Math.min(Math.round((value / target) * 100), 100) : 0;
  return (
    <div className="mt-2.5">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", pct >= 100 ? "bg-success" : "bg-brand-600")}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
      {/* The goal in the metric's own format ("Goal: 90%", "Goal: $1,500") —
          under the bar now, so the tile's number stays the first thing read. */}
      <p className="mt-1 flex justify-between text-micro text-muted-foreground">
        <span className="tnum">Goal {formatMetricValue(target, format)}</span>
        <span className="tnum">{pct}%</span>
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
      {shown.map((g) => (
        <div key={g.label} className="flex items-center gap-2">
          <span className="w-24 shrink-0 truncate text-tiny text-muted-foreground" title={g.label}>
            {g.label}
          </span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-brand-600"
              style={{ width: `${Math.max((g.value / max) * 100, 2)}%` }}
            />
          </span>
          <span className="tnum w-12 shrink-0 text-right text-tiny text-foreground">
            {formatMetricValue(g.value, format)}
          </span>
        </div>
      ))}
      {/* A cut the tile makes is a cut the tile has to admit — four bars read
          as "all of them" when there were eleven. */}
      {groups.length > shown.length && (
        <p className="text-micro text-muted-foreground">
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
    <div className="mt-3">
      <div className="h-1 w-full overflow-hidden rounded-full bg-warn-soft">
        <div className="h-full rounded-full bg-warn transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-tiny text-warn-ink">
        Still importing — covering {covered} of {target} days. This number can still grow.
      </p>
    </div>
  );
}
