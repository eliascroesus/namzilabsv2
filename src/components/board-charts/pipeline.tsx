import { formatMetricValue } from "@/lib/format";
import { multipleLabel, stageWidths } from "@/lib/board/scale";
import { widensAt } from "@/lib/metrics/funnel";
import { StatusPill } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { FunnelResult } from "@/lib/metrics/compute";

/**
 * THE SAME STAGES AS A FUNNEL, DRAWN AS A NARROWING SHAPE.
 *
 * `FunnelView` reads the stages as a list of bars; this reads them as the
 * pipeline itself — centred, each stage as wide as its share of the first, so
 * the taper IS the drop-off. Same data, same conversions, same bottleneck.
 *
 * STEPPED BARS RATHER THAN A TRUE TRAPEZOID, deliberately. A trapezoid's
 * sloping edges encode nothing — the WIDTH is the count, and the slope is just
 * the space between two widths — so drawing them costs a clip path per segment
 * to say something the rectangle already said. The same honesty-per-pixel call
 * `FunnelView` made when it chose bars over a cone.
 *
 * `composed` says the stages were assembled by `composeFunnel` out of separate
 * published metrics rather than computed as one sequenced run. It buys exactly
 * one thing — the ratio stops calling itself a conversion — and `FunnelView`
 * spends it the same way, because the two marks must not disagree about what a
 * number means.
 */
export function Pipeline({
  result,
  accent,
  composed,
  cols = 6,
}: {
  result: FunnelResult;
  accent: string;
  composed?: boolean;
  /** The tile's width in grid columns — only the drop-off pill reads it. */
  cols?: number;
}) {
  const widths = stageWidths(result.stages.map((s) => s.count));
  /**
   * The stages `stageWidths` had to clamp. Same source as `FunnelView`'s and as
   * the tile's own caveat, so all three name the same stages rather than three
   * roundings of the same comparison.
   */
  const capped = new Set(widensAt(result.stages));
  const fmt = { format: "number" as const };

  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto quiet-scroll">
      {result.stages.map((stage, i) => {
        const bottleneck = result.bottleneckIndex === i;
        /**
         * A COMPOSED STAGE'S RATIO IS NOT A CONVERSION, and above 1 it is not
         * even a share: printing 3.4 as "340% from prev" puts a number that
         * cannot be a proportion inside a phrase that promises one.
         * `multipleLabel` answers null whenever the percentage is still the
         * true spelling, so a composed funnel that narrows keeps it.
         */
        const share = formatMetricValue(stage.conversionFromPrev * 100, { format: "percent", precision: 0 });
        const fromPrev = composed
          ? `${multipleLabel(stage.conversionFromPrev) ?? share} vs prev`
          : `${share} from prev`;
        /**
         * KEYED BY INDEX, NOT BY LABEL — and this was reachable with no bug
         * anywhere upstream. A classic funnel's stage labels are free text the
         * author typed into the definition and nothing dedupes them, so two
         * stages called "Booked" mint the same React key; `composeFunnel`
         * refuses same-named members, but this renderer serves both callers and
         * must not lean on the stricter one. React then reconciles by that key
         * and carries a row's subtree — the drop-off pill included — onto the
         * wrong stage when the list changes under a range switch. The stages
         * are a fixed ordered list; their position IS their identity, which is
         * why `funnel-view.tsx` has always keyed this way.
         */
        return (
          <div key={i} data-tip={`${stage.label} · ${formatMetricValue(stage.count, fmt)}`}>
            {/* The bottleneck pill rides IN the label row, not on a line of
                its own. A row per stage plus a row for the pill is five rows
                for four stages, which overflowed the chart's own default
                height — and `FunnelView` already spells it inline, so this is
                the one vocabulary rather than a second.

                AND IT STANDS DOWN BEFORE THE NAME DOES, which is this board's
                existing rule applied where it had not been. Four things share
                this row — the stage's name, the pill, the ratio and the count —
                and at the tile's own `minW` of 4 columns the pill won: "Booked
                Leads" rendered as "Booke…". That is the wrong loser. The name
                is the only part a reader cannot reconstruct from the rest of
                the card, while the bottleneck is ALSO carried by the bar
                underneath, which is drawn in `danger` red at every width. So
                below five columns the colour says it alone. `custom-tile.tsx`
                makes the same call one level up for the chart-name qualifier,
                in the same words. */}
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className="truncate text-xs text-muted-foreground" title={stage.label}>
                  {stage.label}
                </span>
                {bottleneck && cols >= 5 && <StatusPill tone="danger">Biggest drop-off</StatusPill>}
              </span>
              <span className="flex shrink-0 items-baseline gap-2">
                {i > 0 && <span className="tnum text-xs text-muted-foreground">{fromPrev}</span>}
                <span className="tnum text-xs font-semibold text-foreground">
                  {formatMetricValue(stage.count, fmt)}
                </span>
              </span>
            </div>
            {/* THE SAME CUT `FunnelView` MAKES, ON BOTH EDGES. `stageWidths`
                now caps a stage bigger than the first at the width of the
                first, which stops the drawing overrunning its tile — but a
                capped bar and a genuine 100% bar are then the same rectangle,
                and this mark's whole argument is that the width is the count.
                The bar is centred here, so a capped stage overruns at the left
                as well as the right and both edges get the perforation. Drawn
                in the card's own colour because, unlike the funnel's bar, this
                one has no track behind it to show through.

                UNGATED AND SELF-EXPLAINING, for the reason `FunnelView` states
                at the same place: a classic funnel can widen too, and the
                footer that names a capped stage is printed by the composed tile
                alone. The cue must not depend on prose that may not be on the
                page. */}
            <div
              className={cn(
                "mx-auto mt-1 h-5 rounded-control",
                capped.has(i) && "border-x-2 border-dashed border-card",
              )}
              title={
                capped.has(i) ? `${stage.label} is larger than the first stage, so this bar is cut off.` : undefined
              }
              style={{ width: `${widths[i]}%`, background: bottleneck ? "var(--color-danger)" : accent }}
            />
          </div>
        );
      })}
    </div>
  );
}
