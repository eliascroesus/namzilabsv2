"use client";

import { useRef, useState, type ReactNode } from "react";

/**
 * ONE TOOLTIP, ONE MECHANISM, NO CHART-SPECIFIC CLIENT CODE.
 *
 * Every mark in the kit is a pure function of its props with no state and no
 * handlers — that is what lets them render on either side of the boundary. A
 * tooltip needs a pointer, so exactly one component here is interactive, and
 * it learns what is under the cursor the only way that keeps the marks dumb:
 * each hoverable element carries a `data-tip` string that was composed WHERE
 * THE DATA IS, already formatted.
 *
 * That last point is the design. If the tooltip read a number and formatted
 * it, `formatMetricValue` and its format bag would have to cross into the
 * client for every chart — and a duration would eventually read "7800" in one
 * place and "2h 10m" in another. Instead the mark writes the finished
 * sentence, and this component only positions it.
 *
 * One `closest()` per pointermove, one rect read per move, one div. No
 * portals, no measurement effects, no per-element listeners — a bar chart with
 * ninety buckets attaches nothing at all.
 */
/**
 * THE CROSSHAIR — what the tooltip alone could not say.
 *
 * A readout floating beside the cursor tells you a value; it does not tell you
 * WHICH bucket you are on, and on a series with thirty of them the difference
 * between two adjacent days is a few pixels of guesswork. Looker Studio, Stripe
 * and Vercel all answer the same way: a rule dropped through the plot at the
 * point, and a dot on the series where the rule crosses it.
 *
 * IT IS DRAWN FROM THE POINT'S OWN COORDINATES, not from the cursor. Snapping
 * the rule to the bucket rather than tracking the pointer is the whole
 * difference between "smooth" and "reliable" here: a rule that follows the
 * mouse implies a reading between two buckets that nobody measured, and it
 * jitters at exactly the moment you are trying to read a number.
 *
 * The geometry comes from the hit band's `data-x` / `data-y` (percentages of
 * the plot) resolved against the SVG's own rect — which is the only element
 * that is definitely the plot's frame, whatever the chart put inside it.
 */
type Cross = { left: number; top: number; height: number; dotY: number | null };

export function ChartHover({ children }: { children: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [cross, setCross] = useState<Cross | null>(null);

  const clear = () => {
    setTip(null);
    setCross(null);
  };

  return (
    <div
      ref={wrap}
      className="relative flex min-h-0 flex-1 flex-col"
      onPointerMove={(e) => {
        // Coarse pointers have no hover — a tap would leave the tooltip stuck.
        if (e.pointerType === "touch") return;
        const el = (e.target as Element).closest("[data-tip]");
        const box = wrap.current?.getBoundingClientRect();
        if (!el || !box) return clear();
        setTip({ text: el.getAttribute("data-tip") ?? "", x: e.clientX - box.left, y: e.clientY - box.top });

        /**
         * Only marks that publish a point get a crosshair — bars do not, and
         * that is deliberate rather than unfinished: a bar IS its own
         * highlight, and a rule through one adds a second edge to a shape that
         * already has four.
         *
         * `ownerSVGElement` rather than `closest("svg")`: it is a direct
         * property read on the element we already have, and it cannot be fooled
         * by a chart that nests one svg inside another.
         */
        const dx = el.getAttribute("data-x");
        const svg = (el as SVGElement).ownerSVGElement;
        if (dx == null || !svg) return setCross(null);
        const sr = svg.getBoundingClientRect();
        const dy = el.getAttribute("data-y");
        setCross({
          left: sr.left - box.left + (Number(dx) / 100) * sr.width,
          top: sr.top - box.top,
          height: sr.height,
          dotY: dy == null ? null : (Number(dy) / 100) * sr.height,
        });
      }}
      onPointerLeave={clear}
    >
      {children}
      {cross && (
        <span aria-hidden className="pointer-events-none absolute z-10" style={{ left: cross.left, top: cross.top }}>
          {/* A HAIRLINE, NOT A BAR. `w-px` at the marker's own colour reads as
              an instrument against the series rather than as a second mark
              competing with it; `-translate-x-1/2` centres it on the point so
              the rule and the dot cannot disagree by half a pixel. */}
          <span className="absolute block w-px -translate-x-1/2 bg-marker/60" style={{ height: cross.height }} />
          {cross.dotY != null && (
            <span
              className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-marker"
              style={{ top: cross.dotY }}
            />
          )}
        </span>
      )}
      {tip && (
        <span
          role="status"
          className="pointer-events-none absolute z-20 max-w-[16rem] truncate rounded-control border border-border bg-card px-2 py-1 text-xs text-foreground shadow-raised"
          style={{
            // Clamped to the wrapper, and flipped near its right edge, so a
            // tooltip on the last bucket does not hang off the tile.
            left: Math.max(0, Math.min(tip.x + 10, (wrap.current?.clientWidth ?? 0) - 16)),
            top: Math.max(0, tip.y - 30),
            transform: tip.x > (wrap.current?.clientWidth ?? 0) - 120 ? "translateX(-100%)" : undefined,
          }}
        >
          {tip.text}
        </span>
      )}
    </div>
  );
}
