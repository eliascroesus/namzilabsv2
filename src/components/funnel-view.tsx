import { StatusPill } from "@/components/ui/badge";
import { formatMetricValue } from "@/lib/format";
import { cn } from "@/lib/utils";
import { multipleLabel } from "@/lib/board/scale";
import { widensAt } from "@/lib/metrics/funnel";
import type { FunnelResult } from "@/lib/metrics/compute";

/**
 * Horizontal funnel: each stage's distinct count, conversion bar, and the
 * bottleneck flagged.
 *
 * `composed` says the stages came from `composeFunnel` — separate published
 * metrics counted over one window — rather than from a single `computeFunnel`
 * run. It changes nothing but the WORDS on the ratio, and it has to: see
 * `multipleLabel`. A classic funnel passes it undefined and draws exactly what
 * it has always drawn.
 */
export function FunnelView({ result, composed }: { result: FunnelResult; composed?: boolean }) {
  const first = result.stages[0]?.count ?? 0;
  /**
   * Which bars the clamp below had to cut. Asked of `widensAt` rather than
   * re-derived from `pct`, so the cut edges mark exactly the stages the tile's
   * own sentence names. `pct` is rounded, so a stage half a per cent over the
   * first lands on 100 here while the prose still names it — and a caveat
   * pointing at a bar carrying no mark reads as the caveat being wrong.
   */
  const capped = new Set(widensAt(result.stages));
  return (
    <div className="space-y-2">
      {result.stages.map((stage, i) => {
        const pct = first > 0 ? Math.round((stage.count / first) * 100) : 0;
        const isBottleneck = result.bottleneckIndex === i;
        /**
         * THE RATIO, SAID THE WAY IT IS TRUE. `multipleLabel` returns null for
         * anything that really is a share, so a composed funnel that happens to
         * narrow keeps its percentage and loses only the word "conversion" —
         * which was the half that was never true of independent populations.
         */
        const share = `${Math.round(stage.conversionFromPrev * 100)}%`;
        const fromPrev = composed
          ? `${multipleLabel(stage.conversionFromPrev) ?? share} vs prev`
          : `${share} from prev`;
        return (
          <div key={i}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="font-medium text-foreground">
                {stage.label}
                {isBottleneck && (
                  <StatusPill tone="danger" className="ml-2">
                    Biggest drop-off
                  </StatusPill>
                )}
              </span>
              {/* tnum on the row, so the counts sit in columns as ranges flip. */}
              <span className="tnum text-muted-foreground">
                {formatMetricValue(stage.count, { format: "number" })}
                {i > 0 && <span className="ml-2 text-xs text-muted-foreground">{fromPrev}</span>}
              </span>
            </div>
            <div className="h-6 w-full overflow-hidden rounded-control bg-muted">
              {/* THE MARKER, NOT THE BRAND — the same call every mark in
                  `charts.tsx` makes. A stage bar carries no ink, so the only
                  contrast it has is its own edge against the `muted` track, and
                  yellow measures 1.42:1 there. The brand's 11.24:1 is the ratio
                  of dark ink ON a yellow fill, which is not the shape a bar is. */}
              {/* AN OVER-LONG BAR IS CUT, NOT QUIETLY TRIMMED. The `Math.min`
                  stops a stage bigger than the first from asking for a width
                  this track cannot give — but clamping ALONE just draws it
                  flush to the right edge, identical to a stage sitting at
                  exactly 100%, which is the same lie `overflow-hidden` was
                  telling before. The dashed edge is the track's own colour
                  showing through, so the bar reads as perforated at the point
                  it was cut.

                  UNGATED, AND IT CARRIES ITS OWN WORDS. A classic funnel widens
                  too — `computeFunnel` issues an independent
                  `count(distinct subject)` per stage with no sequencing — so
                  the clip was lying here long before anything was composed. But
                  the sentence naming a capped stage is printed by the TILE, and
                  only for a composed one; this component also renders on the
                  metric page and in the funnel builder, where there is no
                  footer at all. So the cue says what it means by itself rather
                  than relying on prose that may not be on the page. */}
              <div
                className={cn(
                  "h-full",
                  isBottleneck ? "bg-danger" : "bg-marker",
                  capped.has(i) && "border-r-2 border-dashed border-muted",
                )}
                title={
                  capped.has(i)
                    ? `${stage.label} is larger than the first stage, so this bar is cut off.`
                    : undefined
                }
                style={{ width: `${Math.min(100, Math.max(pct, 2))}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
