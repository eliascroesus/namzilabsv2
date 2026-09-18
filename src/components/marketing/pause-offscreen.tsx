"use client";

import { useEffect, useRef } from "react";

/**
 * STOP ANIMATING SOMETHING NOBODY IS LOOKING AT.
 *
 * The marquee is the only thing on this page that moves on its own, and it
 * moves for as long as the tab is open — including the entire time somebody is
 * eight thousand pixels below it reading the FAQ. Eighty-four chips being
 * re-composited sixty times a second, forever, for nobody.
 *
 * Browsers throttle some off-screen work on their own, but not reliably for a
 * composited transform animation, and "the engine might optimise this" is not
 * a thing to leave in the one place the owner reported as feeling laggy.
 *
 * WHY THIS IS A WRAPPER AND NOT A CLIENT MARQUEE. `ToolMarquee` maps over
 * `CONNECTOR_CATALOG` — 42 entries with descriptions — and making it a client
 * component would serialise all of that into the RSC payload for a decoration.
 * This ships one `useEffect`, takes the already-rendered markup as `children`,
 * and toggles one attribute on it.
 *
 * THE DEFAULT IS RUNNING, not paused, which matters when JavaScript never
 * arrives: the animation is CSS and it plays on its own, so a visitor with a
 * dead bundle gets the ticker rather than a frozen row.
 */
export function PauseOffscreen({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    /* `IntersectionObserver` is everywhere this app runs, but a missing one
       must leave the animation PLAYING rather than throw — the fallback for a
       performance tweak is the thing it was tweaking. */
    if (!el || typeof IntersectionObserver === "undefined") return;

    const io = new IntersectionObserver(
      ([entry]) => {
        el.dataset.offscreen = entry.isIntersecting ? "false" : "true";
      },
      /* A margin, so it is already running by the time it scrolls into view and
         nobody ever sees it start. */
      { rootMargin: "200px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} data-offscreen="false">
      {children}
    </div>
  );
}
