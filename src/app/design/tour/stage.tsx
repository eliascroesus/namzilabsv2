"use client";

import { useEffect, useState } from "react";
import { TOUR_KEY, TOUR_STEPS } from "@/lib/tour";
import { Tour } from "@/components/tour";

/**
 * Stand-in anchors, placed where the real ones sit.
 *
 * The rail's items run down a 70px column on the left and the bell sits at the
 * top right, so that is where these go. Their POSITIONS are what the tour's
 * geometry depends on — whether the bubble clears the column, whether a
 * `bottom`-placed bubble stays on screen under something in the top-right
 * corner — and those are faithful. Their contents are not, and do not need to
 * be.
 *
 * The dismissal key is cleared on mount, because otherwise looking at this page
 * once would stop it rendering for good.
 */
export function TourStage() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.removeItem(TOUR_KEY);
    } catch {
      // Storage blocked; the tour reads a miss as "not dismissed" anyway.
    }
    setReady(true);
  }, []);

  return (
    <div className="relative min-h-[520px] rounded-surface border border-border bg-rail p-4">
      {/* The rail's column. */}
      <div className="absolute left-4 top-4 flex w-[62px] flex-col gap-2">
        <div
          data-tour="rail-search"
          className="flex h-9 items-center justify-center rounded-control border border-rail-border bg-rail-control text-2xs text-rail-muted"
        >
          ⌕
        </div>
        {["dashboard", "flows", "apps"].map((id) => (
          <div
            key={id}
            data-tour={`nav-${id}`}
            className="flex h-9 items-center justify-center rounded-control bg-rail-control text-2xs text-rail-muted"
          >
            {id.slice(0, 3)}
          </div>
        ))}
      </div>

      {/* The top bar's bell. */}
      <div
        data-tour="top-bell"
        className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-control bg-rail-control text-2xs text-rail-muted"
      >
        ♪
      </div>

      <p className="absolute bottom-4 left-4 text-2xs text-rail-muted">
        {TOUR_STEPS.length} steps declared
      </p>

      {ready ? <Tour hasConnection={false} hasFlow={false} /> : null}
    </div>
  );
}
