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
 * A bucketed series with its headline over it. The headline is `text-display`
 * — a chart's number shares the tile with the bars, so it sits one step below
 * the scalar tile's `text-stat`.
 */
export function Sparkbars({ series, label, format }: { series: SeriesPoint[]; label: string; format: ChartFormat }) {
  const max = Math.max(1, ...series.map((s) => s.value));
  return (
    <>
      <p className="tnum mt-2 text-display font-semibold">{label}</p>
      <div className="mt-3 flex h-16 items-end gap-1">
        {series.map((s) => (
          <div
            key={s.bucket}
            // The bar's own value, in the metric's own format. A raw number
            // here contradicts the headline directly above it — "4h 44m" over
            // bars whose tooltips read "284.6", the same quantity said two ways.
            title={`${s.bucket}: ${formatMetricValue(s.value, format)}`}
            className="flex-1 bg-brand-600"
            style={{ height: `${Math.max((s.value / max) * 100, 4)}%` }}
          />
        ))}
      </div>
    </>
  );
}

/** Progress toward a goal. The fill turns `success` only when the goal is met. */
export function TargetBar({ value, target, format }: { value: number; target: number; format: ChartFormat }) {
  const pct = target > 0 ? Math.min(Math.round((value / target) * 100), 100) : 0;
  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-tiny text-muted-foreground">
        {/* The goal is shown in the metric's own format ("Goal: 90%", "Goal: $1,500"). */}
        <span className="tnum">Goal: {formatMetricValue(target, format)}</span>
        <span className="tnum">{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full", pct >= 100 ? "bg-success" : "bg-brand-600")}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
    </div>
  );
}

/** The top groups as horizontal bars, with the total over every record above them. */
export function GroupBars({ groups, total, format }: { groups: GroupRow[]; total?: number | null; format: ChartFormat }) {
  const SHOW = 6;
  const shown = groups.slice(0, SHOW);
  const max = Math.max(1, ...shown.map((g) => g.value));
  return (
    <>
      {/* The metric over EVERY record. Bars alone read as "these six are the
          whole number", and the cut-note below needs a visible total to be
          about. */}
      {total != null && <p className="tnum mt-2 text-display font-semibold">{formatMetricValue(total, format)}</p>}
      <div className="mt-3 space-y-1.5">
        {shown.map((g) => (
          <div key={g.label}>
            <div className="mb-0.5 flex justify-between text-base">
              <span className="text-foreground">{g.label}</span>
              <span className="tnum text-muted-foreground">{formatMetricValue(g.value, format)}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-brand-600" style={{ width: `${Math.max((g.value / max) * 100, 2)}%` }} />
            </div>
          </div>
        ))}
        {/* A cut the tile makes is a cut the tile has to admit — six bars read
            as "all of them" when there were eleven. */}
        {groups.length > shown.length && (
          <p className="text-tiny text-muted-foreground">
            Showing the {shown.length} largest of {groups.length} groups
            {total != null ? " — the number above includes them all" : ""}.
          </p>
        )}
      </div>
    </>
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
