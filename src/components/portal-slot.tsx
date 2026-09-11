"use client";

import { createPortal } from "react-dom";
import { useEffect, useState, type ReactNode } from "react";

/**
 * A CLIENT CONTROL, RENDERED INTO A POSITION THE SERVER PAGE OWNS.
 *
 * Four files each carried their own four-line copy of this — `topbar-slots`,
 * `calendar-board`, `board-layout`, `FlowToolbar` — and the duplication was
 * defensible right up until it wasn't: they all shared a bug, and a bug has to
 * be fixed in four places or it is only fixed in one. That is the reason this
 * is extracted and the earlier "copy it, it's four lines" note is not.
 *
 * ── THE BUG, WHICH SHIPPED AND WAS REPORTED AS "the title is blank" ─────────
 *
 * Every copy read:
 *
 *     const [node, setNode] = useState(null);
 *     useEffect(() => setNode(document.getElementById(id)), [id]);
 *
 * which resolves the target ONCE, on mount, and never again — the dependency
 * list is the id, and the id never changes. Two things break it, and both
 * happen on the real dashboard:
 *
 *   THE TARGET ARRIVES LATE. `getElementById` returns null if the shell has
 *   not committed yet, and `null` is a final answer: the effect has already
 *   run and will not run again. The portal renders nothing, forever.
 *
 *   THE TARGET IS REPLACED. This is the one that actually bit. When the bar
 *   remounts — a soft navigation between views, a `router.refresh()` from
 *   `FreshnessPoller` that reconciles the shell — the old `#topbar-title` is
 *   detached and a NEW one takes its place. The stored `node` still points at
 *   the old one, which is no longer in the document, so React faithfully
 *   portals the heading into a div nobody can see. Nothing errors. Nothing
 *   logs. The bar is simply blank, and it comes back if you hard-reload, which
 *   is exactly the "sometimes it works" shape that makes this hard to catch.
 *
 * ── THE FIX ────────────────────────────────────────────────────────────────
 *
 * Resolve the target continuously rather than once. A `MutationObserver` on
 * the body re-reads it whenever the DOM changes, and `setNode` is called only
 * when the answer actually differs — so a re-attached bar is picked up on the
 * same frame it appears, and an unchanged one costs a `getElementById` and a
 * reference comparison.
 *
 * THE COST IS SMALL AND WORTH NAMING. The observer fires on every subtree
 * mutation, which on a board with animating charts is often; `getElementById`
 * is a hash lookup and the guard means React re-renders only on a real change.
 * The alternative — threading a ref down through context — cannot cross the
 * server/client boundary the way these callers are arranged, which is why the
 * portal exists at all.
 *
 * NOTHING RENDERS ON THE SERVER, deliberately: `node` is null until the effect
 * runs, so there is no markup for hydration to disagree about. That was true
 * of every copy and stays true here.
 */
export function PortalSlot({ id, children }: { id: string; children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let current: HTMLElement | null = null;
    const sync = () => {
      const found = document.getElementById(id);
      // Reference comparison, not truthiness: the failure being fixed is a
      // node that is still an element and no longer in the document, so
      // "we already have one" is precisely the wrong question to ask.
      if (found !== current) {
        current = found;
        setNode(found);
      }
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [id]);

  return node ? createPortal(children, node) : null;
}
