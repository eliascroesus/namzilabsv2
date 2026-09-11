import { StatusPill } from "@/components/ui/badge";
import { formatMetricValue } from "@/lib/format";
import { cn } from "@/lib/utils";
import { multipleLabel, stageWidths } from "@/lib/board/scale";
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
  /**
   * ONE ANSWER FOR THE WIDTH, TAKEN FROM `scale.ts`. This component used to
   * compute its own, and the two disagreed: it ran `count / first` clamped to
   * 100 and floored at 2, while `stageWidths` floored at 4 — so one funnel drawn
   * as a Funnel and as a Pipeline gave a decimated stage two different lengths.
   * That is the drift the chart kit's arithmetic module exists to prevent, and
   * it survived only because nothing ever drew both marks side by side.
   *
   * `stageWidths` now measures against the LARGEST stage with no cap and no
   * floor, so the clamp, the floor and the whole cut-edge apparatus go with it.
   * A genuinely narrowing funnel is unchanged to the pixel.
   */
  const widths = stageWidths(result.stages.map((s) => s.count));
  return (
    <div className="space-y-2">
      {result.stages.map((stage, i) => {
        /**
         * A DROP-OFF IS A CLAIM ABOUT A SEQUENCE, and a composition is not one:
         * its stages are independent metrics over a single window, so the
         * largest fall between two of them says nothing about why anybody left
         * — nobody walked from one to the other. The pill is withheld rather
         * than reworded, and `Pipeline` withholds it on the same condition.
         */
        const isBottleneck = !composed && result.bottleneckIndex === i;
        /** Where the stage above ended — the reference a shorter bar is short OF. */
        const prev = i > 0 ? widths[i - 1] : null;
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
            <div className="relative h-6 w-full overflow-hidden rounded-control bg-muted">
              {/* THE MARKER, NOT THE BRAND — the same call every mark in
                  `charts.tsx` makes. A stage bar carries no ink, so the only
                  contrast it has is its own edge against the `muted` track, and
                  yellow measures 1.42:1 there. The brand's 11.24:1 is the ratio
                  of dark ink ON a yellow fill, which is not the shape a bar is.

                  NOTHING IS CLIPPED ANY MORE, so the dashed cut edge that marked
                  an over-long bar is gone along with the cap that made it
                  necessary. A stage bigger than the one above it is simply
                  longer, and the notch below says where the previous stage
                  ended — the surplus is the part you can see rather than the
                  part that was hidden. */}
              <div
                className={cn("h-full", isBottleneck ? "bg-danger" : "bg-marker")}
                style={{ width: `${widths[i]}%` }}
              />
              {/* WHERE THE STAGE ABOVE ENDED, drawn only when this one RAN PAST
                  it. Below it the shortfall is already legible as the empty part
                  of the track, which is what the track is for. */}
              {prev != null && widths[i] > prev && (
                <div className="absolute inset-y-0 w-px bg-card" style={{ left: `${prev}%` }} aria-hidden />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
