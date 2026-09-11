import { formatMetricValue } from "@/lib/format";
import { funnelShape, multipleLabel } from "@/lib/board/scale";
import { StatusPill } from "@/components/ui/badge";
import type { FunnelResult } from "@/lib/metrics/compute";

/**
 * THE FUNNEL BODY — one connected shape, drawn once and aligned two ways.
 *
 * "Pipeline" centres it into the classic silhouette; "Funnel" anchors it at the
 * left edge, which is the only form in which two stages can be compared by
 * length against a shared origin. That is the ENTIRE difference between the two
 * chart ids, and putting it in one argument is what stops them drifting: they
 * had already drifted once, over a 2%-vs-4% floor that no page could see
 * because nothing ever drew both marks side by side.
 *
 * BOTH USED TO BE ROWS OF BARS with a label line above each, and the owner's
 * verdict was that it reads as a table rather than a funnel. The stages are
 * polygons that touch now, so the SLOPE between two of them is the drop — drawn
 * in the space a bar chart leaves empty, costing no ink, no label and no
 * sentence.
 *
 * THREE COLUMNS, AND THE BODY OWNS THE MIDDLE ONE. Labels laid over the fill
 * would need one ink on the accent and another on the card, and no single token
 * is legible on both in both themes — the first attempt printed a muted-grey
 * ratio on a blue segment. Given its own column the body cannot collide with
 * anything, and every label sits on the card's own background at full contrast.
 */
export function FunnelBody({
  result,
  accent,
  composed,
  cols = 6,
  align,
}: {
  result: FunnelResult;
  accent: string;
  /**
   * The stages were assembled by `composeFunnel` out of separate published
   * metrics rather than computed as one sequenced run. It buys two things: the
   * ratio stops calling itself a conversion, and no drop-off may be CLAIMED —
   * see `bottleneck`.
   */
  composed?: boolean;
  /** The tile's width in grid columns — only the drop-off pill reads it. */
  cols?: number;
  align: "center" | "left";
}) {
  const counts = result.stages.map((s) => s.count);
  const bands = funnelShape(counts, { align });
  const fmt = { format: "number" as const };
  const n = result.stages.length;
  const danger = (i: number) => !composed && result.bottleneckIndex === i;

  return (
    <div
      className="grid min-h-0 flex-1 items-stretch gap-x-3"
      style={{
        // The body takes a fixed share of the width so it stays a recognisable
        // shape on a narrow tile; the name lane absorbs whatever is left.
        gridTemplateColumns: "minmax(0,1fr) 38% auto",
        gridTemplateRows: `repeat(${n}, minmax(0, 1fr))`,
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
        className="h-full w-full overflow-visible"
        style={{ gridColumn: 2, gridRow: `1 / ${n + 1}` }}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
      >
        {bands.map((b, i) =>
          b.width === 0 ? (
            /**
             * A ZERO STAGE STILL HAS TO BE SOMETHING. Its polygon is degenerate
             * — the point the body comes to — so left alone the band is blank,
             * and if that stage is also the bottleneck the danger fill has
             * nothing to colour. On the owner's own data it IS the bottleneck:
             * `funnelFromCounts` returns index 2 for 12 -> 39 -> 0 -> 12.
             *
             * A dashed rule on the band's own axis says "this stage is here and
             * it is empty" without manufacturing a width, which is exactly what
             * the 4% floor did wrong.
             */
            <line
              key={i}
              x1={b.cx}
              x2={b.cx}
              y1={b.y0}
              y2={b.y1}
              stroke={danger(i) ? "var(--color-danger)" : "var(--color-muted-foreground)"}
              strokeWidth={1}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
          ) : (
            <polygon
              key={i}
              points={b.points}
              fill={danger(i) ? "var(--color-danger)" : accent}
              /**
               * THE SEAM IS THE CARD'S OWN COLOUR — the same trick `pie.tsx`
               * uses between two adjacent arcs. The stages read as separate
               * without a second hue and without a gap that would break the body
               * in two. `non-scaling-stroke` keeps it one pixel however far the
               * box is stretched; without it the seam thickens with the tile.
               */
              stroke="var(--color-card)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ),
        )}
        {/**
         * THE HIT TARGETS, PAINTED LAST AND INVISIBLE. The body is the largest
         * thing on the card and carried no hover at all — and a zero stage had
         * no geometry to hover even in principle. A transparent rect per band is
         * hit-testable (the same move `cartesian.tsx` makes for its columns), so
         * every stage answers across the full width of the lane, including the
         * empty ones.
         */}
        {bands.map((b, i) => (
          <rect
            key={`hit${i}`}
            x="0"
            y={b.y0}
            width="100"
            height={Math.round((b.y1 - b.y0) * 10) / 10}
            fill="transparent"
            data-tip={`${result.stages[i].label} · ${formatMetricValue(result.stages[i].count, fmt)}`}
          />
        ))}
      </svg>

      {result.stages.map((stage, i) => {
        /**
         * A RATIO NEEDS A DENOMINATOR THAT EXISTS. `funnelFromCounts` guards its
         * division and answers 0 when the previous stage was empty, which is
         * right for the arithmetic and wrong on screen: the owner's card printed
         * "0% vs prev" beside a count of 12, because the stage above it was
         * zero. Going from nothing to twelve is not a nought per cent of
         * anything — there is no share to report, so none is printed.
         */
        const prevCount = i > 0 ? result.stages[i - 1].count : null;
        const share = formatMetricValue(stage.conversionFromPrev * 100, { format: "percent", precision: 0 });
        /**
         * A COMPOSED STAGE'S RATIO IS NOT A CONVERSION, and above 1 it is not
         * even a share: 3.3 printed as "330% from prev" puts a number that
         * cannot be a proportion inside a phrase that promises one.
         * `multipleLabel` answers null whenever the percentage is still the true
         * spelling.
         */
        const ratio =
          prevCount == null || prevCount === 0
            ? null
            : composed
              ? `${multipleLabel(stage.conversionFromPrev) ?? share} vs prev`
              : `${share} from prev`;
        // Keyed by index: two stages may legitimately share a label, and
        // `computeFunnel` does not dedupe them. Position IS identity here.
        return (
          <div key={i} className="contents">
            <span
              className="flex min-w-0 items-center justify-end gap-1.5 overflow-hidden"
              style={{ gridColumn: 1, gridRow: i + 1 }}
            >
              {/* The pill stands down before the NAME does — at the tile's own
                  `minW` of 4 columns it won and rendered "Booked Leads" as
                  "Booke…". The bottleneck is also carried by the segment's own
                  fill at every width. */}
              {danger(i) && cols >= 5 && <StatusPill tone="danger">Biggest drop-off</StatusPill>}
              <span className="truncate text-xs text-foreground" title={stage.label}>
                {stage.label}
              </span>
            </span>
            <span className="flex shrink-0 items-center" style={{ gridColumn: 3, gridRow: i + 1 }}>
              {/* THE RATIO IS THE POINT OF THE CHART, so it is never the thing
                  that stands down. It was briefly gated on width alongside the
                  pill, which hid the drop-off figure on exactly the tile size
                  most boards use. Stacked under the count rather than beside it:
                  two short lines fit a narrow column where one long row does
                  not, and the count stays what the eye lands on. */}
              <span className="flex flex-col items-end leading-tight">
                <span
                  className={`tnum text-xs font-semibold ${stage.count === 0 ? "text-muted-foreground" : "text-foreground"}`}
                >
                  {formatMetricValue(stage.count, fmt)}
                </span>
                {ratio && <span className="tnum text-2xs text-muted-foreground">{ratio}</span>}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
