import { formatMetricValue } from "@/lib/format";
import { multipleLabel, stageWidths } from "@/lib/board/scale";
import { StatusPill } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { FunnelResult } from "@/lib/metrics/compute";

/**
 * THE STAGES ON ONE BASELINE — length is the count, and the drop is the gap.
 *
 * IT USED TO BE A CENTRED SILHOUETTE, each bar as wide as its share of the
 * FIRST stage, so the taper was meant to read as the funnel itself. That mark
 * is gone, and the screenshot that killed it is worth recording: an owner's
 * pipeline of 12 -> 38 -> 0 drew two IDENTICAL full-width slabs — stage 2 was
 * 316% of stage 1 and got clamped to the same 100% — followed by a 4%-wide stub
 * floating in the centre of the row, clipped by the bottom of the card, under
 * three paragraphs apologising for the drawing.
 *
 * Every part of that came from the geometry rather than from the data:
 *
 *   THE CENTRING is what makes a stub read as a bullet rather than as a short
 *   bar. Bars that do not share a left edge cannot be compared by length at all
 *   — the eye has no origin to measure from — so the centred form needs the
 *   taper to mean anything, and the taper needs the counts to descend, which
 *   neither funnel on this board can promise.
 *
 *   THE CAP AND THE FLOOR were the geometry lying to stay inside the track. Both
 *   are gone from `stageWidths`, which now measures against the LARGEST stage
 *   and is therefore self-clamping.
 *
 * So the bars start at a shared origin and the mark stops pretending to be a
 * shape. A stage bigger than the one above it is simply longer — no clip, no
 * dashed edge, no sentence. A stage of zero draws no bar at all, and the 1px
 * frame running to where the previous stage ended IS the drop-off, drawn as
 * length: "38 came in, none came out" is an empty rectangle the width of 38.
 *
 * A GENUINE FUNNEL IS UNCHANGED TO THE PIXEL in its widths — when the counts
 * descend, share-of-max and share-of-first are the same number — so this is a
 * fix aimed squarely at the case that was broken.
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
   * see `bottleneck` below. `FunnelView` spends it identically, because the two
   * marks must not disagree about what a number means.
   */
  composed?: boolean;
  /** The tile's width in grid columns — only the drop-off pill reads it. */
  cols?: number;
}) {
  const counts = result.stages.map((s) => s.count);
  const widths = stageWidths(counts);
  const fmt = { format: "number" as const };

  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto quiet-scroll">
      {result.stages.map((stage, i) => {
        /**
         * A DROP-OFF IS A CLAIM, AND A COMPOSITION CANNOT MAKE IT.
         *
         * `funnelFromCounts` picks the largest fall between adjacent stages,
         * which is meaningful for a cohort walking a sequence and meaningless
         * for independent metrics counted over one window — nobody walked from
         * one to the other. The owner's card put a red BIGGEST DROP-OFF pill on
         * a stage whose "drop" was 38 -> 0 between two metrics dated by
         * different fields entirely. The number is still computed; what is
         * withheld is the assertion about WHY it fell.
         */
        const bottleneck = !composed && result.bottleneckIndex === i;
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
         * WHERE THE STAGE ABOVE ENDED — the reference the drop is measured
         * against, and the only thing that makes a shorter bar legible AS a
         * loss rather than merely as a shorter bar.
         *
         * Below it, the span between the two is drawn as a 1px frame: the
         * rectangle is the part that did not carry through. Above it, the bar
         * simply runs past and a hairline notch marks the crossing, so a rise
         * is visible at exactly the point it happened instead of being clipped
         * flat.
         */
        const prev = i > 0 ? widths[i - 1] : null;
        const lost = prev != null && prev > widths[i];
        const gained = prev != null && widths[i] > prev;
        /**
         * KEYED BY INDEX, NOT BY LABEL — and this was reachable with no bug
         * anywhere upstream. A classic funnel's stage labels are free text the
         * author typed into the definition and nothing dedupes them, so two
         * stages called "Booked" mint the same React key; `composeFunnel`
         * refuses same-named members, but this renderer serves both callers and
         * must not lean on the stricter one. React then reconciles by that key
         * and carries a row's subtree onto the wrong stage when the list
         * changes under a range switch. The stages are a fixed ordered list;
         * their position IS their identity, which is why `funnel-view.tsx` has
         * always keyed this way.
         */
        return (
          <div key={i} data-tip={`${stage.label} · ${formatMetricValue(stage.count, fmt)}`}>
            {/* The bottleneck pill rides IN the label row, not on a line of
                its own — a row per stage plus a row for the pill is five rows
                for four stages, which overflowed the chart's own default
                height.

                AND IT STANDS DOWN BEFORE THE NAME DOES, which is this board's
                existing rule applied where it had not been. Four things share
                this row — the stage's name, the pill, the ratio and the count —
                and at the tile's own `minW` of 4 columns the pill won: "Booked
                Leads" rendered as "Booke…". The name is the only part a reader
                cannot reconstruct from the rest of the card, while the
                bottleneck is ALSO carried by the bar underneath, drawn in
                `danger` at every width. `custom-tile.tsx` makes the same call
                one level up for the chart-name qualifier. */}
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className="truncate text-xs text-muted-foreground" title={stage.label}>
                  {stage.label}
                </span>
                {bottleneck && cols >= 5 && <StatusPill tone="danger">Biggest drop-off</StatusPill>}
              </span>
              <span className="flex shrink-0 items-baseline gap-2">
                {i > 0 && <span className="tnum text-xs text-muted-foreground">{fromPrev}</span>}
                <span
                  className={cn(
                    "tnum text-xs font-semibold",
                    stage.count === 0 ? "text-muted-foreground" : "text-foreground",
                  )}
                >
                  {formatMetricValue(stage.count, fmt)}
                </span>
              </span>
            </div>
            {/* THE TRACK, and every bar in it starts at the same left edge.
                `relative` so the loss frame and the crossing notch can be
                positioned against the same origin the bar is. */}
            <div className="relative mt-1 h-5">
              {/* THE PART THAT DID NOT CARRY THROUGH — a 1px frame from this
                  stage's end to where the one above it ended. It is the only
                  thing on the row that makes a zero stage legible: no bar, but
                  a rectangle the width of everything that was there a moment
                  ago. Border-only, because this product draws losses as an
                  absence of fill rather than as a second colour. */}
              {lost && (
                <div
                  className="absolute inset-y-0 rounded-control border border-border"
                  style={{ left: `${widths[i]}%`, width: `${prev - widths[i]}%` }}
                  aria-hidden
                />
              )}
              {widths[i] > 0 && (
                <div
                  className="absolute inset-y-0 left-0 rounded-control"
                  style={{ width: `${widths[i]}%`, background: bottleneck ? "var(--color-danger)" : accent }}
                />
              )}
              {/* WHERE THE STAGE ABOVE ENDED, when this one ran past it. A 1px
                  card-coloured rule through the fill, which is the same trick
                  `pie.tsx` uses to separate two adjacent arcs. The surplus is
                  the part you can SEE rather than the part that was clipped —
                  the exact inversion of the cap this mark used to carry. */}
              {gained && (
                <div
                  className="absolute inset-y-0 w-px bg-card"
                  style={{ left: `${prev}%` }}
                  aria-hidden
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
