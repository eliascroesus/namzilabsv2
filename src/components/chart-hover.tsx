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
export function ChartHover({ children }: { children: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);

  return (
    <div
      ref={wrap}
      className="relative flex min-h-0 flex-1 flex-col"
      onPointerMove={(e) => {
        // Coarse pointers have no hover — a tap would leave the tooltip stuck.
        if (e.pointerType === "touch") return;
        const el = (e.target as Element).closest("[data-tip]");
        const box = wrap.current?.getBoundingClientRect();
        if (!el || !box) return setTip(null);
        setTip({ text: el.getAttribute("data-tip") ?? "", x: e.clientX - box.left, y: e.clientY - box.top });
      }}
      onPointerLeave={() => setTip(null)}
    >
      {children}
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
