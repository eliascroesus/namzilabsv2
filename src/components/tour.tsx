"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { clampStep, visibleSteps, type TourStep } from "@/lib/tour";
import { cn } from "@/lib/utils";

/**
 * THE FIRST-RUN WALKTHROUGH — a spotlight on a real element, a bubble beside
 * it, and a last step that goes somewhere.
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
 * on it keeps the highlighted control CLICKABLE, which matters throughout: the
 * obvious response to a spotlight on a nav item is to click the nav item.
 *
 * The ring and the dim are ONE declaration in `.tour-scrim`, and that is not
 * tidiness. They were a `ring-2` utility and a class, both writing
 * `box-shadow`; the utility layer won and the ring silently erased the dim, so
 * the tour highlighted perfectly and dimmed nothing while every check stayed
 * green. `pnpm tour` measures the painted pixel now.
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

/**
 * How long to wait for the rail's anchors before concluding there are none.
 *
 * Long enough to cover a slow client render on a cold page; short enough that
 * a viewport which genuinely has no rail (the drawer, below `md`) stops
 * looking almost immediately in human terms. Nothing is shown while it waits,
 * so the cost of the ceiling being generous is a few no-op timeouts.
 */
const WAIT_MS = 3000;
const POLL_MS = 150;

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

/**
 * `enabled` is the CALLER's judgement, not this component's.
 *
 * The dashboard's rule ("no connections and no flows") and the builder's ("this
 * is their first flow") are different facts about different things, and both
 * are pure and tested in `src/lib/tour.ts`. Pushing either into here would give
 * one component two opinions about who is new.
 *
 * What this owns is the part that is the same for every tour: has it been
 * dismissed, are its anchors on screen yet, and where does the bubble go.
 */
export function Tour({
  steps: declared,
  storageKey,
  enabled,
}: {
  steps: readonly TourStep[];
  /** Versioned, so changing the steps can re-show it. See TOUR_KEY. */
  storageKey: string;
  enabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [rect, setRect] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const bubbleRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const dismiss = useCallback(() => {
    setOpen(false);
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // Private mode, or storage blocked. The tour closes either way; the only
      // cost is that it may offer itself again, which is the harmless
      // direction.
    }
  }, [storageKey]);

  /**
   * WAIT FOR THE ANCHORS, RATHER THAN BETTING ON ONE FRAME.
   *
   * This was a single `requestAnimationFrame`: measure once, and if nothing
   * was found, return and never look again. On `/design/tour` that always
   * won — the anchors are static markup in the same tree. On the real
   * dashboard it lost, and the tour never appeared for a single new account.
   *
   * The anchors live in `Sidebar`, which is a `"use client"` component, and
   * the rail is not rendered below `md`. Whatever the precise reason one frame
   * was too early — hydration order, a width gate, the shell's skeleton — the
   * BUG is the bet itself: a one-shot measurement of a sibling's DOM, with
   * giving up forever as the failure mode.
   *
   * So it polls, briefly and with a bound. Found on the first tick in the
   * common case; up to `WAIT_MS` for a slow render; and if the anchors are
   * genuinely absent — a narrow viewport, where the rail is a drawer — it
   * stops and stays shut, which is the correct outcome there.
   */
  useEffect(() => {
    if (!enabled) return;
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(storageKey) === "1";
    } catch {
      dismissed = false;
    }
    if (dismissed) return;

    let timer: ReturnType<typeof setTimeout>;
    const started = Date.now();
    const look = () => {
      const found = visibleSteps((a) => rectOf(a) !== null, declared);
      if (found.length > 0) {
        setSteps(found);
        setOpen(true);
        return;
      }
      if (Date.now() - started < WAIT_MS) timer = setTimeout(look, POLL_MS);
    };
    // One frame first so the common case costs nothing extra.
    const frame = requestAnimationFrame(look);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [enabled, storageKey, declared]);

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
            {/*
              THE LAST STEP GOES SOMEWHERE. Nothing in this product does
              anything until data is coming in, so the tour finishes by taking
              you to Apps rather than closing on "Done". Dismissal happens
              first either way — navigating away must not leave the tour armed
              to reappear on the next empty page.
            */}
            <Button
              size="sm"
              onClick={() => {
                if (!last) {
                  setIndex((i) => clampStep(i + 1, steps.length));
                  return;
                }
                dismiss();
                if (step.href) router.push(step.href);
              }}
            >
              {last ? (step.cta ?? "Done") : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
