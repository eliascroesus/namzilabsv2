import { formatMetricValue } from "@/lib/format";
import { funnelShape, multipleLabel } from "@/lib/board/scale";
import { StatusPill } from "@/components/ui/badge";
import type { FunnelResult } from "@/lib/metrics/compute";

/**
 * THE FUNNEL BODY — one connected shape, drawn once and arranged four ways.
 *
 * Two axes of choice, and they are independent. `align` centres the body into a
 * symmetric silhouette or anchors it to one edge; `flow` decides whether the
 * stages run DOWN (width carries the count) or ACROSS (height does). "Pipeline"
 * and "Funnel" differ only in `align`, and `flow` is the author's, from
 * `config.flow`.
 *
 * BOTH MARKS USED TO BE ROWS OF BARS with a label line above each, and the
 * owner's verdict was that it reads as a table rather than a funnel. The stages
 * are polygons that touch now, so the SLOPE between two of them is the drop —
 * drawn in the space a bar chart leaves empty, costing no ink, no label and no
 * sentence.
 *
 * WHERE THE LABELS GO IS A CONSEQUENCE OF THE FLOW, not a second preference.
 * Running DOWN, a label cannot sit above its own stage without cutting the body
 * in half, so names go in a lane beside it. Running ACROSS, every stage has the
 * full width of its own column overhead — so the name sits ABOVE its section
 * and the conversion figure sits IN THE GAP between two sections, which is
 * where a reader looking for a drop-off actually looks. That is the whole
 * reason the second flow is worth having.
 *
 * Text is never laid over the fill in either: no single ink token is legible on
 * both the accent and the card in both themes, and the first attempt at this
 * printed a muted-grey ratio on a blue segment.
 */
export function FunnelBody({
  result,
  accent,
  composed,
  cols = 6,
  align,
  flow = "down",
}: {
  result: FunnelResult;
  accent: string;
  /**
   * The stages were assembled by `composeFunnel` out of separate published
   * metrics rather than computed as one sequenced run. It buys two things: the
   * ratio stops calling itself a conversion, and no drop-off may be CLAIMED.
   */
  composed?: boolean;
  /** The tile's width in grid columns — only the drop-off pill reads it. */
  cols?: number;
  align: "center" | "left";
  flow?: "down" | "across";
}) {
  const counts = result.stages.map((s) => s.count);
  const bands = funnelShape(counts, { align, flow });
  const fmt = { format: "number" as const };
  const n = result.stages.length;
  const danger = (i: number) => !composed && result.bottleneckIndex === i;

  /**
   * A RATIO NEEDS A DENOMINATOR THAT EXISTS. `funnelFromCounts` guards its
   * division and answers 0 when the previous stage was empty, which is right for
   * the arithmetic and wrong on screen: the owner's card printed "0% vs prev"
   * beside a count of 12, because the stage above it was zero. Going from
   * nothing to twelve is not a nought per cent of anything.
   */
  const ratioAt = (i: number): string | null => {
    const prev = i > 0 ? result.stages[i - 1].count : null;
    if (prev == null || prev === 0) return null;
    const stage = result.stages[i];
    const share = formatMetricValue(stage.conversionFromPrev * 100, { format: "percent", precision: 0 });
    /**
     * A COMPOSED STAGE'S RATIO IS NOT A CONVERSION, and above 1 it is not even a
     * share: 3.3 printed as "330%" is a number that cannot be a proportion inside
     * a phrase that promises one. `multipleLabel` answers null whenever the
     * percentage is still the true spelling.
     */
    return composed ? (multipleLabel(stage.conversionFromPrev) ?? share) : share;
  };

  const marks = (
    <>
      {bands.map((b, i) =>
        b.width === 0 ? (
          /**
           * A ZERO STAGE STILL HAS TO BE SOMETHING. Its polygon is degenerate —
           * the point the body comes to — so left alone the band is blank, and
           * if that stage is also the bottleneck the danger fill has nothing to
           * colour. On the owner's own data it IS the bottleneck. A dashed rule
           * on the band's own axis says "this stage is here and it is empty"
           * without manufacturing the width the 4% floor used to invent.
           */
          <line
            key={i}
            x1={flow === "down" ? b.cx : (b.y0 + b.y1) / 2}
            x2={flow === "down" ? b.cx : (b.y0 + b.y1) / 2}
            y1={flow === "down" ? b.y0 : 0}
            y2={flow === "down" ? b.y1 : 100}
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
             * THE SEAM IS THE CARD'S OWN COLOUR — the same trick `pie.tsx` uses
             * between two adjacent arcs. The stages read as separate without a
             * second hue and without a gap that would break the body in two.
             * `non-scaling-stroke` keeps it one pixel however far the box is
             * stretched.
             */
            stroke="var(--color-card)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ),
      )}
      {/**
       * THE HIT TARGETS, PAINTED LAST AND INVISIBLE. The body is the largest
       * thing on the card and carried no hover at all — and a zero stage had no
       * geometry to hover even in principle. A transparent rect per band is
       * hit-testable, the same move `cartesian.tsx` makes for its columns.
       */}
      {bands.map((b, i) => (
        <rect
          key={`hit${i}`}
          x={flow === "down" ? 0 : b.y0}
          y={flow === "down" ? b.y0 : 0}
          width={flow === "down" ? 100 : Math.round((b.y1 - b.y0) * 10) / 10}
          height={flow === "down" ? Math.round((b.y1 - b.y0) * 10) / 10 : 100}
          fill="transparent"
          data-tip={`${result.stages[i].label} · ${formatMetricValue(result.stages[i].count, fmt)}`}
        />
      ))}
    </>
  );

  /**
   * `preserveAspectRatio="none"` and a 0..100 box on both axes — the
   * `cartesian.tsx` idiom rather than the pie's aspect lock, and the difference
   * is load-bearing. A pie locks its aspect because ANGLE is its encoding and a
   * squeezed circle lies about it. Here the encoding is one length, so
   * stretching the box to whatever shape the tile happens to be preserves every
   * ratio exactly.
   */
  const svgProps = {
    className: "h-full w-full overflow-visible",
    viewBox: "0 0 100 100",
    preserveAspectRatio: "none" as const,
    "aria-hidden": true,
  };

  if (flow === "across") {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-1">
        {/* THE NAME AND THE FIGURE, ABOVE THEIR OWN SECTION. Each stage owns the
            full width of its column here, which is the arrangement the DOWN flow
            cannot offer without cutting the body in half. */}
        <div className="grid shrink-0" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          {result.stages.map((stage, i) => (
            <div key={i} className="flex min-w-0 flex-col items-center px-1 text-center">
              {/* TRUNCATION HERE IS THE DESIGN, not a defect, and it is marked so
                  the harness can tell the two apart. A stage name running ACROSS
                  shares the card with n-1 siblings — four stages on a
                  four-column tile is about 110px each — so there is nowhere else
                  for a long name to go, and the full string stays in `title`.
                  That is a different thing from the DOWN flow's name lane, where
                  "Booked Leads" once rendered "Booke…" because a pill took room
                  the name could have had. One is arithmetic; the other was a bug. */}
              <span
                data-stage-name
                className="w-full truncate text-2xs text-muted-foreground"
                title={stage.label}
              >
                {stage.label}
              </span>
              <span
                className={`tnum text-xs font-semibold ${stage.count === 0 ? "text-muted-foreground" : "text-foreground"}`}
              >
                {formatMetricValue(stage.count, fmt)}
              </span>
            </div>
          ))}
        </div>

        <div className="relative min-h-0 flex-1">
          <svg {...svgProps}>{marks}</svg>
        </div>

        {/* THE CONVERSION IN THE GAP IT DESCRIBES. A drop-off belongs BETWEEN the
            two stages it is a ratio of, not stapled to the right-hand one — and
            running across there is finally somewhere to put it. Each figure is
            centred on the boundary it names, which is why this is an absolutely
            positioned strip rather than another grid of cells. */}
        <div className="relative h-4 shrink-0">
          {result.stages.map((_stage, i) => {
            const r = ratioAt(i);
            if (i === 0 || !r) return null;
            return (
              <span
                key={i}
                className="tnum absolute -translate-x-1/2 text-2xs text-muted-foreground"
                style={{ left: `${(i * 100) / n}%` }}
              >
                {r}
              </span>
            );
          })}
        </div>
        {danger(result.bottleneckIndex ?? -1) && cols >= 5 && (
          <div className="flex shrink-0 justify-center">
            <StatusPill tone="danger">Biggest drop-off</StatusPill>
          </div>
        )}
      </div>
    );
  }

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
      {/* ONE SVG SPANNING EVERY ROW, so the body is continuous across the band
          boundaries instead of being cut into one element per stage. */}
      <svg {...svgProps} style={{ gridColumn: 2, gridRow: `1 / ${n + 1}` }}>
        {marks}
      </svg>

      {result.stages.map((stage, i) => {
        const r = ratioAt(i);
        // Keyed by index: two stages may legitimately share a label, and
        // `computeFunnel` does not dedupe them. Position IS identity here.
        return (
          <div key={i} className="contents">
            <span
              className="flex min-w-0 items-center justify-end gap-1.5 overflow-hidden"
              style={{ gridColumn: 1, gridRow: i + 1 }}
            >
              {/* The pill stands down before the NAME does — at the tile's own
                  `minW` it won and rendered "Booked Leads" as "Booke…". The
                  bottleneck is also carried by the segment's own fill. */}
              {danger(i) && cols >= 5 && <StatusPill tone="danger">Biggest drop-off</StatusPill>}
              <span className="truncate text-xs text-foreground" title={stage.label}>
                {stage.label}
              </span>
            </span>
            <span className="flex shrink-0 items-center" style={{ gridColumn: 3, gridRow: i + 1 }}>
              {/* THE RATIO IS THE POINT OF THE CHART, so it is never the thing
                  that stands down. It was briefly gated on tile width alongside
                  the pill, which hid the drop-off figure on exactly the size most
                  boards use. Stacked under the count: two short lines fit a
                  narrow column where one long row does not. */}
              <span className="flex flex-col items-end leading-tight">
                <span
                  className={`tnum text-xs font-semibold ${stage.count === 0 ? "text-muted-foreground" : "text-foreground"}`}
                >
                  {formatMetricValue(stage.count, fmt)}
                </span>
                {r && <span className="tnum text-2xs text-muted-foreground">{r} vs prev</span>}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
