"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The hero's payoff figure, counting 0 → 41 at t=2900ms.
 *
 * Linear, because a count-up that eases is a count-up that looks like it is
 * deciding. The number is arriving at a known answer, not settling on one.
 *
 * REDUCED MOTION GETS THE FINAL VALUE AT 0ms, not a faster count. The
 * distinction matters: the whole hero sequence is an argument, and somebody
 * who has asked for less motion should read the argument's conclusion
 * immediately rather than a shorter version of the performance. The check is
 * done in an effect rather than at module scope so the server and the first
 * client render agree on `0`... except they cannot, because the server has no
 * media query — so the server renders the FINAL value and the effect winds it
 * back to 0 only when motion is actually welcome. That way the no-JS and
 * reduced-motion readers both get 41, and nobody gets a hydration mismatch.
 */
export function CountUp({ to, delay = 0, duration = 420 }: { to: number; delay?: number; duration?: number }) {
  const [value, setValue] = useState(to);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    setValue(0);
    let start: number | null = null;

    const tick = (now: number) => {
      if (start === null) start = now;
      const elapsed = now - start;
      if (elapsed < delay) {
        frame.current = requestAnimationFrame(tick);
        return;
      }
      const progress = Math.min((elapsed - delay) / duration, 1);
      setValue(Math.round(progress * to));
      if (progress < 1) frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [to, delay, duration]);

  return <>{value}</>;
}
