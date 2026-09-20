"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A figure arriving at a known answer.
 *
 * Linear, because a count-up that eases looks like it is DECIDING, and the
 * whole argument of the page is that the number was already true before you
 * looked at it.
 *
 * REDUCED MOTION GETS THE CONCLUSION AT 0ms, not a faster performance. The
 * server renders the final value and the effect winds it back to zero only
 * when motion is welcome — which is also why there is no hydration mismatch
 * and why a reader with JavaScript off still sees 41 rather than 0.
 */
export function CountUp({
  to,
  from: initial,
  format,
  delay = 0,
  duration = 520,
}: {
  to: number;
  /** Where the first run starts. The hero counts up from 0; a tab swap counts
      from whatever the previous tab was showing, which is why this is a ref
      rather than a prop after the first render. */
  from?: number;
  format?: (value: number) => string;
  delay?: number;
  duration?: number;
}) {
  const [value, setValue] = useState(to);
  const frame = useRef<number | null>(null);
  const from = useRef(initial ?? to);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(to);
      from.current = to;
      return;
    }

    const start = from.current;
    let t0: number | null = null;

    const tick = (now: number) => {
      if (t0 === null) t0 = now;
      const elapsed = now - t0;
      if (elapsed < delay) {
        frame.current = requestAnimationFrame(tick);
        return;
      }
      const progress = Math.min((elapsed - delay) / duration, 1);
      setValue(start + (to - start) * progress);
      if (progress < 1) frame.current = requestAnimationFrame(tick);
      else from.current = to;
    };

    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [to, delay, duration]);

  return <>{format ? format(value) : Math.round(value)}</>;
}
