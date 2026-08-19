"use client";

import { Search } from "lucide-react";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NODE_LIBRARY, STAGES, type LibraryEntry } from "./node-meta";
import { NodeIcon } from "./icons";

/** Where to anchor the picker: the button's right edge + vertical centre (and its
 *  left edge, used when the card has to flip to the button's other side). */
export type PickerAnchor = { x: number; y: number; leftX?: number } | null;

/** The anchor for a picker opened from a button, from that button's rect. */
export function anchorFromRect(r: DOMRect): { x: number; y: number; leftX: number } {
  return { x: r.right, y: r.top + r.height / 2, leftX: r.left };
}

const WIDTH = 380;
const GAP = 14;
const MARGIN = 12;

/**
 * The step picker — Make.com style: a roomy card of big, colourful, stacked step
 * rows that springs up beside the button that opened it (no page dimming),
 * vertically centred on it. The canvas stays pannable while it's open — when an
 * `anchorSelector` is given it stays glued to that button as the canvas moves.
 */
export function NodeLibraryModal({
  onClose,
  onPick,
  anchor,
  anchorSelector,
}: {
  onClose: () => void;
  onPick: (entry: LibraryEntry) => void;
  anchor: PickerAnchor;
  anchorSelector?: string | null;
}) {
  const [q, setQ] = useState("");
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const query = q.trim().toLowerCase();
  const matches = (e: LibraryEntry) =>
    !query || `${e.label} ${e.blurb} ${e.keywords} ${e.stage}`.toLowerCase().includes(query);
  // Grouped by stage, with headers; a stage with nothing visible (Dashboard,
  // whose Output step became Review & publish) simply doesn't render — an
  // empty section header would advertise a step that doesn't exist.
  const sections = STAGES.map((stage) => ({
    stage,
    items: NODE_LIBRARY.filter((e) => e.stage === stage && matches(e)),
  })).filter((s) => s.items.length > 0);
  const items = sections.flatMap((s) => s.items);

  const centered = !anchor && !anchorSelector;

  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 120);
  };

  // Position the card beside the anchor, vertically centred, flipping left when it
  // would run off-screen. Re-run each frame so it stays glued to a moving button
  // (canvas pan). Positioning is done via direct style writes — no re-render.
  useLayoutEffect(() => {
    if (centered) return;
    let raf = 0;
    // The frame loop has to keep RUNNING (the canvas can pan under us at any
    // moment), but it must not keep WRITING: assigning the same three style
    // properties every frame invalidates layout sixty times a second for a
    // card that is usually perfectly still. Remembering the last placement
    // makes the idle case free and leaves the moving case identical.
    let last = "";
    const place = () => {
      const el = panelRef.current;
      if (el) {
        let a = anchor;
        if (anchorSelector) {
          const target = document.querySelector<HTMLElement>(anchorSelector);
          if (target) a = anchorFromRect(target.getBoundingClientRect());
        }
        if (a) {
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const w = el.offsetWidth;
          const h = el.offsetHeight;
          let left = a.x + GAP;
          let side = "left";
          if (left + w > vw - MARGIN) {
            left = (a.leftX ?? a.x) - w - GAP;
            side = "right";
          }
          left = Math.max(MARGIN, Math.min(left, vw - w - MARGIN));
          let top = a.y - h / 2;
          top = Math.max(MARGIN, Math.min(top, vh - h - MARGIN));
          const next = `${left}|${top}|${side}`;
          if (next !== last) {
            last = next;
            el.style.left = `${left}px`;
            el.style.top = `${top}px`;
            el.style.transformOrigin = `${side} center`;
            el.style.visibility = "visible";
          }
        }
      }
      raf = requestAnimationFrame(place);
    };
    place(); // position synchronously before first paint, then follow each frame
    return () => cancelAnimationFrame(raf);
  }, [anchor, anchorSelector, centered]);

  // Close on an outside CLICK (a canvas drag/pan fires no click, so panning keeps
  // it open) or Escape.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) requestClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  const style: React.CSSProperties = centered
    ? { position: "fixed", top: "50%", left: "50%", width: WIDTH, transform: "translate(-50%, -50%)", transformOrigin: "center" }
    : { position: "fixed", width: WIDTH, top: -9999, left: -9999, visibility: "hidden" };

  return (
    // pointer-events-none so the canvas stays pannable underneath; the panel itself
    // re-enables them.
    <div className="pointer-events-none fixed inset-0 z-50">
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        style={style}
        className={`pointer-events-auto flex max-h-[74vh] flex-col overflow-hidden rounded-2xl bg-white flow-shadow ${closing ? "flow-pop-out" : "flow-pop-in"}`}
      >
        <div className="p-3 pb-2">
          <div className="relative">
<Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search steps…"
              className="w-full rounded-xl border border-neutral-200 bg-neutral-50 py-2.5 pl-10 pr-3 text-lead text-foreground placeholder:text-neutral-400 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2 pt-1">
          {items.length === 0 ? (
            <p className="p-8 text-center text-sm text-neutral-500">No matching steps.</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {sections.map((sec) => (
                <div key={sec.stage}>
                  <p className="px-2.5 pb-1 pt-2 text-micro font-semibold uppercase tracking-wide text-neutral-400">{sec.stage}</p>
                  {sec.items.map((e) => (
                    <button
                      key={e.key}
                      onClick={() => onPick(e)}
                      className="group flex w-full items-center gap-3.5 rounded-card px-2.5 py-2.5 text-left transition-colors hover:bg-brand-50"
                    >
                      <NodeIcon type={e.type} variant={e.key === "unite_match" ? "unite_match" : e.key === "formula_compare" ? "formula_compare" : undefined} size={40} />
                      <span className="min-w-0">
                        <span className="block text-lead font-semibold leading-tight text-foreground">{e.label}</span>
                        <span className="mt-0.5 block text-small leading-tight text-neutral-500">{e.blurb}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
