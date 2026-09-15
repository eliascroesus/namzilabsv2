"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { TOUR_KEY, TOUR_STEPS, clampStep, shouldOfferTour, visibleSteps, type TourStep } from "@/lib/tour";
import { cn } from "@/lib/utils";

/**
 * THE FIRST-RUN WALKTHROUGH — a spotlight on a real element, a bubble beside
 * it, and five steps.
 *
 * ═══ HAND-ROLLED, AND THAT IS THE CHEAPER OPTION HERE ═══
 *
 * Driver.js and Shepherd both do this, and both would have to be dressed to
 * match a kit that polices its own radii, shadows, type scale and button
 * variants mechanically (`pnpm check:ui`). Fighting a library's stylesheet into
 * that is more work than the ~150 lines below, and it adds a dependency to the
 * bundle every signed-in page loads for something only empty workspaces see.
 *
 * ═══ THE SPOTLIGHT IS A BOX-SHADOW, NOT AN OVERLAY WITH A HOLE ═══
 *
 * A dimming layer with a cut-out means either an SVG mask or four rectangles
 * that have to agree at the corners. A single element the size of the target
 * carrying `box-shadow: 0 0 0 9999px <dim>` dims everything OUTSIDE itself in
 * one paint, needs no maths, and cannot develop seams. `pointer-events: none`
 * on it keeps the highlighted control CLICKABLE, which matters: the first step
 * points at Apps and the obvious thing to do is click it.
 *
 * ═══ WHAT IT REFUSES TO DO ═══
 *
 * It never points at nothing. An anchor missing from the DOM — the rail is a
 * drawer on a narrow viewport, so two of these genuinely are absent there — is
 * dropped by `visibleSteps`, and a tour left with no steps does not open. It
 * also re-measures on scroll and resize, because a bubble pinned to where an
 * element used to be is worse than no bubble.
 */

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 6; // breathing room between the highlight and the element
const GAP = 12; // between the highlight and the bubble
const BUBBLE = 288; // w-72

function rectOf(anchor: string): Rect | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  // A zero-size box is an element that is in the DOM but not laid out (a
  // collapsed drawer). Pointing at it would put the bubble in the corner.
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/**
 * Where the bubble goes, kept inside the viewport.
 *
 * The preferred side is a hint, not a promise: `right` on a 320px-wide screen
 * would put half the bubble off-screen, so every position is clamped to the
 * viewport afterwards. Clamping rather than flipping keeps the arrow pointing
 * at the thing even when the bubble has had to slide.
 */
function place(rect: Rect, placement: TourStep["placement"], vw: number, vh: number) {
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  if (placement === "bottom") {
    return {
      top: rect.top + rect.height + GAP + PAD,
      left: clamp(rect.left + rect.width / 2 - BUBBLE / 2, 12, Math.max(12, vw - BUBBLE - 12)),
    };
  }
  const left = placement === "left" ? rect.left - BUBBLE - GAP - PAD : rect.left + rect.width + GAP + PAD;
  return {
    top: clamp(rect.top - 8, 12, Math.max(12, vh - 200)),
    left: clamp(left, 12, Math.max(12, vw - BUBBLE - 12)),
  };
}

export function Tour({ hasConnection, hasFlow }: { hasConnection: boolean; hasFlow: boolean }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [rect, setRect] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const bubbleRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback(() => {
    setOpen(false);
    try {
      window.localStorage.setItem(TOUR_KEY, "1");
    } catch {
      // Private mode, or storage blocked. The tour closes either way; the only
      // cost is that it may offer itself again, which is the harmless
      // direction.
    }
  }, []);

  /**
   * Decide ONCE, on mount, after the rail has rendered.
   *
   * The anchors belong to sibling components, so a measurement taken during
   * this component's first render would find none of them and conclude there
   * is nothing to show. `requestAnimationFrame` waits for the paint that puts
   * them in the document.
   */
  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(TOUR_KEY) === "1";
    } catch {
      dismissed = false;
    }
    if (!shouldOfferTour({ hasConnection, hasFlow, dismissed })) return;
    const id = requestAnimationFrame(() => {
      const found = visibleSteps((a) => rectOf(a) !== null, TOUR_STEPS);
      if (found.length === 0) return; // nothing to point at — stay shut
      setSteps(found);
      setOpen(true);
    });
    return () => cancelAnimationFrame(id);
  }, [hasConnection, hasFlow]);

  const step = steps[clampStep(index, steps.length)];

  /** Re-measure whenever the step changes, or the page moves under us. */
  useLayoutEffect(() => {
    if (!open || !step) return;
    const measure = () => {
      setRect(rectOf(step.anchor));
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    };
    measure();
    window.addEventListener("resize", measure);
    // `capture` so a scroll inside the rail counts, not only the window's.
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, step]);

  // Escape closes, and the bubble takes focus so a keyboard user is not left
  // tabbing through the page behind a modal-looking thing.
  useEffect(() => {
    if (!open) return;
    bubbleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, index, dismiss]);

  const pos = useMemo(
    () => (rect ? place(rect, step?.placement ?? "right", viewport.w, viewport.h) : null),
    [rect, step, viewport],
  );

  if (!open || !step || !rect || !pos) return null;
  const last = index >= steps.length - 1;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-50" role="dialog" aria-modal="false" aria-label="Product tour">
      {/*
        THE SPOTLIGHT. The huge spread dims the whole page outside this box in
        one paint. `pointer-events-none` is deliberate — the highlighted control
        stays clickable, because on step one the thing to do is click it.
      */}
      <div
        className="tour-scrim pointer-events-none absolute rounded-control transition-all duration-200 motion-reduce:transition-none"
        style={{
          top: rect.top - PAD,
          left: rect.left - PAD,
          width: rect.width + PAD * 2,
          height: rect.height + PAD * 2,
        }}
      />

      <div
        ref={bubbleRef}
        tabIndex={-1}
        className={cn(
          "pointer-events-auto absolute w-72 rounded-surface border border-border bg-card p-4 shadow-pop outline-none",
          "transition-all duration-200 motion-reduce:transition-none",
        )}
        style={{ top: pos.top, left: pos.left }}
      >
        <p className="text-sm font-semibold text-foreground">{step.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>

        <div className="mt-4 flex items-center justify-between gap-3">
          {/* Position, not a progress bar: five dots would be chrome for a
              number that fits in four characters. */}
          <span className="text-xs tabular-nums text-muted-foreground">
            {index + 1} / {steps.length}
          </span>
          <div className="flex items-center gap-2">
            {index > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => setIndex((i) => clampStep(i - 1, steps.length))}>
                Back
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={dismiss}>
                Skip
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => (last ? dismiss() : setIndex((i) => clampStep(i + 1, steps.length)))}
            >
              {last ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
