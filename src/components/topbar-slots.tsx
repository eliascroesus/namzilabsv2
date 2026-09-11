"use client";

import { useEffect, useState, type ReactNode } from "react";
import { PortalSlot } from "@/components/portal-slot";
import { relativeTime } from "@/lib/format";

/**
 * THE TWO SLOTS IN BAR TWO, AND THE CALLERS THAT FILL THEM.
 *
 * `top-bar.tsx` draws bar two with an `<h1 id="topbar-title">` and a
 * `<div id="topbar-status">`, both `empty:hidden`, and for one commit that was
 * the whole story: the slots existed, nothing filled them, and the left half of
 * the bar rendered blank on every board route. The frame draws "Overview" at
 * 24/700 and "Updated just now" at 13/400, so a slot with no caller is not a
 * neutral placeholder — it is the feature missing.
 *
 * WHY SLOTS AND NOT PROPS. The bar is global: `AppFrame` renders it on every
 * route and cannot know what page it is on or when that page last computed
 * anything. A bar cannot honestly claim a freshness it has not measured. The
 * page knows both, so the page supplies them — the same arrangement
 * `FlowToolbar` already uses to portal the builder's toolbar into
 * `#topbar-slot`.
 *
 * THE PORTAL IS CLIENT-ONLY, and that is what keeps the relative time honest.
 * `node` is null until the effect runs, so nothing renders on the server and
 * there is no server/client time to disagree about — the freshness string is
 * computed once, in the browser, from the timestamp the page hands it.
 */
/**
 * `PortalSlot` NOW, AND THE LOCAL COPY IS GONE BECAUSE IT WAS WRONG.
 *
 * It resolved `#topbar-title` once on mount and kept the answer. When the bar
 * remounted — a soft navigation between views, or `FreshnessPoller`'s
 * refresh — the heading went on portalling into the detached div and the bar
 * read blank, which is exactly what was reported. See `portal-slot.tsx`.
 */
const Slot = PortalSlot;

/**
 * The page's name AND the window it is showing, in the bar's one band.
 *
 * Node 35:6028 draws three children on an 8px gap — "Overview", a bare "-",
 * and "Sat, 1 Sep - Sat, 1 Sep" — so this is a CLUSTER rather than a string,
 * and the <h1> comes with it rather than being supplied by the bar. That is
 * the right way round: the page owns its heading, and the bar owns the strip
 * the heading sits in.
 *
 * THE NAME IS THE ACTIVE VIEW'S, not a route label — the tab that is filled
 * and the title above it say the same word, or the bar is describing a page
 * you are not on.
 *
 * `range` IS THE RESOLVED WINDOW IN DATES, NOT THE PRESET'S LABEL, and the
 * Figma is explicit about it: the control to the right reads "Today" while
 * this reads "Sat, 1 Sep - Sat, 1 Sep". They are not duplicates — one is the
 * name of a choice and the other is what that choice currently means, which
 * changes under a preset without the preset changing. Omitted, the dash goes
 * with it rather than leaving a hanging separator.
 */
export function TopBarTitle({ children, range }: { children: ReactNode; range?: string | null }) {
  return (
    <Slot id="topbar-title">
      {/* `truncate` on the name and `shrink-0` on the dates: at a narrow panel
          it is the view's name that should give way, because the window is
          short, fixed-width and the thing the number on screen depends on. */}
      <h1 className="truncate text-2xl text-topbar-foreground">{children}</h1>
      {range ? (
        <>
          <span aria-hidden className="shrink-0 text-xs leading-4 text-topbar-muted">
            -
          </span>
          <span className="shrink-0 text-xs leading-4 text-topbar-muted">{range}</span>
        </>
      ) : null}
    </Slot>
  );
}

/**
 * "Updated just now", from the page that measured it.
 *
 * `at` is the newest thing the page has computed. Null renders nothing rather
 * than "Updated never": the slot is `empty:hidden`, so an unknown freshness
 * costs the bar no space and makes no claim.
 */
export function TopBarFreshness({ at }: { at?: Date | string | null }) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!at) return setLabel(null);
    const when = at instanceof Date ? at : new Date(at);
    if (Number.isNaN(when.getTime())) return setLabel(null);
    const tick = () => setLabel(`Updated ${relativeTime(when)}`);
    tick();
    // A minute is the smallest step `relativeTime` prints past ten seconds, so
    // re-reading more often than that would redraw the same string.
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [at]);

  if (!label) return null;
  return <Slot id="topbar-status">{label}</Slot>;
}
