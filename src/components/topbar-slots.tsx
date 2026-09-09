"use client";

import { createPortal } from "react-dom";
import { useEffect, useState, type ReactNode } from "react";
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
function Slot({ id, children }: { id: string; children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => setNode(document.getElementById(id)), [id]);
  return node ? createPortal(children, node) : null;
}

/**
 * The page's name, in bar two. Node 0:5 draws "Overview" — the ACTIVE VIEW's
 * name, which is why the board passes the view rather than a route label: the
 * tab that is filled and the title above it say the same word, or the bar is
 * describing a page you are not on.
 */
export function TopBarTitle({ children }: { children: ReactNode }) {
  return <Slot id="topbar-title">{children}</Slot>;
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
