"use client";

import { useEffect, useState } from "react";
import { TOUR_KEY, TOUR_STEPS } from "@/lib/tour";
import { Tour } from "@/components/tour";

/**
 * Stand-in anchors, placed where the real ones sit.
 *
 * The rail's items run down a narrow column on the left and the bell sits at
 * the top right, so that is where these go. Their POSITIONS are what the
 * tour's geometry depends on — whether the bubble clears the column, whether a
 * `bottom`-placed bubble stays on screen under something in the top-right
 * corner — and those are faithful. Their contents are not, and do not need to
 * be.
 *
 * The dismissal key is cleared on mount, because otherwise looking at this
 * page once would stop it rendering for good.
 *
 * ═══ `?late=1` RENDERS THE HARD CASE ═══
 *
 * The anchors are held back for 900ms, which reproduces the bug that kept the
 * tour from ever appearing for a new account: the rail is a `"use client"`
 * component, and the tour measured for its anchors ONCE, on a single
 * `requestAnimationFrame`, giving up forever if they were not there yet.
 *
 * On this page they always were — static markup in the same tree — so every
 * check stayed green while the real dashboard showed nothing at all. A design
 * page that renders only the easy case cannot catch a timing bug, so this one
 * renders the hard case on demand.
 */
export function TourStage({ late = false }: { late?: boolean }) {
  const [ready, setReady] = useState(false);
  const [anchors, setAnchors] = useState(!late);

  useEffect(() => {
    try {
      window.localStorage.removeItem(TOUR_KEY);
    } catch {
      // Storage blocked; the tour reads a miss as "not dismissed" anyway.
    }
    setReady(true);
    if (!late) return;
    const t = setTimeout(() => setAnchors(true), 900);
    return () => clearTimeout(t);
  }, [late]);

  return (
    <div className="relative min-h-[520px] rounded-surface border border-border bg-rail p-4">
      {anchors ? (
        <>
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
        </>
      ) : null}

      <p className="absolute bottom-4 left-4 text-2xs text-rail-muted">
        {TOUR_STEPS.length} steps declared{late ? " · anchors held back 900ms" : ""}
      </p>

      {ready ? <Tour steps={TOUR_STEPS} storageKey={TOUR_KEY} enabled /> : null}
    </div>
  );
}
