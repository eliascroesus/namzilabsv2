import { formatMetricValue } from "@/lib/format";
import { stageWidths } from "@/lib/board/scale";
import { StatusPill } from "@/components/ui/badge";
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
 */
export function Pipeline({ result, accent }: { result: FunnelResult; accent: string }) {
  const widths = stageWidths(result.stages.map((s) => s.count));
  const fmt = { format: "number" as const };

  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto quiet-scroll">
      {result.stages.map((stage, i) => {
        const bottleneck = result.bottleneckIndex === i;
        return (
          <div key={stage.label} data-tip={`${stage.label} · ${formatMetricValue(stage.count, fmt)}`}>
            {/* The bottleneck pill rides IN the label row, not on a line of
                its own. A row per stage plus a row for the pill is five rows
                for four stages, which overflowed the chart's own default
                height — and `FunnelView` already spells it inline, so this is
                the one vocabulary rather than a second. */}
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className="truncate text-xs text-muted-foreground" title={stage.label}>
                  {stage.label}
                </span>
                {bottleneck && <StatusPill tone="danger">Biggest drop-off</StatusPill>}
              </span>
              <span className="flex shrink-0 items-baseline gap-2">
                {i > 0 && (
                  <span className="tnum text-xs text-muted-foreground">
                    {formatMetricValue(stage.conversionFromPrev * 100, { format: "percent", precision: 0 })} from prev
                  </span>
                )}
                <span className="tnum text-xs font-semibold text-foreground">
                  {formatMetricValue(stage.count, fmt)}
                </span>
              </span>
            </div>
            <div
              className="mx-auto mt-1 h-5 rounded-control"
              style={{ width: `${widths[i]}%`, background: bottleneck ? "var(--color-danger)" : accent }}
            />
          </div>
        );
      })}
    </div>
  );
}
