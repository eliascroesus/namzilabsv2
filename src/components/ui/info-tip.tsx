"use client";

import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * THE EXPLANATION A CONTROL NO LONGER PRINTS UNDER ITSELF.
 *
 * Every field in the tile settings carried a sentence of prose beneath it, and
 * a dozen of them stacked read as a wall — "it looks messy and there is no
 * point", which is fair: a description is something you want ONCE, when you
 * first meet a control, and never again afterwards.
 *
 * A DESCRIPTION IS NOT A STATE, and only the first belongs in here. "Follows
 * the board's pills unless you pin one here" explains a control and can wait to
 * be asked for. "Add one more before this can be drawn" is the tile saying it
 * is refusing to draw right now, and putting that behind a hover would hide the
 * reason the chart is blank. Those still render as a visible `FieldHint`.
 *
 * IT LIVES IN `ui/` BECAUSE IT IS A RAW `<button>`. `check-ui`'s
 * hand-rolled-button rule allows one only here and under `components/flow`, and
 * it is the right call rather than a technicality: the kit's `Button` brings a
 * height, a padding and a variant that a 16px glyph beside a label wants none
 * of — the same argument `date-range-picker.tsx` makes for its day cells.
 *
 * RADIX RATHER THAN `title`. A native tooltip is mouse-only and renders as a
 * system artefact; this one opens on FOCUS as well as hover, so the sentence is
 * reachable from a keyboard.
 */
export function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    /**
     * ITS OWN PROVIDER, so the primitive works wherever it is dropped.
     *
     * Radix throws — not degrades, THROWS — when a Tooltip renders with no
     * `TooltipProvider` above it, which took the whole settings panel down the
     * first time this shipped. Requiring callers to remember a provider is a
     * primitive with a trap in it; the nesting a second provider costs is
     * nothing next to that.
     *
     * `delayDuration={200}` rather than the kit default of 0: these sit beside
     * labels a pointer crosses on its way to a control, and a tooltip that
     * fires instantly on a pass-through is the flicker that makes people stop
     * reading them.
     */
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            /* Named for what it is FOR, not what it looks like: "About Period"
             rather than "info". The visible label is beside it, so the icon has
             to carry the association on its own for anyone who cannot see
             them together. */
            aria-label={`About ${label}`}
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors duration-(--duration-fast) hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marker"
          >
            <Info className="size-3.5" aria-hidden />
          </button>
        </TooltipTrigger>
        {/* `max-w-64` so a two-line sentence wraps into a readable column rather
          than one long ribbon across the panel. */}
        <TooltipContent className="max-w-64 text-pretty">{children}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
