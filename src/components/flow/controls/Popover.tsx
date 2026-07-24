"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A small headless popover: an anchor (trigger) + a floating panel below it. Closes on
 * outside pointer-down and Escape. Two positioning modes:
 *  - default: absolutely positioned below the anchor (left/right aligned) — fine for
 *    small menus inside unclipped containers.
 *  - `fixed`: viewport-positioned from the anchor's rect, so the panel escapes
 *    scroll/overflow containers (the config rail) and can be WIDER than its anchor —
 *    aligned under the input and extending left over the canvas, Zapier-style. It
 *    re-measures on scroll/resize so it stays glued to the anchor.
 */
export function Popover({
  open,
  setOpen,
  anchor,
  children,
  width,
  align = "left",
  fixed = false,
  placement = "below",
  anchorRect,
  panelClassName,
}: {
  open: boolean;
  setOpen: (o: boolean) => void;
  anchor: ReactNode;
  children: ReactNode;
  width?: number;
  align?: "left" | "right";
  fixed?: boolean;
  /** "below" (default) opens under the trigger; "left" opens as a full-height
   *  flyout to the LEFT of `anchorRect`'s element (the config panel). */
  placement?: "below" | "left";
  /** When set (with placement "left"), the rect to attach to instead of the trigger. */
  anchorRect?: () => DOMRect | null;
  /** Override the panel's border/radius/shadow (e.g. to match the config window). */
  panelClassName?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  // Kept in a ref so the positioning effect doesn't churn its listeners each render.
  const anchorRectRef = useRef(anchorRect);
  anchorRectRef.current = anchorRect;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  // Fixed mode: measure the anchor and clamp to the viewport; follow it on
  // scroll (capture phase reaches the rail's inner scroller) and resize.
  useEffect(() => {
    if (!open || !fixed) {
      setPos(null);
      return;
    }
    const update = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const ref = anchorRectRef.current?.() ?? null;
      // Left flyout: attach to the reference element (config panel), span its
      // vertical extent, sit just to its left. Content wraps; height caps here.
      if (placement === "left" && ref) {
        const desired = width ?? 452;
        const w = Math.max(240, Math.min(desired, ref.left - 24));
        const left = Math.max(12, ref.left - 12 - w);
        setPos({ top: ref.top, left, width: w, maxHeight: ref.height });
        return;
      }
      const r = wrapRef.current?.getBoundingClientRect();
      if (!r) return;
      const w = Math.min(width ?? 560, vw - 16);
      let left = align === "right" ? r.right - w : r.left;
      left = Math.max(8, Math.min(left, vw - w - 8));
      const top = Math.min(r.bottom + 4, vh - 160);
      setPos({ top, left, width: w, maxHeight: Math.max(160, vh - top - 12) });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, fixed, align, width, placement]);

  const panelStyle = fixed
    ? pos
      ? { position: "fixed" as const, top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }
      : { display: "none" as const }
    : width
      ? { width }
      : undefined;

  return (
    <div className="relative" ref={wrapRef}>
      {anchor}
      {open && (
        <div
          className={`z-30 flex flex-col overflow-hidden ${panelClassName ?? "rounded-md border border-neutral-200 bg-white shadow-lg"} ${
            fixed ? "" : `absolute mt-1 ${align === "right" ? "right-0" : "left-0"}`
          }`}
          style={panelStyle}
        >
          {children}
        </div>
      )}
    </div>
  );
}
