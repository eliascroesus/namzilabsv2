import { formatMetricValue } from "@/lib/format";
import { funnelShape, multipleLabel } from "@/lib/board/scale";
import { StatusPill } from "@/components/ui/badge";
import type { FunnelResult } from "@/lib/metrics/compute";

/**
 * THE PIPELINE AS ONE CONNECTED BODY — the silhouette, not a list of bars.
 *
 * It has been three things. It started as centred bars whose widths were a
 * share of the FIRST stage, clamped at 100 and floored at 4, which drew the
 * owner's 12 -> 39 -> 0 as two identical full-width slabs and a stub floating in
 * the middle of its row. Fixing the arithmetic — share of the LARGEST stage, no
 * cap, no floor — made the lengths true and it was still wrong: detached bars
 * with a label line over each read as a table, and a pipeline is supposed to
 * look like a pipeline.
 *
 * So the stages are polygons that touch, and the SLOPE between two of them is
 * the drop — drawn in the space a bar chart leaves empty, costing no ink, no
 * label and no sentence. That is what every funnel implementation surveyed
 * actually draws (ECharts, nivo, Recharts, chartjs-chart-funnel); the shoulder
 * inside each band is what keeps a stage's own width readable instead of
 * letting the body melt into a cone. See `funnelShape`.
 *
 * `FunnelView` DELIBERATELY STAYS A BAR LIST. The two chart ids had drifted into
 * near-identical marks separated only by a centring; now they answer different
 * questions. "Funnel" ranks stages against a shared left edge, which is the form
 * in which two lengths can actually be compared. "Pipeline" draws the body,
 * which is the form that reads as a narrowing at a glance. Both take their
 * widths from `stageWidths`, so they can never disagree about a number again.
 *
 * THREE COLUMNS, AND THE SHAPE OWNS THE MIDDLE ONE. Labels laid OVER the fill
 * would need one ink on the accent and another on the card, and no single token
 * is legible on both in both themes — the first version of this did exactly
 * that and printed a muted-grey ratio on a blue segment. Given its own column
 * the body cannot collide with anything, and every label sits on the card's own
 * background at full contrast.
 */
export function Pipeline({
  result,
  accent,
  composed,
  cols = 6,
}: {
  result: FunnelResult;
  accent: string;
  /**
   * The stages were assembled by `composeFunnel` out of separate published
   * metrics rather than computed as one sequenced run. It buys two things: the
   * ratio stops calling itself a conversion, and no drop-off may be CLAIMED —
   * see `bottleneck`. `FunnelView` spends it identically, because the two marks
   * must not disagree about what a number means.
   */
  composed?: boolean;
  /** The tile's width in grid columns — only the drop-off pill reads it. */
  cols?: number;
}) {
  const counts = result.stages.map((s) => s.count);
  const bands = funnelShape(counts, { align: "center" });
  const fmt = { format: "number" as const };

  return (
    <div
      className="grid min-h-0 flex-1 items-stretch gap-x-3"
      style={{
        // The body takes a fixed share of the width so it stays a recognisable
        // shape on a narrow tile; the name lane absorbs whatever is left.
        gridTemplateColumns: "minmax(0,1fr) 38% auto",
        gridTemplateRows: `repeat(${result.stages.length}, minmax(0, 1fr))`,
      }}
    >
      {/**
       * ONE SVG SPANNING EVERY ROW, so the body is continuous across the band
       * boundaries instead of being cut into one element per stage.
       *
       * `preserveAspectRatio="none"` and a 0..100 box on both axes — the
       * `cartesian.tsx` idiom rather than the pie's aspect lock, and the
       * difference is load-bearing. A pie locks its aspect because ANGLE is its
       * encoding and a squeezed circle lies about it. Here the encoding is
       * horizontal width alone, so stretching the box to whatever shape the tile
       * happens to be preserves every ratio exactly.
       */}
      <svg
        className="h-full w-full"
        style={{ gridColumn: 2, gridRow: `1 / ${result.stages.length + 1}` }}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
      >
        {bands.map((b, i) => (
          <polygon
            key={i}
            points={b.points}
            fill={!composed && result.bottleneckIndex === i ? "var(--color-danger)" : accent}
            /**
             * THE SEAM IS THE CARD'S OWN COLOUR — the same trick `pie.tsx` uses
             * between two adjacent arcs. The stages read as separate without a
             * second hue and without a gap that would break the body in two.
             * `non-scaling-stroke` keeps it one pixel however far the box is
             * stretched; without it the seam thickens with the tile.
             */
            stroke="var(--color-card)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      {result.stages.map((stage, i) => {
        /**
         * A DROP-OFF IS A CLAIM ABOUT A SEQUENCE, and a composition is not one:
         * its stages are independent metrics over a single window, so the
         * largest fall between two of them says nothing about why anybody left.
         * The owner's card put a red pill on a 39 -> 0 between two metrics dated
         * by different fields entirely.
         */
        const bottleneck = !composed && result.bottleneckIndex === i;
        /**
         * A COMPOSED STAGE'S RATIO IS NOT A CONVERSION, and above 1 it is not
         * even a share: 3.3 printed as "330% from prev" puts a number that
         * cannot be a proportion inside a phrase that promises one.
         * `multipleLabel` answers null whenever the percentage is still the true
         * spelling.
         */
        const share = formatMetricValue(stage.conversionFromPrev * 100, { format: "percent", precision: 0 });
        const ratio = composed
          ? `${multipleLabel(stage.conversionFromPrev) ?? share} vs prev`
          : `${share} from prev`;
        // Keyed by index: two stages may legitimately share a label, and
        // `computeFunnel` does not dedupe them. Position IS identity here.
        return (
          <div key={`n${i}`} className="contents" data-tip={`${stage.label} · ${formatMetricValue(stage.count, fmt)}`}>
            <span
              className="flex min-w-0 items-center justify-end gap-1.5 overflow-hidden"
              style={{ gridColumn: 1, gridRow: i + 1 }}
            >
              {/* The pill stands down before the NAME does — at the tile's own
                  `minW` of 4 columns it won and rendered "Booked Leads" as
                  "Booke…". The bottleneck is also carried by the segment's own
                  fill at every width. */}
              {bottleneck && cols >= 5 && <StatusPill tone="danger">Biggest drop-off</StatusPill>}
              <span className="truncate text-xs text-foreground" title={stage.label}>
                {stage.label}
              </span>
            </span>
            <span
              className="flex shrink-0 items-center gap-2"
              style={{ gridColumn: 3, gridRow: i + 1 }}
            >
              {/* THE RATIO IS THE POINT OF THE CHART, so it is never the thing
                  that stands down. It was briefly gated on width alongside the
                  pill, which hid the drop-off percentage on exactly the tile
                  size most boards use — the figure this whole feature exists to
                  surface. Stacked under the count rather than beside it: two
                  short lines fit a narrow column where one long row does not,
                  and the count stays the thing the eye lands on. */}
              <span className="flex flex-col items-end leading-tight">
                <span
                  className={`tnum text-xs font-semibold ${stage.count === 0 ? "text-muted-foreground" : "text-foreground"}`}
                >
                  {formatMetricValue(stage.count, fmt)}
                </span>
                {i > 0 && <span className="tnum text-2xs text-muted-foreground">{ratio}</span>}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
